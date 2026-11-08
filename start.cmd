@echo off
rem Serve Grocer locally at http://localhost:8790 (ES modules need http, not file://)
cd /d "%~dp0"
start "" http://localhost:8790/
py -3 -m http.server 8790
