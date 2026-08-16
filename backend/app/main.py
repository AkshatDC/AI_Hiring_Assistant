import os
import uuid
import time
from datetime import datetime, timezone
from fastapi import FastAPI, Request, HTTPException, BackgroundTasks, Header
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional, List
from dotenv import load_dotenv

from pathlib import Path
# Load env variables FIRST — before importing local modules that read os.getenv at import time
env_path = Path(__file__).resolve().parent.parent / '.env'
load_dotenv(dotenv_path=env_path, override=True)

from app.schemas import JobCreate, SourcingSearchQuery, CandidateCreate, CandidateUpdate, CandidateFeedbackCreate, BulkCandidateUpdate, CallTrigger, BulkCallTrigger, AgentCreate, AgentUpdate
from app import db, ai, apollo, hunar

app = FastAPI(title="AI Hiring Platform & Reachout Assistant")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PUBLIC_WEBHOOK_URL = os.getenv("PUBLIC_WEBHOOK_URL", "http://localhost:8000")


# ─────────────────────────────────────────────────────────────
# SYSTEM CONFIG
# ─────────────────────────────────────────────────────────────

@app.get("/api/config")
def get_config():
    return {
        "hunar_configured": bool(os.getenv("HUNAR_API_KEY", "")),
        "gemini_configured": bool(os.getenv("GEMINI_API_KEY", "")),
        "apollo_configured": bool(os.getenv("APOLLO_API_KEY", "")),
        "coresignal_configured": bool(os.getenv("CORESIGNAL_API_KEY", "")),
        "public_webhook_url": PUBLIC_WEBHOOK_URL
    }


# ─────────────────────────────────────────────────────────────
# JOB POSTINGS
# ─────────────────────────────────────────────────────────────

@app.post("/api/jobs")
def create_job(payload: JobCreate):
    job_id = str(uuid.uuid4())
    requirements = ai.extract_jd_requirements(payload.description)
    
    skills_str = ", ".join(requirements.get("skills", ["Required Skills"]))
    job_title = requirements.get("title", payload.title)
    
    job = {
        "id": job_id,
        "title": payload.title,
        "description": payload.description,
        "requirements": requirements,
        "agent_config": {
            "name": f"Screening: {payload.title}",
            "language": "ENGLISH",
            "voice_persona": "NEHA",
            "persona_name": "Seema",
            "objective": f"Screen candidates for the position of {job_title}. Qualify their experience, core technical skills ({skills_str}), notice period, and salary expectations.",
            "introduction": f"Hi! This is {{persona_name}}, an AI recruiting assistant calling about a {job_title} opportunity. Is now a good time to chat?",
            "agent_prompt": f"You are {{persona_name}}, a professional AI recruiting assistant. You are calling about a {job_title} role that requires {skills_str}. Gauge the candidate's interest, ask about their current notice period, expected CTC, years of experience, and whether they'd like a follow-up with our recruiter. Be friendly, concise, and respectful.",
            "result_prompt": f"From the conversation, extract: interested (Yes/No/Maybe), notice_period (in days), expected_ctc (annual in INR), years_of_experience (number), and a short summary of how the call went.",
            "silence_response": "Are you there?",
            "conclusion": "Thank you for your time! Have a wonderful day.",
            "custom_variables": ["callee_name", "job_title", "company", "jd_summary"],
            "result_schema": {
                "interested": "",
                "notice_period": "",
                "expected_ctc": "",
                "years_of_experience": "",
                "summary": ""
            }
        },
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ")
    }
    
    db.save_job(job)
    return job


@app.get("/api/jobs")
def list_jobs():
    return db.list_jobs()


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    job = db.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


# ─────────────────────────────────────────────────────────────
# SOURCING — Apollo (primary) / CoreSignal (fallback)
# ─────────────────────────────────────────────────────────────

