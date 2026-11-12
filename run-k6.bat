@echo off
title TiketWar - Pengujian Beban k6 (1000 VU)
color 0B

echo =========================================================================
echo       K6 LOAD TESTING: SISTEM WAR TIKET KONSER (1.000 VIRTUAL USERS)
echo =========================================================================
echo.
echo Tahapan Pengujian (Durasi Total 3 Menit):
echo   1. Tahap 1 (30s) : 10 VU   (Baseline ^& Sanity Check)
echo   2. Tahap 2 (45s) : 100 VU  (Ramp-Up Awal)
echo   3. Tahap 3 (45s) : 500 VU  (Beban Menengah)
echo   4. Tahap 4 (60s) : 1000 VU (Peak War Tiket / Lonjakan Maksimal)
echo.
echo Alur Pengguna: Login -^> Lihat Katalog Konser -^> War Tiket Checkout
echo.

where k6 >nul 2>&1
if %errorlevel% equ 0 (
    echo [INFO] Menjalankan k6 native...
    k6 run load-test/load-test.js
) else (
    echo [INFO] k6 native tidak ditemukan. Menjalankan k6 via Docker container...
    type load-test\load-test.js | docker run --rm -i -e TARGET_URL=http://host.docker.internal grafana/k6 run -
)

echo.
echo =========================================================================
echo Pengujian Selesai.
pause

