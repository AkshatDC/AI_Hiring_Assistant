import os
import json
import re
import google.generativeai as genai
from typing import Dict, Any, Optional

# NOTE: Do NOT read GEMINI_API_KEY at module level — load_dotenv() in main.py
# must run first. Read it lazily inside each function instead.

def _get_gemini_key() -> str:
    """Lazily fetch and configure Gemini so load_dotenv() has already run."""
    key = os.getenv("GEMINI_API_KEY", "")
    if key:
        genai.configure(api_key=key)
    return key

def extract_jd_requirements(jd_text: str) -> Dict[str, Any]:
    """
    Uses Gemini (or fallback rule parser) to extract key details from the Job Description.
    """
    GEMINI_API_KEY = _get_gemini_key()
    if not GEMINI_API_KEY:
        # High fidelity fallback rules
        skills = []
        for s in ["React", "Python", "SQL", "TypeScript", "Node.js", "Docker", "AWS", "FastAPI", "Django"]:
            if re.search(r'\b' + re.escape(s) + r'\b', jd_text, re.IGNORECASE):
                skills.append(s)
        
        # Heuristics for title
        title = "Software Engineer"
        title_match = re.search(r'(React Engineer|Frontend Developer|Backend Engineer|Data Scientist|Product Manager|Fullstack Developer)', jd_text, re.IGNORECASE)
        if title_match:
            title = title_match.group(1).strip()
            
        experience = 2.0
        exp_match = re.search(r'(\d+)\+?\s*(years?|yrs?)', jd_text, re.IGNORECASE)
        if exp_match:
            experience = float(exp_match.group(1))

        return {
            "title": title,
            "skills": skills if skills else ["Python", "SQL"],
            "experience_years": experience,
            "location": "Remote / Bengaluru" if "remote" in jd_text.lower() else "Bengaluru, India",
            "education": "Bachelor's in Computer Science or equivalent",
            "target_salary": "Competitive",
            "notice_period_days": 30,
            "technical_requirements": "FastAPI, Git, and REST APIs"
        }

    try:
        model = genai.GenerativeModel('gemini-2.5-flash')
        prompt = f"""
        Analyze the following Job Description (JD) and extract details into a structured JSON format.
        Return ONLY valid JSON. Do not include markdown code block formatting or any other text.
        
        JSON schema:
        {{
            "title": "Extracted target job title",
            "skills": ["List of core skills required"],
            "experience_years": 3.5, (float value of minimum years required)
            "location": "Preferred job location",
            "education": "Education requirements",
            "target_salary": "Salary mention or competitive",
            "notice_period_days": 30, (default notice period or parsed)
            "technical_requirements": "Summary of technical environment"
        }}

        Job Description:
        {jd_text}
        """
        response = model.generate_content(prompt)
        text = response.text.strip()
        # strip markdown blocks if model generated them anyway
        if text.startswith("```json"):
            text = text.replace("```json", "", 1)
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
        return json.loads(text)
    except Exception as e:
        print(f"Gemini JD Extraction failed: {e}")
        # Default empty structure
        return {
            "title": "Software Engineer",
            "skills": ["Python", "JavaScript"],
            "experience_years": 2.0,
            "location": "Remote",
            "education": "B.Tech/B.E",
            "target_salary": "Competitive",
            "notice_period_days": 30,
            "technical_requirements": "Not specified"
        }