@app.get("/api/apollo/test")
def apollo_debug_test():
    """Debug endpoint: tests Apollo + CoreSignal connectivity, returns raw diagnostics."""
    import requests as _req
    APOLLO_KEY = os.getenv("APOLLO_API_KEY", "")
    CS_KEY = os.getenv("CORESIGNAL_API_KEY", "")

    results = {}

    # Test Apollo
    apollo_key_visible = APOLLO_KEY[:10] + "..." if APOLLO_KEY else "NOT SET"
    if APOLLO_KEY:
        try:
            r = _req.post(
                "https://api.apollo.io/api/v1/mixed_people/search",
                headers={"X-Api-Key": APOLLO_KEY, "Content-Type": "application/json", "Cache-Control": "no-cache"},
                params={"person_titles[]": "software engineer", "per_page": 2, "page": 1},
                timeout=15
            )
            data = r.json()
            results["apollo"] = {
                "key_prefix": apollo_key_visible,
                "http_status": r.status_code,
                "num_results": len(data.get("people", [])),
                "first_person": (data.get("people") or [{}])[0].get("name") if data.get("people") else None,
                "error_detail": data.get("error"),
            }
        except Exception as e:
            results["apollo"] = {"key_prefix": apollo_key_visible, "exception": str(e)}
    else:
        results["apollo"] = {"error": "APOLLO_API_KEY not set", "key": apollo_key_visible}

    # Test CoreSignal — Step 1: search returns list of integer IDs (no limit/offset supported)
    cs_key_visible = CS_KEY[:10] + "..." if CS_KEY else "NOT SET"
    if CS_KEY:
        try:
            cs_headers = {"accept": "application/json", "apikey": CS_KEY, "Content-Type": "application/json"}
            # Search returns a plain list of employee IDs
            r = _req.post(
                "https://api.coresignal.com/cdapi/v2/employee_base/search/filter",
                headers=cs_headers,
                json={"title": "software engineer"},  # NO limit/offset — not supported
                timeout=15
            )
            ids = r.json() if r.status_code == 200 else []
            ids = ids if isinstance(ids, list) else []
            first_name = None
            if ids:
                # Step 2: collect first profile
                r2 = _req.get(
                    f"https://api.coresignal.com/cdapi/v2/employee_base/collect/{ids[0]}",
                    headers=cs_headers,
                    timeout=15
                )
                if r2.status_code == 200:
                    p = r2.json()
                    first_name = p.get("full_name") or f"{p.get('first_name','')} {p.get('last_name','')}".strip()
            results["coresignal"] = {
                "key_prefix": cs_key_visible,
                "http_status": r.status_code,
                "total_ids_returned": len(ids),
                "first_id": ids[0] if ids else None,
                "first_person": first_name,
                "status": "LIVE" if r.status_code == 200 and ids else "ERROR",
            }
        except Exception as e:
            results["coresignal"] = {"key_prefix": cs_key_visible, "exception": str(e)}
    else:
        results["coresignal"] = {"error": "CORESIGNAL_API_KEY not set", "key": cs_key_visible}

    return results


@app.post("/api/sourcing/search")
def search_sourcing(job_id: str, payload: SourcingSearchQuery):
    job = db.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
        
    title = payload.title or job["requirements"].get("title")
    skills = payload.skills or job["requirements"].get("skills")
    location = payload.location or job["requirements"].get("location")
    
    results = apollo.search_people(
        title=title,
        skills=skills,
        location=location,
        experience_years=payload.experience_years,
        size=payload.size
    )
    return results


