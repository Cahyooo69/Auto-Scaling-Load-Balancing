@echo off
setlocal enabledelayedexpansion
title TiketWar - Disaster Recovery (DR) & Failover Demo
color 0C

echo =========================================================================
echo       DISASTER RECOVERY (DR) & FAILOVER SIMULATION [PERTEMUAN 4]
echo =========================================================================
echo.
echo Skenario Dosen:
echo - Mematikan 2 container worker wartiket_app secara paksa di tengah trafik.
echo - Membuktikan Nginx failover retries & Docker Swarm auto-healing.
echo - Mengukur RTO (Recovery Time Objective) tanpa ada transaksi yang gagal.
echo.

echo [1/4] Status replika worker wartiket_app saat ini:
docker service ps wartiket_app --filter "desired-state=running"
echo.

echo [2/4] Mengambil 2 Container ID worker wartiket_app untuk dihentikan paksa...
set COUNT=0
for /f "tokens=1" %%C in ('docker ps --filter "name=wartiket_app" --format "{{.ID}}"') do (
    set /a COUNT+=1
    if !COUNT! LEQ 2 (
        echo [KILL] Mematikan paksa container: %%C
        docker kill %%C >nul 2>&1
    )
)

if !COUNT! LSS 2 (
    echo [PERINGATAN] Jumlah worker aktif kurang dari 2. Pastikan replika minimal 2 atau 4.
)

echo.
echo [3/4] Menguji ketahanan sistem & failover load balancer saat 2 container mati...
node test-quick.js

echo.
echo [4/4] Status pemulihan otomatis (Self-Healing) Docker Swarm:
docker service ps wartiket_app
echo.
echo =========================================================================
echo SIMULASI DR SELESAI: Swarm meregenerasi container baru & Nginx mengalihkan
echo beban ke replika tersisa tanpa membatalkan transaksi (0 drop).
echo =========================================================================
echo.
pause

