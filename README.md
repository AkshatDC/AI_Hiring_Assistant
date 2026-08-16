# AI Hiring Assistant

This project combines both problem statements into a single end-to-end hiring workflow:

1. AI Hiring Assistant - a web application that uses Voice AI agents from Hunar.AI for candidate screening and follow-up.
2. People Search & Reachout - a sourcing and outreach workflow that takes a job description, finds matching people through people search APIs, and feeds the results back into the dashboard after outreach.

The app is split into a FastAPI backend and a Vite + React frontend.

## What the app does

- Takes a job description and extracts role requirements.
- Searches for matching candidates using Apollo.io first, then CoreSignal, with mock fallback data if APIs are unavailable.
- Adds candidates into a pipeline and lets you manually edit missing contact details.
- Creates or reuses a Hunar voice agent for screening calls.
- Triggers single or bulk outbound calls.
- Receives webhook updates from Hunar and stores call status, recordings, answers, and AI evaluation results.
- Shows the full pipeline and scoring in a dashboard.

## Important limitation

Due to the current subscription limits, phone number and email enrichment may not always be fetched automatically.

- If a candidate comes in without usable contact data, you can enter the phone number manually.
- You can also send candidates a form to fill out.
- Once the form is submitted, the phone number can be extracted and added to the required field automatically.

## Project Structure

- `backend/` - FastAPI app, sourcing logic, Hunar integration, AI scoring, JSON storage.
- `frontend/` - React app for job creation, sourcing, candidate management, calls, and dashboard.
- `start_backend.bat` - helper script to start the backend on Windows.

## Prerequisites

- Python 3.10+ recommended
- Node.js 18+ recommended
- A browser
- API keys if you want live integrations:
  - `HUNAR_API_KEY`
  - `GEMINI_API_KEY`
  - `APOLLO_API_KEY`
  - `CORESIGNAL_API_KEY`

## Run the app

### 1. Start the backend

From the project root:

```powershell
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000 --reload
```

Or on Windows you can use:

```powershell
.\start_backend.bat
```

### 2. Start the frontend

In a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

The frontend expects the backend at `http://localhost:8000/api`.

## User Flow

1. Create a job from a job description.
2. Review the parsed requirements.
3. Search candidates using Apollo.io or CoreSignal.
4. Add candidates to the pipeline.
5. Fix or enrich missing phone numbers manually if needed.
6. Create or select a Hunar voice agent.
7. Trigger a single call or a bulk outreach campaign.
8. Wait for webhook callbacks to update call status and results.
9. Review the dashboard for scores, transcripts/answers, and shortlist decisions.

## Backend at a glance

The backend exposes endpoints for:

- job creation and retrieval
- candidate management
- sourcing search and auto-add
- voice agent management
- single and bulk call triggering
- Hunar webhook processing
- candidate enrichment

It stores data in `backend/app/db.json`.

## Frontend at a glance

The frontend is a single-page app with four main areas:

- Job Description
- Sourcing
- Voice Calls
- Dashboard

It is designed to support the full lifecycle from JD to outreach to evaluation without switching systems.

## Notes

- If an API key is missing, the backend falls back to mock or heuristic behavior where possible.
- The app supports live integrations, but it is still usable in a limited demo mode.

## Deployment

This project is best deployed as two services:

1. Frontend: static hosting for `frontend/`
2. Backend: a FastAPI host for `backend/`

For the frontend build, set `VITE_API_BASE_URL` to the public backend URL, for example:

```powershell
$env:VITE_API_BASE_URL="https://your-backend.example.com/api"
cd frontend
npm run build
```

Then deploy the generated frontend bundle to your static host of choice.

The backend needs the following environment variables in production as needed:

- `HUNAR_API_KEY`
- `GEMINI_API_KEY`
- `APOLLO_API_KEY`
- `CORESIGNAL_API_KEY`
- `PUBLIC_WEBHOOK_URL`
