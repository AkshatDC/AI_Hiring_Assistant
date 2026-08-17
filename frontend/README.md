# Frontend README

This folder contains the React frontend for the AI Hiring Assistant and People Search & Reachout app.

## Purpose

The frontend provides a single-screen workflow for:

- creating a job from a job description
- reviewing parsed requirements
- sourcing candidates
- adding candidates to the pipeline
- editing contact details when enrichment is incomplete
- creating and selecting voice agents
- triggering calls
- reviewing results in the dashboard
- setting up per-browser API keys before the workflow starts

## Tech Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS
- lucide-react icons

## Main files

- `src/App.tsx` - the full application UI and API integration
- `src/App.css` - intentionally empty to avoid style conflicts
- `src/index.css` - global styles
- `src/main.tsx` - React bootstrap

## Main screens

The app is organized into four tabs:

1. Job Description
2. Sourcing
3. Voice Calls
4. Dashboard

### Job Description

- Paste the job title and job description.
- The backend extracts structured requirements.
- The form can also prefill the agent prompt from the parsed JD.

### Sourcing

- Search candidates by title, skills, location, and experience.
- Add candidates one by one or bulk add them to the pipeline.
- If a phone number or email is missing, it can be edited manually.

### Voice Calls

- View the candidate queue.
- Create a new Hunar voice agent.
- Pick an existing agent.
- Trigger single calls or bulk outreach.
- Simulate calls for demo/testing.

### Dashboard

- Review call status and ranking.
- See AI evaluation results.
- Inspect answers gathered during the call.
- Open recordings when available.

### API Key Setup

When the app first loads, it creates a browser session and shows a secure setup screen.

- Enter your own `HUNAR_API_KEY`, `APOLLO_API_KEY`, `CORESIGNAL_API_KEY`, and `GEMINI_API_KEY`.
- The frontend stores the session ID in `localStorage`.
- Every API request includes `X-Session-ID`, so the backend can keep data scoped to that browser session.

## API connection

The frontend talks to the backend at:

```text
http://localhost:8000/api
```

That value defaults to `http://localhost:8000/api` during local development, but you can override it at build time with `VITE_API_BASE_URL`.

Example for a deployed backend:

```powershell
$env:VITE_API_BASE_URL="https://your-backend.example.com/api"
npm run build
```

If the frontend and backend are deployed on the same domain, you can point the variable at a relative path such as `/api`.

The frontend automatically adds the current session ID to backend requests once the session is created.

## Run the frontend

From the `frontend/` folder:

```powershell
npm install
npm run dev
```

The Vite dev server will print the local URL, usually `http://localhost:5173`.

## Build and lint

```powershell
npm run build
npm run lint
```

## Behavior notes

- The UI polls candidate status while you are on the Calls or Dashboard tab.
- If the backend returns mock or partial data, the UI still renders the pipeline so you can keep testing the flow.
- Contact fields may need manual correction because of current enrichment subscription limits.
- Before the main app loads, the UI prompts for API keys if the current session has not saved them yet.

## User experience flow

1. Paste the JD.
2. Search for candidates.
3. Add candidates to the pipeline.
4. Fix missing contact details if needed.
5. Create or choose a Hunar agent.
6. Start calls.
7. Watch results arrive in the dashboard.

## Development note

The current README is intentionally focused on the app workflow rather than the template defaults that come with Vite.
