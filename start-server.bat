@echo off
title EmailTracker Prime - Local Server
cd /d "%~dp0"
if not exist node_modules (
    echo Installing dependencies...
    call npm install
)
if not exist .env (
    echo [!] No .env found. Copy .env.example to .env and set API_KEY.
)
node src/server.js
pause