@app.post("/api/sourcing/auto-search")
def auto_search_and_add(job_id: str, auto_add: bool = False, pipeline_limit: Optional[int] = None):
    """
    Auto-search Apollo (w/ CoreSignal fallback) based on job requirements
    and optionally bulk-add all results as candidates to the pipeline.
    If pipeline_limit is set, AI ranks candidates and only adds the top-N.
    """
    job = db.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    requirements = job["requirements"]
    results = apollo.search_people(
        title=requirements.get("title"),
        skills=requirements.get("skills"),
        location=requirements.get("location"),
        experience_years=requirements.get("experience_years"),
        size=10
    )
    
    # Apply AI ranking + limit if requested
    candidates_to_add = results
    ranked_applied = False
    if auto_add and pipeline_limit and pipeline_limit > 0 and len(results) > pipeline_limit:
        print(f"[AutoSearch] Ranking {len(results)} candidates, keeping top {pipeline_limit}")
        candidates_to_add = ai.rank_candidates(results, requirements, pipeline_limit)
        ranked_applied = True
    
    added = []
    if auto_add:
        for cand in candidates_to_add:
            # Determine best phone number
            mobile = cand.get("mobile_phone")
            phones = cand.get("phone_numbers", [])
            raw_phone = mobile if mobile else (phones[0] if phones else "Unknown")
            phone = hunar.normalize_phone(str(raw_phone)) if raw_phone and raw_phone != "Unknown" else "Unknown"
            if not phone:
                phone = str(raw_phone) if raw_phone and raw_phone != "Unknown" else "Unknown"
            
            candidate_id = str(uuid.uuid4())
            candidate = {
                "id": candidate_id,
                "job_id": job_id,
                "name": cand.get("full_name") or f"{cand.get('first_name', '')} {cand.get('last_name', '')}".strip(),
                "phone": phone,
                "email": str(cand.get("work_email", "")) if cand.get("work_email") else "",
                "source_id": cand.get("id"),
                "title": cand.get("job_title"),
                "company": cand.get("job_company_name"),
                "skills": cand.get("skills", []),
                "call_id": None,
                "call_status": "NOT_STARTED",
                "stage": "SOURCED",
                "stage_changed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "recruiter_notes": "",
                "follow_up_at": None,
                "follow_up_status": "NOT_SCHEDULED",
                "interview_feedback": [],
                "offer": {"status": "NOT_STARTED"},
                "consent_status": "CONTACT_ALLOWED",
                "preferred_contact_time": "",
                "outreach_log": [],
                "recording_url": None,
                "answers": {},
                "evaluation": {},
                "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ")
            }
            db.save_candidate(candidate)
            added.append(candidate)
    
    return {
        "results": results,
        "added_count": len(added),
        "added": added,
        "ranked_applied": ranked_applied,
        "total_sourced": len(results)
    }


# ─────────────────────────────────────────────────────────────
# CANDIDATES
# ─────────────────────────────────────────────────────────────

@app.post("/api/candidates")
def add_candidate(payload: CandidateCreate):
    candidate_id = str(uuid.uuid4())
    candidate = {
        "id": candidate_id,
        "job_id": payload.job_id,
        "name": payload.name,
        "phone": payload.phone,
        "email": payload.email,
        "pdl_id": payload.pdl_id,
        "title": payload.title,
        "company": payload.company,
        "skills": payload.skills,
        "call_id": None,
        "call_status": "NOT_STARTED",
        "stage": "SOURCED",
        "stage_changed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "recruiter_notes": "",
        "follow_up_at": None,
        "follow_up_status": "NOT_SCHEDULED",
        "interview_feedback": [],
        "offer": {"status": "NOT_STARTED"},
        "consent_status": "CONTACT_ALLOWED",
        "preferred_contact_time": "",
        "outreach_log": [],
        "recording_url": None,
        "answers": {},
        "evaluation": {},
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ")
    }
    db.save_candidate(candidate)
    return candidate


@app.get("/api/candidates")
def list_candidates(job_id: Optional[str] = None):
    return db.list_candidates(job_id)


