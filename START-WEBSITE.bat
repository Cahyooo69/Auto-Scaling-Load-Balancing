@echo off
setlocal
cd /d "%~dp0"
title TiketWar - Menyalakan Website
color 0A

echo =========================================================================
echo                  MENYALAKAN WEBSITE TIKETWAR CLOUD
echo =========================================================================
echo.
echo [1/2] Menjalankan seluruh container via Docker Compose...
docker-compose up -d

if %errorlevel% neq 0 (
    color 0C
    echo.
    echo [ERROR] Gagal menjalankan container. Pastikan Docker Desktop sudah aktif!
    echo.
    pause
    exit /b %errorlevel%
)

echo.
echo [2/2] Status container saat ini:
docker-compose ps
echo.
echo =========================================================================
echo       Website TiketWar Berhasil Dinyalakan di https://wartiketkonser.id
echo =========================================================================
echo.
echo Website dapat langsung diakses di:
echo   - Domain Resmi : https://wartiketkonser.id
echo   - Localhost    : http://localhost
echo.
echo Tekan sembarang tombol untuk menutup jendela ini...
pause >nul
