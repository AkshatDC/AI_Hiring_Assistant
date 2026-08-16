import json
import os
from typing import List, Dict, Any, Optional

DB_FILE = os.path.join(os.path.dirname(__file__), "db.json")

def _read_db() -> Dict[str, Any]:
    if not os.path.exists(DB_FILE):
        return {"jobs": {}, "candidates": {}}
    try:
        with open(DB_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return {"jobs": {}, "candidates": {}}

def _write_db(data: Dict[str, Any]):
    with open(DB_FILE, "w") as f:
        json.dump(data, f, indent=2)

def save_job(job: Dict[str, Any]):
    db = _read_db()
    db["jobs"][job["id"]] = job
    _write_db(db)

def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    db = _read_db()
    return db["jobs"].get(job_id)

def list_jobs() -> List[Dict[str, Any]]:
    db = _read_db()
    return list(db["jobs"].values())

def save_candidate(candidate: Dict[str, Any]):
    db = _read_db()
    db["candidates"][candidate["id"]] = candidate
    _write_db(db)

def get_candidate(candidate_id: str) -> Optional[Dict[str, Any]]:
    db = _read_db()
    return db["candidates"].get(candidate_id)

def get_candidate_by_call_id(call_id: str) -> Optional[Dict[str, Any]]:
    db = _read_db()
    for candidate in db["candidates"].values():
        if candidate.get("call_id") == call_id:
            return candidate
    return None

def list_candidates(job_id: Optional[str] = None) -> List[Dict[str, Any]]:
    db = _read_db()
    candidates = list(db["candidates"].values())
    if job_id:
        candidates = [c for c in candidates if c["job_id"] == job_id]
    return candidates

def delete_candidate(candidate_id: str):
    db = _read_db()
    db["candidates"].pop(candidate_id, None)
    _write_db(db)
