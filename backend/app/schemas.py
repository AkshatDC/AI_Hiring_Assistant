from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional

class JobCreate(BaseModel):
    title: str
    description: str

class SourcingSearchQuery(BaseModel):
    title: Optional[str] = None
    skills: Optional[List[str]] = None
    location: Optional[str] = None
    experience_years: Optional[int] = None
    size: int = 10
    pipeline_limit: Optional[int] = None  # max candidates to add to pipeline (AI ranked)

class CandidateCreate(BaseModel):
    job_id: str
    name: str
    phone: str
    email: Optional[str] = None
    pdl_id: Optional[str] = None
    title: Optional[str] = None
    company: Optional[str] = None
    skills: List[str] = []

class CandidateUpdate(BaseModel):
    phone: Optional[str] = None
    # Post-screening hiring workflow fields.  These stay optional so existing
    # candidate records remain compatible.
    stage: Optional[str] = None
    recruiter_notes: Optional[str] = None
    follow_up_at: Optional[str] = None
    follow_up_status: Optional[str] = None
    interview_feedback: Optional[List[Dict[str, Any]]] = None
    offer: Optional[Dict[str, Any]] = None
    consent_status: Optional[str] = None
    preferred_contact_time: Optional[str] = None
    outreach_log: Optional[List[Dict[str, Any]]] = None

class CandidateFeedbackCreate(BaseModel):
    interviewer: str
    recommendation: str
    notes: str = ""
    score: Optional[int] = None

class BulkCandidateUpdate(BaseModel):
    candidate_ids: List[str]
    stage: Optional[str] = None
    follow_up_at: Optional[str] = None
    follow_up_status: Optional[str] = None

class CallTrigger(BaseModel):
    candidate_id: str
    agent_id: str
    phone_override: Optional[str] = None

class BulkCallTrigger(BaseModel):
    job_id: str
    agent_id: str
    candidate_ids: Optional[List[str]] = None  # if None, calls ALL NOT_STARTED candidates for the job

class AgentCreate(BaseModel):
    name: str
    language: str = "ENGLISH"
    voice_persona: str = "NEHA"
    persona_name: str = "Seema"
    agent_prompt: str
    introduction: str
    objective: str
    silence_response: str = "Are you there?"
    conclusion: str = "Have a wonderful day!"
    result_prompt: str
    custom_variables: List[str] = ["callee_name", "job_title", "company", "jd_summary"]
    result_schema: Dict[str, Any] = {
        "interested": "",
        "notice_period": "",
        "expected_ctc": "",
        "years_of_experience": "",
        "summary": ""
    }
    # Call controls and safety guardrails exposed by the v1 agent UI.
    max_call_duration_seconds: Optional[int] = None
    max_retries: Optional[int] = None
    retry_delay_seconds: Optional[int] = None
    timezone: Optional[str] = None
    calling_hours_start: Optional[str] = None
    calling_hours_end: Optional[str] = None
    do_not_call_topics: Optional[List[str]] = None

class AgentUpdate(BaseModel):
    name: Optional[str] = None
    language: Optional[str] = None
    voice_persona: Optional[str] = None
    persona_name: Optional[str] = None
    agent_prompt: Optional[str] = None
    introduction: Optional[str] = None
    objective: Optional[str] = None
    silence_response: Optional[str] = None
    conclusion: Optional[str] = None
    result_prompt: Optional[str] = None
    custom_variables: Optional[List[str]] = None
    result_schema: Optional[Dict[str, Any]] = None
    # Guardrails / call control
    max_call_duration_seconds: Optional[int] = None  # max call length in seconds
    max_retries: Optional[int] = None               # retries if no answer
    retry_delay_seconds: Optional[int] = None        # wait between retries
    timezone: Optional[str] = None                   # calling timezone
    calling_hours_start: Optional[str] = None        # e.g. "09:00"
    calling_hours_end: Optional[str] = None          # e.g. "18:00"
    do_not_call_topics: Optional[List[str]] = None   # guardrail topic list