def _number(value: Any) -> Optional[float]:
    """Parse numeric call answers such as `3 years` without treating text as zero."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    match = re.search(r"-?\d+(?:\.\d+)?", str(value))
    return float(match.group()) if match else None


def _answer(candidate_answers: Dict[str, Any], *keys: str) -> Any:
    lowered = {str(key).lower(): value for key, value in candidate_answers.items()}
    for key in keys:
        if key in lowered and lowered[key] not in (None, ""):
            return lowered[key]
    return None


def _is_interested(value: Any) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    if value is None:
        return None
    normalized = str(value).strip().lower()
    if normalized in {"yes", "y", "true", "interested", "positive"}:
        return True
    if normalized in {"no", "n", "false", "not interested", "declined"}:
        return False
    return None


def _clamp_score(value: Any, default: int = 50) -> int:
    number = _number(value)
    if number is None:
        return default
    if number <= 10:
        number *= 10
    return max(0, min(100, round(number)))


def _heuristic_evaluation(candidate_answers: Dict[str, Any], jd_requirements: Dict[str, Any]) -> Dict[str, Any]:
    """Produce a conservative, explainable evaluation when AI output is unavailable."""
    experience = _number(_answer(candidate_answers, "experience", "years_of_experience"))
    required_experience = _number(jd_requirements.get("experience_years")) or 0
    experience_score = 50 if experience is None else (
        100 if required_experience == 0 else _clamp_score((experience / required_experience) * 100)
    )

    communication_value = _answer(candidate_answers, "communication", "communication_score")
    communication_score = _clamp_score(communication_value, 50)

    required_skills = [str(skill).lower().replace(".", "") for skill in jd_requirements.get("skills", [])]
    measured_skills = []
    missing_skills = []
    for skill in required_skills:
        value = _answer(candidate_answers, skill, skill.replace(" ", "_"), skill.replace("-", "_"))
        if value is None:
            missing_skills.append(skill)
        else:
            measured_skills.append(_clamp_score(value))
    technical_score = round(sum(measured_skills) / len(measured_skills)) if measured_skills else 45

    notice = _number(_answer(candidate_answers, "notice_period", "notice_period_days"))
    permitted_notice = _number(jd_requirements.get("notice_period_days")) or 30
    requirements_score = 60 if notice is None else (100 if notice <= permitted_notice else max(30, 100 - round((notice - permitted_notice) * 1.5)))
    interest = _is_interested(_answer(candidate_answers, "interested", "interest"))
    if interest is False:
        requirements_score = min(requirements_score, 20)
    elif interest is None:
        requirements_score = min(requirements_score, 70)

    overall_score = round(
        technical_score * 0.40 + experience_score * 0.25 + communication_score * 0.15 + requirements_score * 0.20
    )
    risks = []
    if interest is False:
        risks.append("Candidate is not interested in progressing.")
    if not measured_skills:
        risks.append("No required technical skills were scored during screening.")
    elif missing_skills:
        risks.append("Validate unscored skills: " + ", ".join(missing_skills[:3]) + ".")
    if experience is None:
        risks.append("Years of experience were not confirmed.")
    if notice is None:
        risks.append("Notice period was not confirmed.")
    elif notice > permitted_notice:
        risks.append(f"Notice period is {round(notice)} days vs {round(permitted_notice)} day target.")

    if interest is False:
        decision = "DECLINE"
    elif not measured_skills or experience is None or notice is None:
        decision = "HOLD"
    elif overall_score >= 75 and technical_score >= 65 and experience_score >= 65 and requirements_score >= 60:
        decision = "ADVANCE"
    else:
        decision = "HOLD"

    strengths = []
    if technical_score >= 65:
        strengths.append(f"Technical screening score: {technical_score}/100.")
    if experience_score >= 80:
        strengths.append("Meets or exceeds the experience requirement.")
    if communication_score >= 70:
        strengths.append("Clear communication signal from the screening call.")

    return {
        "overall_score": overall_score,
        "technical_score": technical_score,
        "communication_score": communication_score,
        "experience_score": experience_score,
        "requirements_score": requirements_score,
        "recommendation": "SHORTLIST" if decision == "ADVANCE" else "REJECT",
        "decision": decision,
        "confidence": "HIGH" if len(risks) <= 1 else "MEDIUM" if len(risks) <= 3 else "LOW",
        "strengths": strengths,
        "risks": risks,
        "interview_focus": [
            "Validate the most important job-specific technical skill with a practical example.",
            "Clarify scope of ownership and measurable outcomes in the most relevant role.",
            "Confirm availability, notice period, and compensation expectations."
        ],
        "justification": f"{decision.title()} based on a weighted score of {overall_score}/100. " + (
            "; ".join(risks) if risks else "Screening evidence meets the advance criteria."
        )
    }


def evaluate_candidate_results(candidate_answers: Dict[str, Any], jd_requirements: Dict[str, Any]) -> Dict[str, Any]:
    """Evaluate screening evidence with explicit gates, then enrich it with Gemini when available."""
    baseline = _heuristic_evaluation(candidate_answers, jd_requirements)
    GEMINI_API_KEY = _get_gemini_key()
    if not GEMINI_API_KEY:
        return baseline

    try:
        model = genai.GenerativeModel('gemini-2.0-flash')
        prompt = f"""
        Summarize the screening evidence for a recruiter. Do not invent facts that are not in the answers.
        Return ONLY valid JSON. Do not include markdown code block formatting or any other text.
        
        JSON schema:
        {{
            "strengths": ["Evidence-backed strength"],
            "risks": ["Evidence gap or practical risk"],
            "interview_focus": ["Specific follow-up question or validation topic"],
            "justification": "Short evidence-based recruiter summary."
        }}

        JD Requirements:
        {json.dumps(jd_requirements, indent=2)}

        Candidate Call Screening Answers:
        {json.dumps(candidate_answers, indent=2)}
        """
        response = model.generate_content(prompt)
        text = response.text.strip()
        if text.startswith("```json"):
            text = text.replace("```json", "", 1)
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
        qualitative = json.loads(text)
        for field in ("strengths", "risks", "interview_focus"):
            if isinstance(qualitative.get(field), list):
                baseline[field] = [str(item) for item in qualitative[field][:3] if str(item).strip()]
        if isinstance(qualitative.get("justification"), str) and qualitative["justification"].strip():
            baseline["justification"] = qualitative["justification"].strip()
        return baseline
    except Exception as e:
        print(f"Gemini candidate evaluation failed: {e}")
        return baseline


def rank_candidates(
    candidates: list,
    job_requirements: dict,
    limit: int
) -> list:
    """
    Scores and ranks a list of sourced candidate profiles against JD requirements.
    Returns the top `limit` candidates sorted by relevance score (descending).
    Uses Gemini if available; falls back to heuristic scoring.
    """
    if not candidates:
        return []
    limit = max(1, limit)

    GEMINI_API_KEY = _get_gemini_key()
    if not GEMINI_API_KEY:
        # Heuristic fallback: score by skill overlap
        req_skills = set(s.lower() for s in job_requirements.get('skills', []))
        def _heuristic_score(cand):
            cand_skills = set(s.lower() for s in (cand.get('skills') or []))
            overlap = len(req_skills & cand_skills)
            has_phone = 1 if (cand.get('mobile_phone') or cand.get('phone_numbers')) else 0
            return overlap * 10 + has_phone * 5
        scored = sorted(candidates, key=_heuristic_score, reverse=True)
        return scored[:limit]

    try:
        # Build a slim profile list for the prompt to keep token count low
        slim_profiles = [
            {
                "idx": i,
                "name": c.get('full_name') or f"{c.get('first_name','')} {c.get('last_name','')}".strip(),
                "title": c.get('job_title', ''),
                "company": c.get('job_company_name', ''),
                "skills": (c.get('skills') or [])[:8],
                "location": c.get('location_name', ''),
                "has_phone": bool(c.get('mobile_phone') or c.get('phone_numbers'))
            }
            for i, c in enumerate(candidates)
        ]
        model = genai.GenerativeModel('gemini-2.5-flash')
        prompt = f"""
