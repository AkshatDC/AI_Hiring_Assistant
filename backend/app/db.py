import json
import os
from typing import List, Dict, Any, Optional
from app.runtime import get_current_session_id

DB_FILE = os.path.join(os.path.dirname(__file__), "db.json")

def _empty_db() -> Dict[str, Any]:
    return {"sessions": {}, "jobs": {}, "candidates": {}}

def _read_db() -> Dict[str, Any]:
    if not os.path.exists(DB_FILE):
        return _empty_db()
    try:
        with open(DB_FILE, "r") as f:
            data = json.load(f)
            if not isinstance(data, dict):
                return _empty_db()
            data.setdefault("sessions", {})
            data.setdefault("jobs", {})
            data.setdefault("candidates", {})
            return data
    except Exception:
        return _empty_db()

def _write_db(data: Dict[str, Any]):
    with open(DB_FILE, "w") as f:
        json.dump(data, f, indent=2)

def get_session(session_id: str) -> Optional[Dict[str, Any]]:
    db = _read_db()
    return db["sessions"].get(session_id)

def save_session(session: Dict[str, Any]):
    db = _read_db()
    db["sessions"][session["id"]] = session
    _write_db(db)

def list_sessions() -> List[Dict[str, Any]]:
    db = _read_db()
    return list(db["sessions"].values())

def ensure_session(session_id: str) -> Dict[str, Any]:
    db = _read_db()
    session = db["sessions"].get(session_id)
    if session:
        session["last_seen_at"] = session.get("last_seen_at")
    else:
        session = {
            "id": session_id,
            "credentials": {},
            "created_at": __import__("time").strftime("%Y-%m-%dT%H:%M:%SZ"),
            "last_seen_at": __import__("time").strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
    db["sessions"][session_id] = session
    _write_db(db)
    return session

def update_session_credentials(session_id: str, credentials: Dict[str, Any]) -> Dict[str, Any]:
    db = _read_db()
    session = db["sessions"].get(session_id) or ensure_session(session_id)
    clean_credentials = {key: value for key, value in credentials.items() if isinstance(value, str) and value.strip()}
    session["credentials"] = clean_credentials
    session["updated_at"] = __import__("time").strftime("%Y-%m-%dT%H:%M:%SZ")
    db["sessions"][session_id] = session
    _write_db(db)
    return session

def get_session_credentials(session_id: str) -> Dict[str, Any]:
    session = get_session(session_id) or {}
    credentials = session.get("credentials", {})
    return credentials if isinstance(credentials, dict) else {}

def _record_matches_session(record: Dict[str, Any], session_id: Optional[str]) -> bool:
    if session_id is None:
        return True
    record_session_id = record.get("session_id")
    return record_session_id in (None, session_id)

def save_job(job: Dict[str, Any]):
    db = _read_db()
    job.setdefault("session_id", get_current_session_id())
    db["jobs"][job["id"]] = job
    _write_db(db)

def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    db = _read_db()
    job = db["jobs"].get(job_id)
    if not job:
        return None
    return job if _record_matches_session(job, get_current_session_id()) else None

def list_jobs() -> List[Dict[str, Any]]:
    db = _read_db()
    session_id = get_current_session_id()
    return [job for job in db["jobs"].values() if _record_matches_session(job, session_id)]

def save_candidate(candidate: Dict[str, Any]):
    db = _read_db()
    candidate.setdefault("session_id", get_current_session_id())
    db["candidates"][candidate["id"]] = candidate
    _write_db(db)

def get_candidate(candidate_id: str) -> Optional[Dict[str, Any]]:
    db = _read_db()
    candidate = db["candidates"].get(candidate_id)
    if not candidate:
        return None
    return candidate if _record_matches_session(candidate, get_current_session_id()) else None

def get_candidate_by_call_id(call_id: str) -> Optional[Dict[str, Any]]:
    db = _read_db()
    session_id = get_current_session_id()
    for candidate in db["candidates"].values():
        if candidate.get("call_id") == call_id and _record_matches_session(candidate, session_id):
            return candidate
    return None

def list_candidates(job_id: Optional[str] = None) -> List[Dict[str, Any]]:
    db = _read_db()
    candidates = list(db["candidates"].values())
    session_id = get_current_session_id()
    candidates = [candidate for candidate in candidates if _record_matches_session(candidate, session_id)]
    if job_id:
        candidates = [c for c in candidates if c["job_id"] == job_id]
    return candidates

def delete_candidate(candidate_id: str):
    db = _read_db()
    candidate = db["candidates"].get(candidate_id)
    if candidate and _record_matches_session(candidate, get_current_session_id()):
        db["candidates"].pop(candidate_id, None)
        _write_db(db)
