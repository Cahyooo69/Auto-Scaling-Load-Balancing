@echo off
setlocal enabledelayedexpansion
title TiketWar - Auto-Scaling & Load Balancing Startup
color 0A

echo =========================================================================
echo       STARTUP OTOMATIS: AUTO-SCALING ^& LOAD BALANCING (TIKETWAR)
echo =========================================================================
echo.

:: 1. Periksa apakah Docker daemon / Docker Desktop sedang berjalan
echo [1/5] Memeriksa koneksi Docker Desktop...
docker info >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] Docker Desktop belum aktif atau belum berjalan!
    echo         Silakan buka aplikasi Docker Desktop terlebih dahulu,
    echo         tunggu hingga icon Docker di taskbar siap, lalu jalankan script ini lagi.
    echo.
    pause
    exit /b 1
)
echo [OK] Docker Desktop aktif.
echo.

:: 2. Periksa status Docker Swarm
echo [2/5] Memeriksa status Docker Swarm...
for /f "tokens=*" %%i in ('docker info --format "{{.Swarm.LocalNodeState}}" 2^>nul') do set SWARM_STATE=%%i
if /i not "%SWARM_STATE%"=="active" (
    echo [INFO] Menginisialisasi Docker Swarm cluster...
    docker swarm init >nul 2>&1
    if %errorlevel% neq 0 (
        echo [INFO] Inisialisasi swarm default...
        docker swarm init
    )
    echo [OK] Docker Swarm berhasil diaktifkan.
) else (
    echo [OK] Docker Swarm sudah aktif.
)
echo.

:: 3. Build image terbaru
echo [3/5] Memeriksa dan mem-build image container...
echo   - Membangun wartiket-app (Node.js API)...
docker build -t wartiket-app:latest ./app >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Gagal mem-build image wartiket-app. Menampilkan log build:
    docker build -t wartiket-app:latest ./app
    pause
    exit /b 1
)

echo   - Membangun wartiket-nginx (Reverse Proxy & Ingress LB)...
docker build -t wartiket-nginx:latest ./nginx >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Gagal mem-build image wartiket-nginx. Menampilkan log build:
    docker build -t wartiket-nginx:latest ./nginx
    pause
    exit /b 1
)
echo [OK] Seluruh image berhasil disiapkan.
echo.

:: 4. Deploy stack ke Docker Swarm
echo [4/5] Menerapkan stack 'wartiket' ke Docker Swarm...
docker stack deploy -c docker-compose.yml wartiket
echo.

:: 5. Tunggu inisialisasi awal & cek kesehatan layanan
echo [5/5] Menunggu layanan terhubung dan siap (5 detik)...
timeout /t 5 /nobreak >nul
echo.

echo =========================================================================
echo                      STATUS LAYANAN DOCKER AKTIF
echo =========================================================================
docker stack services wartiket
echo.

echo Container yang sedang berjalan:
docker stack ps wartiket --filter "desired-state=running"
echo.

echo =========================================================================
echo              BERHASIL! SISTEM SIAP DIGUNAKAN DI BROWSER
echo =========================================================================
echo.
echo Akses website Anda di:
echo   - Localhost : http://localhost
echo   - Domain    : https://wartiketkonser.id
echo.
echo Perintah praktis selanjutnya:
echo   - Uji Load Balancing : node test-quick.js
echo   - Scale Worker (2-8) : .\scale.bat [jumlah]
echo   - Cek Status         : .\status.bat
echo   - Hentikan Sistem    : .\stop.bat
echo.
echo =========================================================================
echo Selesai. Tekan sembarang tombol untuk menutup jendela ini...
pause >nul