You are a recruiter assistant. Score and rank candidate profiles against the JD requirements below.
Return ONLY a JSON array of objects with keys 'idx' (integer, the candidate index) and 'score' (integer 0-100).
Do not include markdown formatting or extra text.

JD Requirements:
{json.dumps(job_requirements, indent=2)}

Candidate Profiles:
{json.dumps(slim_profiles, indent=2)}
"""
        response = model.generate_content(prompt)
        text = response.text.strip()
        if text.startswith('```'):
            text = re.sub(r'^```[a-z]*', '', text).rstrip('`').strip()
        rankings = json.loads(text)  # [{"idx": 0, "score": 85}, ...]
        # Sort by score desc, pick top `limit`
        rankings.sort(key=lambda x: x.get('score', 0), reverse=True)
        top_indices = [r['idx'] for r in rankings[:limit] if 0 <= r['idx'] < len(candidates)]
        return [candidates[i] for i in top_indices]
    except Exception as e:
        print(f"Gemini candidate ranking failed: {e} — falling back to heuristic")
        req_skills = set(s.lower() for s in job_requirements.get('skills', []))
        def _heuristic_score(cand):
            cand_skills = set(s.lower() for s in (cand.get('skills') or []))
            return len(req_skills & cand_skills)
        return sorted(candidates, key=_heuristic_score, reverse=True)[:limit]
