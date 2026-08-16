# Backend README

This folder contains the FastAPI backend for the AI Hiring Assistant and People Search & Reachout workflow.

## Purpose

The backend is responsible for:

- parsing job descriptions
- sourcing candidates from external people search providers
- managing the candidate pipeline
- creating and updating Hunar voice agents
- triggering outbound screening calls
- receiving Hunar webhook callbacks
- evaluating candidate responses against the job requirements

## Tech Stack

- FastAPI
- Uvicorn
- Pydantic
- Requests
- python-dotenv
- Google Generative AI for JD parsing and evaluation when configured

## Main files

- `app/main.py` - FastAPI app, routes, webhook handlers, call orchestration
- `app/ai.py` - JD parsing, candidate evaluation, ranking
- `app/apollo.py` - Apollo.io search and enrichment, CoreSignal fallback, mock data fallback
- `app/hunar.py` - Hunar voice agent and call API integration
- `app/db.py` - lightweight JSON storage helpers
- `app/schemas.py` - request and response models
- `app/db.json` - local data store for jobs and candidates

## Environment Variables

Create a `.env` file in `backend/` with the values you want to use.

- `HUNAR_API_KEY`
- `GEMINI_API_KEY`
- `APOLLO_API_KEY`
- `CORESIGNAL_API_KEY`
- `PUBLIC_WEBHOOK_URL`
- `PORT` - optional, default is `8000`
- `HOST` - optional, default is `0.0.0.0`

## How it works

### 1. Job parsing

When a job description is submitted, the backend extracts:

- title
- skills
- experience requirements
- location hints
- salary or notice period hints

If Gemini is not available, the backend uses rule-based heuristics.

### 2. Candidate sourcing

Candidate search follows this order:

1. Apollo.io
2. CoreSignal
3. Mock candidate data

The backend returns normalized candidate profiles so the frontend can add them to the pipeline.

### 3. Candidate enrichment

The backend can attempt to enrich candidate contact details through Apollo.io.

Important: because of the current subscription limits, phone number and email may not always be returned. In those cases, phone numbers need to be entered manually or extracted from a submitted form and then copied into the candidate record.

### 4. Hunar call orchestration

The backend can:

- create a Hunar agent
- update an existing agent
- trigger a single call
- trigger bulk calls for all pending candidates

It also sends callback URLs so Hunar can notify the app about call status, recordings, summaries, and result payloads.

### 5. Webhook processing

The webhook endpoint updates the candidate record with:

- call status
- recording URL
- answers from the conversation
- AI evaluation results

## API Endpoints

### Config

- `GET /api/config`

### Jobs

- `POST /api/jobs`
- `GET /api/jobs`
- `GET /api/jobs/{job_id}`
- `GET /api/jobs/{job_id}/suggested-agent`

### Sourcing

- `POST /api/sourcing/search?job_id=...`
- `POST /api/sourcing/auto-search?job_id=...`
- `GET /api/apollo/test`

### Candidates

- `POST /api/candidates`
- `GET /api/candidates`
- `PATCH /api/candidates/{candidate_id}`
- `DELETE /api/candidates/{candidate_id}`
- `POST /api/candidates/{candidate_id}/enrich`
- `POST /api/candidates/{candidate_id}/simulate`
- `POST /api/candidates/reachout`

### Calls

- `POST /api/calls/bulk`

### Agents

- `GET /api/agents`
- `GET /api/agents/{agent_id}`
- `POST /api/agents`
- `PATCH /api/agents/{agent_id}`

### Webhooks

- `POST /api/webhooks/hunar`

## Run the backend

From the project root:

```powershell
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000 --reload
```

On Windows, you can also use the helper script:

```powershell
.\start_backend.bat
```

## Data storage

The backend uses a simple JSON file at `app/db.json` for local storage.

- Jobs are stored under `jobs`
- Candidates are stored under `candidates`

This makes the project easy to run locally without setting up a database.

## Development notes

- CORS is currently open to all origins for local development.
- If API keys are missing, the backend keeps the app usable by falling back to mock or heuristic logic where possible.
- The code is designed for a demo and prototype workflow, not for production-grade persistence.