@app.get("/api/jobs/{job_id}/analytics")
def job_analytics(job_id: str):
    if not db.get_job(job_id):
        raise HTTPException(status_code=404, detail="Job not found")
    candidates = db.list_candidates(job_id)
    now = datetime.now().strftime("%Y-%m-%dT%H:%M")
    evaluated = [candidate for candidate in candidates if candidate.get("evaluation", {}).get("overall_score") is not None]
    advanced = [candidate for candidate in evaluated if candidate.get("evaluation", {}).get("decision") == "ADVANCE"]
    overdue = [candidate for candidate in candidates if candidate.get("follow_up_at") and candidate["follow_up_at"][:16] < now and candidate.get("follow_up_status") != "COMPLETED"]
    stage_counts = {}
    stage_ages = []
    decline_reasons = {}
    for candidate in candidates:
        stage = candidate.get("stage", "SOURCED")
        stage_counts[stage] = stage_counts.get(stage, 0) + 1
        try:
            changed_at = datetime.fromisoformat(candidate.get("stage_changed_at", candidate.get("created_at", "")).replace("Z", "+00:00"))
            stage_ages.append((datetime.now(timezone.utc) - changed_at).total_seconds() / 3600)
        except (TypeError, ValueError):
            pass
        if candidate.get("evaluation", {}).get("decision") == "DECLINE":
            reasons = candidate.get("evaluation", {}).get("risks", []) or ["Does not meet screening criteria"]
            reason = str(reasons[0])
            decline_reasons[reason] = decline_reasons.get(reason, 0) + 1
    return {
        "total_candidates": len(candidates),
        "calls_completed": sum(candidate.get("call_status") == "COMPLETED" for candidate in candidates),
        "call_completion_rate": round((sum(candidate.get("call_status") == "COMPLETED" for candidate in candidates) / len(candidates)) * 100) if candidates else 0,
        "evaluated": len(evaluated),
        "shortlisted": len(advanced),
        "shortlist_rate": round((len(advanced) / len(evaluated)) * 100) if evaluated else 0,
        "stage_counts": stage_counts,
        "average_stage_age_hours": round(sum(stage_ages) / len(stage_ages), 1) if stage_ages else 0,
        "decline_reasons": decline_reasons,
        "overdue_follow_ups": overdue,
    }


