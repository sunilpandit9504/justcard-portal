@echo off
title Justcard Web Server
echo ========================================================
echo Starting Justcard Server...
echo ========================================================
start "" "http://localhost:3000"
node server.js
pause
