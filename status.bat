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

echo --- Uji Respon Health Endpoint (HTTP via WAF -> LB -> App) ---
powershell -Command "try { $res = Invoke-RestMethod -Uri 'http://localhost/health' -TimeoutSec 3; Write-Host 'Health:' $res.status '| Worker:' $res.container '| Redis:' $res.redis '| DB Primary:' $res.database '| DB Replica:' $res.databaseReplica -ForegroundColor Green } catch { Write-Host 'Health Check Gagal:' $_.Exception.Message -ForegroundColor Red }"
echo.

echo =========================================================================
pause

