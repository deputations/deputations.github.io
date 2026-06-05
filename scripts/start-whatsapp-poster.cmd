@echo off
REM One-click launcher for the WhatsApp deputation poster.
REM   1) Opens Edge with the debug port + a dedicated profile (your business
REM      WhatsApp session — scan the QR once; it persists after that).
REM   2) Starts the local bridge in CDP mode so the admin "Send WhatsApp Update"
REM      button can post.
REM Keep this window open while you use the button. Ctrl+C stops the bridge.

cd /d "%~dp0\.."
set WA_USE_CDP=1
set WA_CHANNEL_NAME=Deputation Opportunities

set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

echo Launching Edge (business WhatsApp session, debug port 9222)...
start "" "%EDGE%" --remote-debugging-port=9222 --user-data-dir="%USERPROFILE%\edge-wa-business"

echo Waiting for Edge to come up...
timeout /t 6 /nobreak >nul

echo Starting the WhatsApp bridge...
python scripts\whatsapp_bridge.py
