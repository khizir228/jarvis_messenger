@echo off
cd /d "%~dp0"
netstat -ano | findstr :8000
pause
