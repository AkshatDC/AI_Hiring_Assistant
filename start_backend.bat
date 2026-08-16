@echo off
REM Start the AI Hiring Assistant backend server
REM Must be run from the project root (AI_Hiring_Assistant\)
cd /d "%~dp0\backend"
call "..\\.venv\Scripts\activate.bat"
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
