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
- Prompts each browser session to enter its own API keys and keeps jobs, candidates, and call data scoped to that session.

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
- A backend `.env` file is still useful for shared defaults like `PUBLIC_WEBHOOK_URL`

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

### 2. Important: expose the backend with ngrok for live voice calls

**This step is required when using live Hunar calls.** Hunar needs to send call status, recordings, and screening answers back to this backend. It cannot reach `http://localhost:8000` on your computer.

Keep the backend running, then open a new terminal and run:

```powershell
ngrok http 8000
```

Copy the public HTTPS forwarding URL that ngrok shows, for example `https://example-1234.ngrok-free.app`, and set it in `backend/.env`:

```env
PUBLIC_WEBHOOK_URL=https://example-1234.ngrok-free.app
```

Restart the backend after changing `.env`. Before triggering a real call, make sure the value does not contain `/api` or a trailing slash. The app uses this base URL to build the Hunar webhook callback URL.

On ngrok's free plan, the URL can change every time ngrok restarts. If it changes, update `PUBLIC_WEBHOOK_URL` and restart the backend again. You can skip ngrok only when using simulated calls or when the backend is already deployed at a public HTTPS URL.

### 3. Start the frontend

In a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

The frontend expects the backend at `http://localhost:8000/api`.

### 4. Set up API keys in the app

When you open the app, it will generate a browser session and show an API key setup screen.

Enter your own:

- `HUNAR_API_KEY`
- `APOLLO_API_KEY`
- `CORESIGNAL_API_KEY`
- `GEMINI_API_KEY`

Those keys are stored server-side for that session only. You do not need to keep editing `.env` for each browser user.

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
- session creation and session-scoped credential storage

It stores data in `backend/app/db.json` with separate `sessions`, `jobs`, and `candidates` records so one browser session does not see another session's data.

## Frontend at a glance

The frontend is a single-page app with four main areas:

- Job Description
- Sourcing
- Voice Calls
- Dashboard

It is designed to support the full lifecycle from JD to outreach to evaluation without switching systems.

## Notes

- If a browser session has not saved API keys yet, the UI will prompt for them before the main workflow loads.
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

- `PUBLIC_WEBHOOK_URL`

Shared environment variables are optional if each browser session supplies its own keys through the app. If you want default fallback credentials for all sessions, you can still define:

- `HUNAR_API_KEY`
- `GEMINI_API_KEY`
- `APOLLO_API_KEY`
- `CORESIGNAL_API_KEY`
