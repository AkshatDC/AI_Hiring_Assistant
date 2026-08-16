import os
import requests
import random
from typing import List, Dict, Any, Optional

# NOTE: Do NOT read PDL_API_KEY at module level — it must be read lazily
# inside each function so that load_dotenv() in main.py has already run.

# Realistic mock data to fall back on or use when PDL key is not configured
MOCK_FIRST_NAMES = ["Akash", "Priya", "Rahul", "Anjali", "Siddharth", "Neha", "Vikram", "Rohan", "Sneha", "Karan", "Emily", "Michael", "Sarah", "David", "Jessica"]
MOCK_LAST_NAMES = ["Sharma", "Verma", "Kumar", "Patel", "Singh", "Joshi", "Gupta", "Mehta", "Nair", "Rao", "Smith", "Johnson", "Davis", "Miller", "Wilson"]
MOCK_COMPANIES = ["Google", "Microsoft", "Meta", "Amazon", "Netflix", "Uber", "Razorpay", "Swiggy", "Zomato", "Flipkart", "Infosys", "TCS", "Acme Corp", "Tech Solutions"]
MOCK_LOCATIONS = ["Bengaluru, India", "Mumbai, India", "Delhi, India", "San Francisco, USA", "New York, USA", "London, UK", "Hyderabad, India", "Pune, India"]

MOCK_SKILLS_POOL = {
    "software engineer": ["Python", "JavaScript", "Django", "SQL", "Git", "Docker", "REST APIs", "AWS"],
    "frontend developer": ["React", "TypeScript", "JavaScript", "HTML", "CSS", "Next.js", "Redux", "Tailwind"],
    "backend developer": ["Node.js", "Python", "Go", "PostgreSQL", "MongoDB", "Redis", "Docker", "Microservices"],
    "data scientist": ["Python", "R", "Machine Learning", "TensorFlow", "Pandas", "SQL", "Spark", "Data Analytics"],
    "product manager": ["Product Strategy", "Agile", "Scrum", "Jira", "User Research", "Product Roadmap", "Data-driven"]
}


def _get_pdl_key() -> str:
    """Lazily fetch PDL key so load_dotenv() in main.py has already run."""
    return os.getenv("PDL_API_KEY", "")


def _resolve_masked(value: Any, field_name: str = "") -> Any:
    """
    PDL masks sensitive fields (email, phone) by returning boolean True
    on free/limited plans. Return a placeholder string in that case.
    """
    if value is True:
        return f"[PDL: contact available on paid plan]"
    if value is False or value is None:
        return None
    return value


def generate_mock_candidates(title: Optional[str] = None, skills: Optional[List[str]] = None, location: Optional[str] = None, size: int = 10) -> List[Dict[str, Any]]:
    candidates = []
    base_title = (title or "Software Engineer").lower()
    
    # Match the title key
    skills_key = "software engineer"
    for key in MOCK_SKILLS_POOL.keys():
        if key in base_title:
            skills_key = key
            break
            
    pool_skills = MOCK_SKILLS_POOL[skills_key]
    if skills:
        pool_skills = list(set(pool_skills + skills))

    for i in range(size):
        first = random.choice(MOCK_FIRST_NAMES)
        last = random.choice(MOCK_LAST_NAMES)
        full_name = f"{first} {last}"
        company = random.choice(MOCK_COMPANIES)
        loc = location or random.choice(MOCK_LOCATIONS)
        
        # Pick 4-7 skills
        cand_skills = random.sample(pool_skills, min(len(pool_skills), random.randint(4, 7)))
        
        email = f"{first.lower()}.{last.lower()}@{company.lower().replace(' ', '')}.com"
        linkedin = f"https://linkedin.com/in/{first.lower()}-{last.lower()}-{random.randint(100, 999)}"
        
        candidates.append({
            "id": f"pdl_{random.randint(100000, 999999)}",
            "full_name": full_name,
            "first_name": first,
            "last_name": last,
            "linkedin_url": linkedin,
            "work_email": email,
            "personal_emails": [f"{first.lower()}{random.randint(80, 99)}@gmail.com"],
            "phone_numbers": [f"+91{random.randint(7000000000, 9999999999)}"],
            "mobile_phone": f"+91{random.randint(7000000000, 9999999999)}",
            "job_title": title or skills_key.title(),
            "job_company_name": company,
            "location_name": loc,
            "skills": cand_skills,
            "is_mock": True
        })
    return candidates


