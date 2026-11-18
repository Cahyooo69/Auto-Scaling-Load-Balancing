@echo off
cd /d "%~dp0"
docker-compose up -d --build
echo Container sedang dijalankan...
docker-compose ps
pause
