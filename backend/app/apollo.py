import os
import requests
import random
from typing import List, Dict, Any, Optional
from app.runtime import get_credential

# NOTE: Do NOT read API keys at module level — read lazily inside each function
# so that load_dotenv() in main.py has already run.

# ─────────────────────────────────────────────────────────────
# MOCK DATA (last-resort fallback)
# ─────────────────────────────────────────────────────────────

MOCK_FIRST_NAMES = ["Akash", "Priya", "Rahul", "Anjali", "Siddharth", "Neha", "Vikram", "Rohan", "Sneha", "Karan",
                    "Emily", "Michael", "Sarah", "David", "Jessica"]
MOCK_LAST_NAMES = ["Sharma", "Verma", "Kumar", "Patel", "Singh", "Joshi", "Gupta", "Mehta", "Nair", "Rao",
                   "Smith", "Johnson", "Davis", "Miller", "Wilson"]
MOCK_COMPANIES = ["Google", "Microsoft", "Meta", "Amazon", "Netflix", "Uber", "Razorpay", "Swiggy",
                  "Zomato", "Flipkart", "Infosys", "TCS", "Acme Corp", "Tech Solutions"]
MOCK_LOCATIONS = ["Bengaluru, India", "Mumbai, India", "Delhi, India", "San Francisco, USA",
                  "New York, USA", "London, UK", "Hyderabad, India", "Pune, India"]

MOCK_SKILLS_POOL = {
    "software engineer": ["Python", "JavaScript", "Django", "SQL", "Git", "Docker", "REST APIs", "AWS"],
    "frontend developer": ["React", "TypeScript", "JavaScript", "HTML", "CSS", "Next.js", "Redux", "Tailwind"],
    "backend developer": ["Node.js", "Python", "Go", "PostgreSQL", "MongoDB", "Redis", "Docker", "Microservices"],
    "data scientist": ["Python", "R", "Machine Learning", "TensorFlow", "Pandas", "SQL", "Spark", "Data Analytics"],
    "product manager": ["Product Strategy", "Agile", "Scrum", "Jira", "User Research", "Product Roadmap", "Data-driven"]
}


def _get_apollo_key() -> str:
    return get_credential("APOLLO_API_KEY", "")


def _get_coresignal_key() -> str:
    return get_credential("CORESIGNAL_API_KEY", "")


def generate_mock_candidates(
    title=None, skills=None, location=None, size=10
) -> List[Dict[str, Any]]:
    candidates = []
    base_title = (title or "Software Engineer").lower()
    skills_key = "software engineer"
    for key in MOCK_SKILLS_POOL.keys():
        if key in base_title:
            skills_key = key
            break
    pool_skills = list(MOCK_SKILLS_POOL[skills_key])
    if skills:
        pool_skills = list(set(pool_skills + skills))
    for _ in range(size):
        first = random.choice(MOCK_FIRST_NAMES)
        last = random.choice(MOCK_LAST_NAMES)
        company = random.choice(MOCK_COMPANIES)
        loc = location or random.choice(MOCK_LOCATIONS)
        cand_skills = random.sample(pool_skills, min(len(pool_skills), random.randint(4, 7)))
        email = f"{first.lower()}.{last.lower()}@{company.lower().replace(' ', '')}.com"
        candidates.append({
            "id": f"mock_{random.randint(100000, 999999)}",
            "full_name": f"{first} {last}",
            "first_name": first,
            "last_name": last,
            "linkedin_url": f"https://linkedin.com/in/{first.lower()}-{last.lower()}-{random.randint(100, 999)}",
            "work_email": email,
            "personal_emails": [f"{first.lower()}{random.randint(80,99)}@gmail.com"],
            "phone_numbers": [f"+91{random.randint(7000000000, 9999999999)}"],
            "mobile_phone": f"+91{random.randint(7000000000, 9999999999)}",
            "job_title": title or skills_key.title(),
            "job_company_name": company,
            "location_name": loc,
            "skills": cand_skills,
            "source": "mock",
            "is_mock": True
        })
    return candidates


# ─────────────────────────────────────────────────────────────
# APOLLO.IO SEARCH  (Primary)
#
# Apollo search endpoints (mixed_people/search, people/search) require
# a paid Apollo Search plan — NOT included in the free enrichment key scope.
# The key UI only shows enrichment endpoints (bulk_match, show, match).
# Apollo will gracefully fall through to CoreSignal if scope is missing.
# ─────────────────────────────────────────────────────────────

