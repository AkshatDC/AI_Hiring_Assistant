import os
import re
import hmac
import hashlib
import base64
import requests
import time
from typing import Optional, List, Dict, Any
from app.runtime import get_credential

BASE_URL = "https://api.voice.hunar.ai/external/v1"

VOICE_PERSONAS = ["NEHA", "ROY", "PRIYA", "ARJUN", "ANANYA", "RAVI"]
LANGUAGES = ["ENGLISH", "HINDI", "HINGLISH"]


def normalize_phone(phone: str) -> str:
    """
    Normalize a phone number to E.164 format as required by Hunar AI.
    - Strips all non-digit characters except leading '+'
    - If no country code present and looks like a 10-digit Indian number, prepends +91
    - Returns the cleaned number or empty string if unparseable.
    """
    if not phone or phone in ('Unknown', '', 'None', 'null'):
        return ''
    # Remove all chars except digits and leading +
    cleaned = re.sub(r'[^\d+]', '', phone.strip())
    # If starts with +, keep as-is (already E.164)
    if cleaned.startswith('+'):
        digits = cleaned[1:]
        if len(digits) >= 10:
            return cleaned
        return ''
    # If starts with 91 followed by 10 digits => India
    if cleaned.startswith('91') and len(cleaned) == 12:
        return '+' + cleaned
    # If starts with 0 => drop leading 0, assume India
    if cleaned.startswith('0') and len(cleaned) == 11:
        return '+91' + cleaned[1:]
    # If exactly 10 digits => assume India
    if len(cleaned) == 10 and cleaned[0] in '6789':
        return '+91' + cleaned
    # If 11+ digits treat as international (add +)
    if len(cleaned) >= 11:
        return '+' + cleaned
    return ''


def _get_hunar_key() -> str:
    """Lazily fetch Hunar API key so load_dotenv() in main.py has already run."""
    return get_credential("HUNAR_API_KEY", "")


def verify_hunar_webhook_signature(
    signature_header: Optional[str],
    timestamp_header: Optional[str],
    request_body: bytes,
    trusted_api_keys: List[str]
) -> bool:
    """
    Validates X-Hunar-Signature against request body and timestamp header.
    Message format: timestamp. + raw_body
    """
    if not signature_header or not timestamp_header:
        return False
        
    timestamp = timestamp_header.strip()
    signatures = [sig.strip() for sig in signature_header.split(",") if sig.strip()]
    
    for api_key in trusted_api_keys:
        message = f"{timestamp}.".encode("utf-8") + request_body
        digest = hmac.new(api_key.encode("utf-8"), message, hashlib.sha256).digest()
        computed = base64.b64encode(digest).decode("ascii")
        
        for signature in signatures:
            if hmac.compare_digest(signature, computed):
                return True
                
    return False


def list_hunar_agents() -> List[Dict[str, Any]]:
    """Lists all voice agents configured in Hunar AI account."""
    HUNAR_API_KEY = _get_hunar_key()
    
    if not HUNAR_API_KEY:
        return [
            {
                "id": "agent-uuid-mock-recruiter",
                "name": "Screening Recruiter Agent (Seema) [MOCK]",
                "voice_persona": "NEHA",
                "persona_name": "Seema",
                "language": "ENGLISH",
                "custom_variables": ["company", "job_role", "jd_summary"],
                "result_schema": {"interested": "", "notice_period": "", "expected_ctc": "", "summary": ""},
                "summary": "Mock agent for sandbox testing.",
                "status": "ACTIVE"
            }
        ]
        
    headers = {"X-API-Key": HUNAR_API_KEY}
    
    try:
        # Use page_size=100 to fetch all agents in a single request (account has <100 agents typically)
        response = requests.get(f"{BASE_URL}/agents/?page_size=100", headers=headers, timeout=15)
        if response.status_code == 200:
            data = response.json()
            return data.get("results", [])
        print(f"Listing Hunar agents failed. Status={response.status_code} Text={response.text}")
        return []
    except Exception as e:
        print(f"Exception listing Hunar agents: {e}")
        return []


def get_hunar_agent(agent_id: str) -> Optional[Dict[str, Any]]:
    """Fetch a single Hunar agent by ID."""
    HUNAR_API_KEY = _get_hunar_key()
    if not HUNAR_API_KEY:
        return None
    
    headers = {"X-API-Key": HUNAR_API_KEY}
    try:
        response = requests.get(f"{BASE_URL}/agents/{agent_id}/", headers=headers, timeout=10)
        if response.status_code == 200:
            return response.json()
        print(f"Get Hunar agent failed. Status={response.status_code} Text={response.text}")
        return None
    except Exception as e:
        print(f"Exception getting Hunar agent: {e}")
        return None


