@echo off
net session >nul 2>&1
if %errorlevel% neq 0 (
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

echo Menginstall sertifikat SSL wartiketkonser.id ke Windows Trusted Store...
powershell -Command "Import-Certificate -FilePath '%~dp0nginx\ssl\wartiket.crt' -CertStoreLocation 'Cert:\LocalMachine\Root'"

if %errorlevel% equ 0 (
    echo.
    echo [SUKSES] Sertifikat berhasil diinstall!
    echo Restart Chrome lalu buka https://wartiketkonser.id - tidak ada peringatan lagi.
) else (
    echo [ERROR] Gagal install sertifikat.
)
echo.
pause