def _search_apollo(title, skills, location, experience_years, size) -> Optional[List[Dict[str, Any]]]:
    APOLLO_API_KEY = _get_apollo_key()
    if not APOLLO_API_KEY:
        print("[Apollo] Key not set — skipping")
        return None

    headers = {
        "X-Api-Key": APOLLO_API_KEY,
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
    }
    body: Dict[str, Any] = {"per_page": min(size, 100), "page": 1}
    if title:
        body["person_titles"] = [title]
    if location:
        body["person_locations"] = [location]
    if skills:
        body["q_keywords"] = " ".join(skills)
    if experience_years:
        if experience_years >= 10:
            body["person_seniorities"] = ["vp", "director", "c_suite", "partner", "manager", "senior"]
        elif experience_years >= 5:
            body["person_seniorities"] = ["manager", "senior", "mid"]
        else:
            body["person_seniorities"] = ["entry", "junior", "mid"]

    endpoints = [
        "https://api.apollo.io/api/v1/mixed_people/search",
        "https://api.apollo.io/api/v1/people/search",
    ]
    try:
        for endpoint in endpoints:
            resp = requests.post(endpoint, headers=headers, json=body, timeout=20)
            if resp.status_code == 200:
                data = resp.json()
                people = data.get("people", [])
                results = []
                for p in people:
                    first = p.get("first_name", "")
                    last = p.get("last_name", "")
                    raw_phones = p.get("phone_numbers", [])
                    phone_list = []
                    for ph in raw_phones:
                        if isinstance(ph, dict):
                            n = ph.get("sanitized_number") or ph.get("raw_number") or ""
                            if n:
                                phone_list.append(n)
                        elif isinstance(ph, str) and ph:
                            phone_list.append(ph)
                    org = p.get("organization") or {}
                    loc_parts = [p.get("city"), p.get("state"), p.get("country")]
                    results.append({
                        "id": p.get("id", f"apollo_{random.randint(100000,999999)}"),
                        "full_name": p.get("name") or f"{first} {last}".strip(),
                        "first_name": first,
                        "last_name": last,
                        "linkedin_url": p.get("linkedin_url") or "",
                        "work_email": p.get("email") or "",
                        "personal_emails": [],
                        "phone_numbers": phone_list,
                        "mobile_phone": phone_list[0] if phone_list else "",
                        "job_title": p.get("title") or "",
                        "job_company_name": org.get("name") or p.get("organization_name") or "",
                        "location_name": ", ".join(x for x in loc_parts if x),
                        "skills": [],
                        "source": "apollo",
                        "is_mock": False
                    })
                print(f"[Apollo] {endpoint} returned {len(results)} candidates")
                return results

            # Detect scope error
            try:
                err_code = resp.json().get("error_code", "")
            except Exception:
                err_code = ""
            if err_code == "API_INACCESSIBLE" or resp.status_code in (401, 403):
                print(f"[Apollo] {endpoint} not in key scope — trying next endpoint")
                continue
            print(f"[Apollo] {endpoint} error {resp.status_code}: {resp.text[:200]}")
            return None

        print("[Apollo] No search endpoints authorized — falling back to CoreSignal")
        return None
    except Exception as e:
        print(f"[Apollo] Exception: {e}")
        return None


# ─────────────────────────────────────────────────────────────
# CORESIGNAL SEARCH  (Fallback — two-step: search IDs then collect)
#
# Step 1: POST /search/filter  → returns list of integer employee IDs
# Step 2: GET  /collect/{id}   → returns full profile per ID
# Auth: "apikey" header
# ─────────────────────────────────────────────────────────────

