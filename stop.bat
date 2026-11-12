@echo off
title TiketWar - Stop System
color 0E

echo =========================================================================
echo              MENGHENTIKAN SISTEM TIKETWAR SECARA BERSIH
echo =========================================================================
echo.

echo [PROSES] Menghapus stack 'wartiket' dari Docker Swarm...
docker stack rm wartiket

echo.
echo [INFO] Menunggu Docker Desktop menghentikan seluruh container (5 detik)...
timeout /t 5 /nobreak >nul

echo.
echo =========================================================================
echo Status container tersisa:
docker ps --filter "name=wartiket"
echo.
echo [BERHASIL] Seluruh layanan TiketWar telah dihentikan secara rapi.
echo            Docker Desktop kini bersih tanpa container yatim (orphan).
echo =========================================================================
echo.
pause

