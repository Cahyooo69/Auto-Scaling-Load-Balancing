@echo off
cd /d "%~dp0"
docker-compose down --remove-orphans
echo Container sedang dihentikan...
docker-compose ps
pause
