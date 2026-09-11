@echo off
rem local-ocr-kit - double-click to start (Windows 10/11, no install, no admin)
cd /d "%~dp0"
echo Starting local-ocr-kit... your browser will open automatically when the engine is ready.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0winocr.ps1" -OpenBrowser
echo.
echo The server has stopped. You can close this window.
pause
