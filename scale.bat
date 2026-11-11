@echo off
setlocal enabledelayedexpansion
title TiketWar - Auto-Scaling Worker
color 0B

echo =========================================================================
echo              DYNAMIC AUTO-SCALING WORKER [NODE.JS API]
echo =========================================================================
echo.

set "TARGET_REPLICAS=%~1"

if "%TARGET_REPLICAS%"=="" (
    echo Replika worker backend wartiket_app saat ini:
    docker service ls --filter "name=wartiket_app"
    echo.
    set /p "TARGET_REPLICAS=Masukkan target jumlah replika [contoh 2, 4, 8]: "
)

if "%TARGET_REPLICAS%"=="" (
    echo [BATAL] Tidak ada nilai replika yang dimasukkan.
    pause
    exit /b 0
)

echo.
echo [PROSES] Melakukan scaling wartiket_app ke %TARGET_REPLICAS% replika...
docker service scale wartiket_app=%TARGET_REPLICAS%
if %errorlevel% neq 0 (
    echo [ERROR] Gagal melakukan scaling. Pastikan stack wartiket sudah berjalan.
    pause
    exit /b 1
)

echo.
echo [SUKSES] Scaling berhasil diajukan. Status task replika:
echo.
docker service ps wartiket_app --filter "desired-state=running"
echo.
echo Untuk menguji pembagian beban secara merata ke seluruh replika:
echo Jalankan: node test-quick.js
echo.
pause
