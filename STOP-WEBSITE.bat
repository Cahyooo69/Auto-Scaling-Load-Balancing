@echo off
setlocal
cd /d "%~dp0"
title TiketWar - Mematikan Website
color 0E

echo =========================================================================
echo                  MEMATIKAN WEBSITE TIKETWAR CLOUD
echo =========================================================================
echo.
echo [1/2] Menghentikan seluruh container via Docker Compose...
docker-compose down

if %errorlevel% neq 0 (
    color 0C
    echo.
    echo [ERROR] Terjadi kendala saat mematikan container.
    echo.
    pause
    exit /b %errorlevel%
)

echo.
echo =========================================================================
echo               Website TiketWar Berhasil Dimatikan
echo =========================================================================
echo.
echo Seluruh layanan (Nginx, App Workers, Redis, DB, Autoscaler) telah berhenti.
echo.
echo Tekan sembarang tombol untuk menutup jendela ini...
pause >nul
