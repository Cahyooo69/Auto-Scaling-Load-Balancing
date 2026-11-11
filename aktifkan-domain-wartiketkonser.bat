@echo off
:: Auto-elevate: jika bukan admin, minta UAC
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Memerlukan hak Administrator. Membuka permintaan UAC...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

title Mengaktifkan Domain wartiketkonser.id
color 0A
cls
echo =========================================================================
echo    MENGAKTIFKAN DOMAIN WARTIKETKONSER.ID DI KOMPUTER LOKAL
echo =========================================================================
echo.

set HOSTS_FILE=%windir%\system32\drivers\etc\hosts

:: Periksa apakah domain sudah terdaftar
findstr /i "wartiketkonser.id" "%HOSTS_FILE%" >nul
if %errorlevel% equ 0 (
    echo [OK] Domain wartiketkonser.id sudah terdaftar.
    echo [PROSES] Menghapus entri lama dan menulis ulang...
    :: Hapus baris lama lalu tambah ulang agar bersih
    powershell -Command "(Get-Content '%HOSTS_FILE%') | Where-Object { $_ -notmatch 'wartiketkonser' } | Set-Content '%HOSTS_FILE%'"
)

echo [PROSES] Menambahkan 127.0.0.1 wartiketkonser.id ...
echo. >> "%HOSTS_FILE%"
echo 127.0.0.1 wartiketkonser.id >> "%HOSTS_FILE%"
echo 127.0.0.1 www.wartiketkonser.id >> "%HOSTS_FILE%"
echo [SUKSES] Domain berhasil didaftarkan!

:: Verifikasi berhasil ditulis
findstr /i "wartiketkonser.id" "%HOSTS_FILE%" >nul
if %errorlevel% neq 0 (
    echo [ERROR] Gagal menulis ke hosts file! Coba jalankan sebagai Administrator.
    pause
    exit /b 1
)

:: Bersihkan cache DNS
echo [PROSES] Membersihkan cache DNS Windows...
ipconfig /flushdns

echo.
echo =========================================================================
echo   BERHASIL! Domain wartiketkonser.id SUDAH AKTIF.
echo =========================================================================
echo.
echo Isi hosts file yang ditambahkan:
findstr /i "wartiketkonser" "%HOSTS_FILE%"
echo.
echo Langkah selanjutnya:
echo 1. Pastikan Docker sudah running: docker-compose up -d
echo 2. Buka browser, ketik: http://wartiketkonser.id
echo    (untuk https, ketik: https://wartiketkonser.id dan klik "Advanced" lalu "Proceed")
echo.
pause
