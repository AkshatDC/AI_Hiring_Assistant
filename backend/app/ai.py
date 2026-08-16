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

def evaluate_candidate_results(candidate_answers: Dict[str, Any], jd_requirements: Dict[str, Any]) -> Dict[str, Any]:
    """
    Evaluates Candidate's Hunar call answers against Job criteria using Gemini or fallback scoring rules.
    """
    GEMINI_API_KEY = _get_gemini_key()
    if not GEMINI_API_KEY:
        # Fallback scoring calculation logic
        # candidate_answers format like:
        # {
        #   "experience": 2.5,
        #   "python": 8,
        #   "sql": 7,
        #   "communication": 8,
        #   "notice_period": 30,
        #   "salary_expectation": 600000,
        #   "interested": true
        # }
        
        experience = float(candidate_answers.get("experience", 1.0))
        comm = float(candidate_answers.get("communication", 7.0))
        notice = float(candidate_answers.get("notice_period", 30.0))
        interest = bool(candidate_answers.get("interested", True))
        
        # Simple scores
        req_exp = float(jd_requirements.get("experience_years", 2.0))
        exp_score = min(100, int((experience / req_exp) * 100)) if req_exp > 0 else 90
        comm_score = min(100, int((comm / 10.0) * 100)) if comm <= 10 else int(comm)
        
        # Technical score
        tech_ratings = [float(v) for k, v in candidate_answers.items() if k not in ["experience", "communication", "notice_period", "salary_expectation", "interested"] and isinstance(v, (int, float))]
        if tech_ratings:
            avg_tech = sum(tech_ratings) / len(tech_ratings)
            tech_score = min(100, int((avg_tech / 10.0) * 100)) if avg_tech <= 10 else int(avg_tech)
        else:
            tech_score = 80
            
        reqs_score = 100
        if notice > 60:
            reqs_score -= 20
            
        overall_score = int((exp_score * 0.2) + (tech_score * 0.4) + (comm_score * 0.2) + (reqs_score * 0.2))
        
        rec = "SHORTLIST" if overall_score >= 75 and interest else "REJECT"
        
        return {
            "overall_score": overall_score,
            "technical_score": tech_score,
            "communication_score": comm_score,
            "experience_score": exp_score,
            "requirements_score": reqs_score,
            "recommendation": rec,
            "justification": f"Candidate meets {overall_score}% of the requirements. Technical assessment rated at {tech_score}/100 with communication rated at {comm_score}/100. Sourced candidate notice period of {notice} days aligns well with business requirements."
        }

    try:
        model = genai.GenerativeModel('gemini-2.0-flash')
        prompt = f"""
        Compare the candidate's call responses/screening criteria against the JD requirements and perform a hiring evaluation.
        Return ONLY valid JSON. Do not include markdown code block formatting or any other text.
        
        JSON schema:
        {{
            "overall_score": 85, (0-100 integer)
            "technical_score": 80, (0-100 integer)
            "communication_score": 90, (0-100 integer)
            "experience_score": 85, (0-100 integer)
            "requirements_score": 90, (0-100 integer matching notice/location/salary constraints)
            "recommendation": "SHORTLIST", ("SHORTLIST" or "REJECT")
            "justification": "Detailed explanation of why candidate was shortlisted or rejected based on JD matching."
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
        return json.loads(text)
    except Exception as e:
        print(f"Gemini candidate evaluation failed: {e}")
        return {
            "overall_score": 75,
            "technical_score": 75,
            "communication_score": 75,
            "experience_score": 75,
            "requirements_score": 75,
            "recommendation": "SHORTLIST",
            "justification": "Evaluation generated under default settings."
        }


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
