@echo off
cd /d "%~dp0"
where node >nul 2>&1 || (echo Install Node.js 24, then reopen this file. & pause & exit /b 1)
echo Open http://127.0.0.1:4317 after the service starts.
node dist/main.js demo
if errorlevel 1 pause
