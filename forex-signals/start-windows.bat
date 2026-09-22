@echo off
rem Runs forex-signals on this Windows PC and opens it in the browser.
rem Needs Node.js 22.9+ (https://nodejs.org). Close this window to stop it.
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 22.9 or newer is required: https://nodejs.org & pause & exit /b 1)
if not exist node_modules (
  call npm install --omit=dev || (pause & exit /b 1)
)
if not exist .env (
  copy .env.example .env >nul
  echo .env was created. Fill in ANTHROPIC_API_KEY and APP_PASSWORD, save it, then run this file again.
  notepad .env
  exit /b 0
)
start "" cmd /c "timeout /t 5 >nul & start http://localhost:3000"
node --env-file-if-exists=.env server.js
pause