def search_people(
    title: Optional[str] = None,
    skills: Optional[List[str]] = None,
    location: Optional[str] = None,
    experience_years: Optional[int] = None,
    size: int = 10
) -> List[Dict[str, Any]]:
    
    PDL_API_KEY = _get_pdl_key()  # lazy read — always picks up loaded env
    
    if not PDL_API_KEY:
        print("PDL_API_KEY not set — using mock candidates")
        return generate_mock_candidates(title, skills, location, size)
    
    # Build Elasticsearch boolean query for PDL search endpoint
    headers = {
        "X-API-Key": PDL_API_KEY,
        "Content-Type": "application/json"
    }
    
    # Build query:
    # - title/location go in `must` (required)
    # - skills go in `should` (optional boosts)
    must_clauses = []
    should_clauses = []
    
    if title:
        must_clauses.append({
            "match": {
                "job_title": title
            }
        })
    
    if skills:
        for skill in skills:
            # PDL skills field uses match, not term
            should_clauses.append({
                "match": {
                    "skills": skill.lower()
                }
            })
            
    if location:
        must_clauses.append({
            "match": {
                "location_name": location
            }
        })
        
    if experience_years:
        must_clauses.append({
            "range": {
                "inferred_years_experience": {
                    "gte": experience_years
                }
            }
        })
    
    bool_query: dict = {}
    if must_clauses:
        bool_query["must"] = must_clauses
    if should_clauses:
        bool_query["should"] = should_clauses
        # Note: do NOT add minimum_should_match — PDL API rejects it

    query = {
        "query": {
            "bool": bool_query
        } if bool_query else {"match_all": {}},
        "size": size
    }
    
    try:
        response = requests.post(
            "https://api.peopledatalabs.com/v5/person/search",
            headers=headers,
            json=query,
            timeout=15
        )
        if response.status_code == 200:
            res_data = response.json()
            results = []
            for item in res_data.get("data", []):
                # PDL may return True (bool) for masked sensitive fields on free tier
                raw_mobile = item.get("mobile_phone")
                raw_email = item.get("work_email")
                raw_personal = item.get("personal_emails")
                raw_phones = item.get("phone_numbers", [])
                
                mobile = _resolve_masked(raw_mobile, "mobile_phone")
                work_email = _resolve_masked(raw_email, "work_email")
                personal_emails = []
                if isinstance(raw_personal, list):
                    personal_emails = raw_personal
                elif raw_personal is True:
                    personal_emails = ["[PDL: available on paid plan]"]
                
                phone_numbers = raw_phones if isinstance(raw_phones, list) else []
                
                results.append({
                    "id": item.get("id"),
                    "full_name": item.get("full_name"),
                    "first_name": item.get("first_name"),
                    "last_name": item.get("last_name"),
                    "linkedin_url": item.get("linkedin_url"),
                    "work_email": work_email,
                    "personal_emails": personal_emails,
                    "phone_numbers": phone_numbers,
                    "mobile_phone": mobile,
                    "job_title": item.get("job_title"),
                    "job_company_name": item.get("job_company_name"),
                    "location_name": item.get("location_name"),
                    "skills": item.get("skills", []),
                    "industry": item.get("industry"),
                    "linkedin_username": item.get("linkedin_username"),
                    "is_mock": False
                })
            print(f"PDL returned {len(results)} real candidates")
            return results
        else:
            print(f"PDL Search API failed status={response.status_code} text={response.text}")
            return generate_mock_candidates(title, skills, location, size)
    except Exception as e:
        print(f"PDL API Request failed: {e}")
        return generate_mock_candidates(title, skills, location, size)