def _search_coresignal(title, skills, location, experience_years, size) -> Optional[List[Dict[str, Any]]]:
    CORESIGNAL_API_KEY = _get_coresignal_key()
    if not CORESIGNAL_API_KEY:
        print("[CoreSignal] Key not set — skipping")
        return None

    headers = {
        "accept": "application/json",
        "apikey": CORESIGNAL_API_KEY,
        "Content-Type": "application/json",
    }

    # Step 1: Search filter — only send valid filter fields, NO limit/offset
    filter_body: Dict[str, Any] = {}
    if title:
        filter_body["title"] = title
    if location:
        filter_body["location"] = location

    try:
        search_resp = requests.post(
            "https://api.coresignal.com/cdapi/v2/employee_base/search/filter",
            headers=headers,
            json=filter_body,
            timeout=20
        )
        if search_resp.status_code != 200:
            print(f"[CoreSignal] Search failed {search_resp.status_code}: {search_resp.text[:200]}")
            return None

        employee_ids = search_resp.json()
        if not isinstance(employee_ids, list):
            employee_ids = employee_ids.get("data", [])

        ids_to_fetch = employee_ids[:min(size, 15)]  # cap at 15 to save credits
        print(f"[CoreSignal] {len(employee_ids)} IDs found — collecting {len(ids_to_fetch)}")

        results = []
        for emp_id in ids_to_fetch:
            try:
                r = requests.get(
                    f"https://api.coresignal.com/cdapi/v2/employee_base/collect/{emp_id}",
                    headers=headers,
                    timeout=15
                )
                if r.status_code != 200:
                    continue
                emp = r.json()

                first = emp.get("first_name") or ""
                last = emp.get("last_name") or ""
                full_name = emp.get("full_name") or f"{first} {last}".strip()

                # Current job from experience list
                exp_list = emp.get("experience") or []
                current_exp = next(
                    (e for e in exp_list if e.get("is_current") == 1),
                    exp_list[0] if exp_list else {}
                )

                loc_parts = [emp.get("city"), emp.get("state"), emp.get("country")]
                skill_names = emp.get("inferred_skills") or []
                if isinstance(skill_names, list):
                    skill_names = [s.title() for s in skill_names[:10] if s]

                results.append({
                    "id": str(emp_id),
                    "full_name": full_name,
                    "first_name": first,
                    "last_name": last,
                    "linkedin_url": emp.get("profile_url") or "",
                    "work_email": emp.get("email_address") or "",
                    "personal_emails": [],
                    "phone_numbers": [],
                    "mobile_phone": "",
                    "job_title": current_exp.get("title") or emp.get("headline") or "",
                    "job_company_name": current_exp.get("company_name") or "",
                    "location_name": emp.get("location") or ", ".join(p for p in loc_parts if p),
                    "skills": skill_names,
                    "source": "coresignal",
                    "is_mock": False
                })
            except Exception as e:
                print(f"[CoreSignal] Error collecting {emp_id}: {e}")
                continue

        print(f"[CoreSignal] Collected {len(results)} profiles")
        return results if results else None

    except Exception as e:
        print(f"[CoreSignal] Exception: {e}")
        return None


# ─────────────────────────────────────────────────────────────
# PUBLIC INTERFACE  (drop-in replacement for pdl.search_people)
# ─────────────────────────────────────────────────────────────

def search_people(
    title: Optional[str] = None,
    skills: Optional[List[str]] = None,
    location: Optional[str] = None,
    experience_years: Optional[int] = None,
    size: int = 10
) -> List[Dict[str, Any]]:
    """
    1. Apollo.io  (primary)  — needs Search plan, not just enrichment key scope
    2. CoreSignal (fallback) — two-step search+collect, works with CORESIGNAL_API_KEY
    3. Mock data  (last resort)
    """
    results = _search_apollo(title, skills, location, experience_years, size)
    if results is not None:
        return results

    print("[Sourcing] Apollo unavailable — trying CoreSignal")
    results = _search_coresignal(title, skills, location, experience_years, size)
    if results is not None:
        return results

    print("[Sourcing] Both unavailable — using mock data")
    return generate_mock_candidates(title, skills, location, size)


def enrich_candidate(first_name: str, last_name: str, company: str, linkedin_url: str = "") -> Optional[Dict[str, Any]]:
    APOLLO_API_KEY = _get_apollo_key()
    if not APOLLO_API_KEY:
        print("[Apollo Enrich] API key not set.")
        return None

    headers = {
        "X-Api-Key": APOLLO_API_KEY,
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
    }
    
    details = {
        "first_name": first_name,
        "last_name": last_name,
    }
    if company:
        details["organization_name"] = company
    if linkedin_url:
        details["linkedin_url"] = linkedin_url

    body = {
        "details": [details]
    }

    try:
        resp = requests.post("https://api.apollo.io/api/v1/people/bulk_match", headers=headers, json=body, timeout=20)
        if resp.status_code == 200:
            data = resp.json()
            matches = data.get("matches", [])
            if matches and matches[0]:
                p = matches[0]
                raw_phones = p.get("phone_numbers", [])
                phone_list = []
                for ph in raw_phones:
                    if isinstance(ph, dict):
                        n = ph.get("sanitized_number") or ph.get("raw_number") or ""
                        if n:
                            phone_list.append(n)
                    elif isinstance(ph, str) and ph:
                        phone_list.append(ph)
                return {
                    "phone_numbers": phone_list,
                    "mobile_phone": phone_list[0] if phone_list else "",
                    "work_email": p.get("email") or ""
                }
        else:
            print(f"[Apollo Enrich] Failed with status {resp.status_code}: {resp.text[:200]}")
        return None
    except Exception as e:
        print(f"[Apollo Enrich] Exception: {e}")
        return None