@app.patch("/api/candidates/bulk-update")
def bulk_update_candidates(payload: BulkCandidateUpdate):
    """Apply one recruiter workflow action to several candidates at once."""
    updated = []
    changes = payload.dict(exclude_none=True, exclude={"candidate_ids"})
    for candidate_id in payload.candidate_ids:
        candidate = db.get_candidate(candidate_id)
        if not candidate:
            continue
        candidate.update(changes)
        if payload.stage is not None:
            candidate["stage_changed_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        db.save_candidate(candidate)
        updated.append(candidate_id)
    return {"updated": updated, "count": len(updated)}


@app.post("/api/candidates/{candidate_id}/feedback")
def add_interview_feedback(candidate_id: str, payload: CandidateFeedbackCreate):
    candidate = db.get_candidate(candidate_id)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    feedback = candidate.setdefault("interview_feedback", [])
    feedback.append({
        **payload.dict(exclude_none=True),
        "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    })
    if candidate.get("stage") in ("SHORTLISTED", "INTERVIEW", "INTERVIEW_SCHEDULED"):
        candidate["stage"] = "INTERVIEW_FEEDBACK"
    db.save_candidate(candidate)
    return candidate


@app.get("/api/candidates/{candidate_id}/handoff")
def candidate_handoff(candidate_id: str):
    """A compact, shareable packet for a hiring-manager review."""
    candidate = db.get_candidate(candidate_id)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    job = db.get_job(candidate["job_id"])
    return {
        "job": {"title": job.get("title"), "requirements": job.get("requirements", {})} if job else None,
        "candidate": candidate,
        "prepared_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    }


@app.post("/api/candidates/{candidate_id}/outreach")
async def prepare_candidate_outreach(candidate_id: str, request: Request):
    """Prepare and record a recruiter-approved outreach template; this endpoint never sends messages itself."""
    candidate = db.get_candidate(candidate_id)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    if candidate.get("consent_status") == "DO_NOT_CONTACT":
        raise HTTPException(status_code=409, detail="This candidate has opted out of contact")
    body = await request.json()
    message_type = body.get("type", "INTERVIEW_INVITE")
    job = db.get_job(candidate["job_id"]) or {}
    title = job.get("title", "this role")
    templates = {
        "INTERVIEW_INVITE": f"Hi {candidate['name']}, thank you for speaking with us about the {title} role. We would like to invite you to the next interview. Please share a few convenient time slots.",
        "FOLLOW_UP": f"Hi {candidate['name']}, following up on the {title} opportunity. Please let us know whether you would like to continue in the process.",
        "ON_HOLD": f"Hi {candidate['name']}, thank you for your interest in the {title} role. Our team is finalizing the next steps and we will update you soon.",
        "DECLINE": f"Hi {candidate['name']}, thank you for taking the time to speak with us about the {title} role. We have decided not to move forward at this time, and we appreciate your interest."
    }
    message = templates.get(message_type, templates["FOLLOW_UP"])
    candidate.setdefault("outreach_log", []).append({
        "type": message_type,
        "message": message,
        "prepared_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    })
    db.save_candidate(candidate)
    return {"message": message, "candidate": candidate}


@app.delete("/api/candidates/{candidate_id}")
def delete_candidate(candidate_id: str):
    candidate = db.get_candidate(candidate_id)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    db.delete_candidate(candidate_id)
    return {"status": "deleted"}

@app.patch("/api/candidates/{candidate_id}")
def update_candidate(candidate_id: str, payload: CandidateUpdate):
    candidate = db.get_candidate(candidate_id)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    # Keep this deliberately constrained to the recruiter-controlled fields;
    # call outcomes continue to be written only by Hunar webhooks.
    for field, value in payload.dict(exclude_none=True).items():
        candidate[field] = value
    if payload.stage is not None:
        candidate["stage_changed_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    db.save_candidate(candidate)
    return candidate

# ─────────────────────────────────────────────────────────────
# HUNAR VOICE AGENTS
# ─────────────────────────────────────────────────────────────

@app.get("/api/agents")
def list_agents():
    """List all Hunar voice agents for this account."""
    return hunar.list_hunar_agents()


@app.get("/api/agents/{agent_id}")
def get_agent(agent_id: str):
    """Get a single Hunar agent by ID."""
    agent = hunar.get_hunar_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


@app.post("/api/agents")
def create_agent(payload: AgentCreate):
    """Create a new Hunar voice agent."""
    agent_payload = {
        "name": payload.name,
        "language": payload.language,
        "voice_persona": payload.voice_persona,
        "persona_name": payload.persona_name,
        "agent_prompt": payload.agent_prompt,
        "introduction": payload.introduction,
        "objective": payload.objective,
        "silence_response": payload.silence_response,
        "conclusion": payload.conclusion,
        "result_prompt": payload.result_prompt,
        "custom_variables": payload.custom_variables,
        "result_schema": payload.result_schema,
        "max_call_duration_seconds": payload.max_call_duration_seconds,
        "max_retries": payload.max_retries,
        "retry_delay_seconds": payload.retry_delay_seconds,
        "timezone": payload.timezone,
        "calling_hours_start": payload.calling_hours_start,
        "calling_hours_end": payload.calling_hours_end,
        "do_not_call_topics": payload.do_not_call_topics,
    }
    
    result = hunar.create_hunar_agent(agent_payload)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result
@app.patch("/api/agents/{agent_id}")
def update_agent(agent_id: str, payload: AgentUpdate):
    """Update an existing Hunar voice agent (partial update)."""
    update_data = {k: v for k, v in payload.dict().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields provided to update")
    result = hunar.update_hunar_agent(agent_id, update_data)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.get("/api/jobs/{job_id}/suggested-agent")
def get_suggested_agent_config(job_id: str):
    """
    Returns a pre-filled agent config suggestion based on the job's parsed requirements.
    Frontend uses this to pre-populate the Create Agent form.
    """
    job = db.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job.get("agent_config", {})

@app.post("/api/candidates/{candidate_id}/enrich")
def enrich_candidate_endpoint(candidate_id: str):
    candidate = db.get_candidate(candidate_id)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
        
    res = apollo.enrich_candidate(
        first_name=candidate.get("first_name", ""),
        last_name=candidate.get("last_name", ""),
        company=candidate.get("job_company_name", ""),
        linkedin_url=candidate.get("linkedin_url", "")
    )
    
    if res and (res.get("phone_numbers") or res.get("mobile_phone")):
        phones = res.get("phone_numbers", [])
        mobile = res.get("mobile_phone")
        raw_phone = mobile if mobile else (phones[0] if phones else "")
        if raw_phone:
            # We found a real phone number
            candidate["phone"] = raw_phone
            if res.get("work_email"):
                candidate["email"] = res.get("work_email")
            db.save_candidate(candidate)
            return {"success": True, "phone": raw_phone, "email": candidate.get("email")}
            
    # If no real phone number found, we can just throw an error or return false
    return {"success": False, "message": "No contact information found"}


# ─────────────────────────────────────────────────────────────
# OUTBOUND CALLS — SINGLE

# ─────────────────────────────────────────────────────────────

@app.post("/api/candidates/reachout")
def trigger_reachout(payload: CallTrigger):
    candidate = db.get_candidate(payload.candidate_id)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
        
    job = db.get_job(candidate["job_id"])
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
        
    phone_to_call = hunar.normalize_phone(payload.phone_override or candidate["phone"])
    if not phone_to_call:
        # Fall back to raw value if normalization yields empty (let Hunar reject with clearer error)
        phone_to_call = payload.phone_override or candidate["phone"]
    
    jd_summary = (
        f"Role: {job['requirements'].get('title', 'the role')}. "
        f"Skills: {', '.join(job['requirements'].get('skills', [])[:5])}. "
        f"Experience: {job['requirements'].get('experience_years', 2)}+ years."
    )
    
    custom_data = {
        "company": "Our Company",
        "job_title": job["requirements"].get("title", "Developer"),
        "jd_summary": jd_summary,
        "job_role": job["requirements"].get("title", "Developer"),
        "skills_list": ", ".join(job["requirements"].get("skills", []))
    }
    
    call_res = hunar.trigger_hunar_call(
        agent_id=payload.agent_id,
        callee_name=candidate["name"],
        mobile_number=phone_to_call,
        custom_data=custom_data,
        public_webhook_base_url=PUBLIC_WEBHOOK_URL
    )
    
    if "error" in call_res:
        raise HTTPException(status_code=400, detail=call_res["error"])
        
    candidate["call_id"] = call_res.get("id")
    candidate["call_status"] = call_res.get("status", "INITIATED")
    candidate["agent_id"] = payload.agent_id
    db.save_candidate(candidate)
    
    return {"candidate": candidate, "hunar_response": call_res}


# ─────────────────────────────────────────────────────────────
# OUTBOUND CALLS — BULK
# ─────────────────────────────────────────────────────────────

@app.post("/api/calls/bulk")
def trigger_bulk_calls(payload: BulkCallTrigger, background_tasks: BackgroundTasks):
    """
    Trigger outbound calls for all (or selected) NOT_STARTED candidates of a job.
    Uses the specified Hunar agent_id.
    """
    job = db.get_job(payload.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    all_candidates = db.list_candidates(payload.job_id)
    
    # Filter to only candidates that haven't been called yet
    if payload.candidate_ids:
        targets = [c for c in all_candidates if c["id"] in payload.candidate_ids and c["call_status"] == "NOT_STARTED"]
    else:
        targets = [c for c in all_candidates if c["call_status"] == "NOT_STARTED"]
    
    if not targets:
        return {"status": "no_candidates", "message": "No NOT_STARTED candidates found for this job", "triggered": 0}
    
    # Mark all as INITIATED immediately so the UI reflects the change
    for cand in targets:
        cand["call_status"] = "INITIATED"
        cand["agent_id"] = payload.agent_id
        db.save_candidate(cand)
    
    # Run actual calls in background
    background_tasks.add_task(
        _run_bulk_calls_task,
        targets,
        payload.agent_id,
        job["requirements"]
    )
    
    return {
        "status": "bulk_call_initiated",
        "agent_id": payload.agent_id,
        "triggered": len(targets),
        "candidate_ids": [c["id"] for c in targets]
    }


def _run_bulk_calls_task(candidates: List[dict], agent_id: str, job_requirements: dict):
    """Background task: trigger Hunar calls for each candidate."""
    results = hunar.trigger_bulk_calls(
        agent_id=agent_id,
        candidates=candidates,
        job_requirements=job_requirements,
        public_webhook_base_url=PUBLIC_WEBHOOK_URL
    )
    
    # Update each candidate with their call ID
    for r in results:
        cand = db.get_candidate(r["candidate_id"])
        if cand:
            call_res = r["call_result"]
            if "error" not in call_res:
                cand["call_id"] = call_res.get("id")
                cand["call_status"] = call_res.get("status", "INITIATED")
            else:
                cand["call_status"] = "FAILED"
                print(f"Call failed for candidate {cand['id']}: {call_res.get('error')}")
            db.save_candidate(cand)


# ─────────────────────────────────────────────────────────────
# WEBHOOKS
# ─────────────────────────────────────────────────────────────

@app.get("/api/webhooks/hunar")
def hunar_webhook_health():
    """Public tunnel check that exposes no credentials."""
    return {"status": "ready", "webhook": "hunar"}

@app.post("/api/webhooks/hunar")
async def hunar_webhook(
    request: Request,
    x_hunar_signature: Optional[str] = Header(None),
    x_hunar_timestamp: Optional[str] = Header(None)
):
    raw_body = await request.body()
    
    HUNAR_API_KEY = os.getenv("HUNAR_API_KEY", "")
    if HUNAR_API_KEY:
        valid = hunar.verify_hunar_webhook_signature(
            signature_header=x_hunar_signature,
            timestamp_header=x_hunar_timestamp,
            request_body=raw_body,
            trusted_api_keys=[HUNAR_API_KEY]
        )
        if not valid:
            print("Warning: Webhook signature validation failed — proceeding anyway for dev.")
            # Don't hard-reject in development; signature check is best-effort
    
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
        
    # Hunar callback payloads can arrive either at the top level or wrapped in
    # a `data` object, depending on the callback/event version. Normalise both
    # forms before matching the result to the candidate that initiated the call.
    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    event_type = (
        payload.get("event_type") or payload.get("event") or payload.get("type")
        or data.get("event_type") or data.get("event") or data.get("type")
    )
    call_id = (
        payload.get("call_id") or payload.get("call_uuid") or payload.get("callId")
        or data.get("call_id") or data.get("call_uuid") or data.get("callId")
    )
    event_type = str(event_type or "").lower()
    
    print(f"Webhook received: event={event_type} call_id={call_id}")
    
    if not call_id:
        return {"status": "ignored", "reason": "No call_id present"}
        
    candidate = db.get_candidate_by_call_id(call_id)
    if not candidate:
        print(f"Warning: Webhook received for unknown call_id={call_id}")
        return {"status": "ignored", "reason": "Call not found"}
        
    job = db.get_job(candidate["job_id"])
    
    status = data.get("status") or data.get("call_status") or payload.get("status")
    recording_url = data.get("recording_url") or data.get("recording") or payload.get("recording_url")
    answers = data.get("result") or data.get("call_result") or payload.get("result") or payload.get("call_result")

    if event_type in ("call_status_updated", "call_status", "status_updated"):
        candidate["call_status"] = status or "COMPLETED"
    elif event_type in ("call_recording_done", "recording_done", "call_recording"):
        candidate["recording_url"] = recording_url
    elif event_type in ("call_result_done", "result_done", "call_result"):
        answers = answers or {}
        candidate["answers"] = answers
        if job:
            candidate["evaluation"] = ai.evaluate_candidate_results(answers, job["requirements"])
            if candidate.get("stage") in (None, "SOURCED", "SCREENED"):
                candidate["stage"] = "SHORTLISTED" if candidate["evaluation"].get("decision") == "ADVANCE" else "SCREENED"
                candidate["stage_changed_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    elif event_type in ("call_summary", "summary", "call_completed", "completed"):
        candidate["call_status"] = status or "COMPLETED"
        candidate["recording_url"] = recording_url
        answers = answers or {}
        candidate["answers"] = answers
        if job:
            candidate["evaluation"] = ai.evaluate_candidate_results(answers, job["requirements"])
            if candidate.get("stage") in (None, "SOURCED", "SCREENED"):
                candidate["stage"] = "SHORTLISTED" if candidate["evaluation"].get("decision") == "ADVANCE" else "SCREENED"
                candidate["stage_changed_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    elif status:
        # Preserve terminal status even if Hunar introduces a new event label.
        candidate["call_status"] = status
            
    db.save_candidate(candidate)
    return {"status": "processed", "event_type": event_type}


# ─────────────────────────────────────────────────────────────
# SIMULATION & TESTING
# ─────────────────────────────────────────────────────────────

def run_simulated_call_sequence(candidate_id: str):
    candidate = db.get_candidate(candidate_id)
    if not candidate:
        return
        
    time.sleep(3)
    candidate["call_status"] = "RINGING"
    db.save_candidate(candidate)
    
    time.sleep(3)
    candidate["call_status"] = "IN_PROGRESS"
    db.save_candidate(candidate)
    
    time.sleep(5)
    candidate["call_status"] = "COMPLETED"
    candidate["recording_url"] = "https://recordings.hunar.ai/mock_audio_rec.mp3"
    
    job = db.get_job(candidate["job_id"])
    skills_map = {}
    if job:
        for skill in job["requirements"].get("skills", [])[:3]:
            skills_map[skill.lower().replace(" ", "_").replace(".", "")] = int(7 + (3 * (candidate["id"][-1] in "02468")))
            
    answers = {
        "experience": 3.0,
        "communication": 8,
        "notice_period": 30,
        "salary_expectation": 1500000,
        "expected_ctc": "15 LPA",
        "years_of_experience": "3",
        "interested": "Yes",
        "summary": "Candidate is interested in the role. Has relevant experience and skills. Notice period is 30 days.",
        **skills_map
    }
    candidate["answers"] = answers
    if job:
        candidate["evaluation"] = ai.evaluate_candidate_results(answers, job["requirements"])
        if candidate.get("stage") in (None, "SOURCED", "SCREENED"):
            candidate["stage"] = "SHORTLISTED" if candidate["evaluation"].get("decision") == "ADVANCE" else "SCREENED"
            candidate["stage_changed_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        
    db.save_candidate(candidate)


@app.post("/api/candidates/{candidate_id}/simulate")
def simulate_call(candidate_id: str, background_tasks: BackgroundTasks):
    candidate = db.get_candidate(candidate_id)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
        
    candidate["call_id"] = f"sim_{str(uuid.uuid4())[:8]}"
    candidate["call_status"] = "INITIATED"
    db.save_candidate(candidate)
    
    background_tasks.add_task(run_simulated_call_sequence, candidate_id)
    return {"status": "simulation_started", "candidate": candidate}