def create_hunar_agent(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Creates a new voice agent in Hunar AI.
    payload keys: name, language, voice_persona, persona_name,
                  agent_prompt, introduction, objective,
                  silence_response, conclusion, result_prompt,
                  custom_variables, result_schema
    """
    HUNAR_API_KEY = _get_hunar_key()
    
    if not HUNAR_API_KEY:
        print("HUNAR_API_KEY not configured. Cannot create agent.")
        return {"error": "Hunar API key not configured", "mock": True}
    
    headers = {
        "X-API-Key": HUNAR_API_KEY,
        "Content-Type": "application/json"
    }
    
    # Avoid sending unset optional controls as JSON null; Hunar validates agent
    # payloads strictly, while the UI can leave any guardrail unset.
    clean_payload = {key: value for key, value in payload.items() if value is not None}
    try:
        response = requests.post(f"{BASE_URL}/agents/", headers=headers, json=clean_payload, timeout=15)
        if response.status_code in (200, 201):
            return response.json()
        print(f"Create Hunar agent failed. Status={response.status_code} Text={response.text}")
        return {"error": response.text, "status_code": response.status_code}
    except Exception as e:
        print(f"Exception creating Hunar agent: {e}")
        return {"error": str(e)}
def update_hunar_agent(agent_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Updates an existing Hunar voice agent via PATCH.
    Only sends non-None fields.
    """
    HUNAR_API_KEY = _get_hunar_key()
    if not HUNAR_API_KEY:
        return {"error": "Hunar API key not configured"}

    headers = {
        "X-API-Key": HUNAR_API_KEY,
        "Content-Type": "application/json"
    }
    # Filter out None values — only patch what was provided
    clean_payload = {k: v for k, v in payload.items() if v is not None}
    try:
        response = requests.patch(f"{BASE_URL}/agents/{agent_id}/", headers=headers, json=clean_payload, timeout=15)
        if response.status_code in (200, 201, 204):
            # 204 returns no body
            if response.status_code == 204:
                return {"id": agent_id, "status": "updated"}
            return response.json()
        print(f"Update Hunar agent failed. Status={response.status_code} Text={response.text}")
        return {"error": response.text, "status_code": response.status_code}
    except Exception as e:
        print(f"Exception updating Hunar agent: {e}")
        return {"error": str(e)}



def trigger_hunar_call(
    agent_id: str,
    callee_name: str,
    mobile_number: str,
    custom_data: Dict[str, Any],
    public_webhook_base_url: str
) -> Dict[str, Any]:
    """Calls POST /calls/ to trigger a single outbound call via Hunar AI."""
    HUNAR_API_KEY = _get_hunar_key()
    
    if not HUNAR_API_KEY:
        print("HUNAR_API_KEY not configured. Running in Mock Mode.")
        return {
            "id": f"mock_call_{int(time.time())}_{callee_name[:4]}",
            "status": "INITIATED",
            "callee_name": callee_name,
            "mobile_number": mobile_number,
            "agent_id": agent_id,
            "custom_data": custom_data,
            "mock": True
        }
        
    headers = {
        "X-API-Key": HUNAR_API_KEY,
        "Content-Type": "application/json"
    }
    
    webhook_url = f"{public_webhook_base_url.rstrip('/')}/api/webhooks/hunar"
    
    payload = {
        "agent_id": agent_id,
        "callee_name": callee_name,
        "mobile_number": mobile_number,
        "custom_data": custom_data,
        "callback_config": {
            "call_status_callback_url": webhook_url,
            "call_recording_callback_url": webhook_url,
            "call_result_callback_url": webhook_url,
            "call_summary_callback_url": webhook_url
        }
    }
    
    try:
        response = requests.post(f"{BASE_URL}/calls/", headers=headers, json=payload, timeout=10)
        if response.status_code in (200, 201):
            return response.json()
        print(f"Hunar call initiation failed. Status={response.status_code} Text={response.text}")
        return {"error": response.text, "status_code": response.status_code}
    except Exception as e:
        print(f"Hunar call request exception: {e}")
        return {"error": str(e)}


def trigger_bulk_calls(
    agent_id: str,
    candidates: List[Dict[str, Any]],
    job_requirements: Dict[str, Any],
    public_webhook_base_url: str
) -> List[Dict[str, Any]]:
    """
    Triggers outbound calls for a list of candidates.
    Returns list of {candidate_id, call_result} dicts.
    """
    results = []
    jd_summary = (
        f"Role: {job_requirements.get('title', 'the open position')}. "
        f"Skills: {', '.join(job_requirements.get('skills', [])[:5])}. "
        f"Experience: {job_requirements.get('experience_years', 2)}+ years. "
        f"Location: {job_requirements.get('location', 'flexible')}."
    )
    
    for cand in candidates:
        custom_data = {
            "company": "Our Company",
            "job_title": job_requirements.get("title", "the role"),
            "jd_summary": jd_summary,
            "job_role": job_requirements.get("title", "the role"),
            "skills_list": ", ".join(job_requirements.get("skills", [])[:5])
        }
        
        call_res = trigger_hunar_call(
            agent_id=agent_id,
            callee_name=cand.get("name", "Candidate"),
            mobile_number=normalize_phone(cand.get("phone", "")),
            custom_data=custom_data,
            public_webhook_base_url=public_webhook_base_url
        )
        
        results.append({
            "candidate_id": cand["id"],
            "call_result": call_res
        })
        
        # Small delay between calls to avoid rate limiting
        time.sleep(0.3)
    
    return results
