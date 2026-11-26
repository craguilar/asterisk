@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1 || (echo Install Node.js 24, then reopen this file. & pause & exit /b 1)
set "ASTERISK_MODE=live"
set "ASTERISK_DEMO_DIR=.asterisk/live"
if not defined PORT set "PORT=4318"
echo Open http://127.0.0.1:%PORT% after Asterisk has read the public match feeds.
node --use-system-ca dist/main.js demo
if errorlevel 1 pause
