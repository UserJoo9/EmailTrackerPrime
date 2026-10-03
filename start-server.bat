@echo off
title EmailTracker Prime - Backend Server
echo ===================================================
echo     Starting EmailTracker Prime Server...
echo ===================================================
cd /d "%~dp0server"
if not exist node_modules (
    echo Installing dependencies...
    call npm install
)
node server.js
pause
