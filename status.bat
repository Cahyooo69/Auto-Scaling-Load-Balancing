@echo off
title TiketWar - Status Monitor
color 0F

echo =========================================================================
echo              MONITOR STATUS SISTEM ^& CONTAINER DOCKER
echo =========================================================================
echo.

echo --- Status Layanan (Services) ---
docker stack services wartiket
echo.

echo --- Daftar Container Aktif ---
docker stack ps wartiket --filter "desired-state=running"
echo.

echo --- Uji Respon Health Endpoint (HTTP) ---
powershell -Command "try { $res = Invoke-RestMethod -Uri 'http://localhost/health' -TimeoutSec 3; Write-Host 'Health Status: ' $res.status ' | Serving Container: ' $res.container ' | Redis: ' $res.redis ' | Database: ' $res.database -ForegroundColor Green } catch { Write-Host 'Health Check Gagal: ' $_.Exception.Message -ForegroundColor Red }"
echo.

echo =========================================================================
pause

