@echo off
cd /d "%~dp0"
docker-compose down
echo Container sedang dihentikan...
docker-compose ps
pause
