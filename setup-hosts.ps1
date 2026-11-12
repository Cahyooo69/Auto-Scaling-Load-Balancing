$hostsPath = "$env:windir\system32\drivers\etc\hosts"
$content = Get-Content -Path $hostsPath -Raw

if ($content -notmatch "wartiketkonser\.id") {
    $entry = "`r`n# Domain Lokal TiketWar`r`n127.0.0.1 wartiketkonser.id`r`n127.0.0.1 www.wartiketkonser.id`r`n"
    [System.IO.File]::AppendAllText($hostsPath, $entry)
    Write-Host "[BERHASIL] wartiketkonser.id berhasil didaftarkan ke hosts Windows!" -ForegroundColor Green
} else {
    Write-Host "[INFO] wartiketkonser.id sudah ada di hosts Windows." -ForegroundColor Cyan
}

ipconfig /flushdns
Write-Host "[BERHASIL] DNS Cache telah dibersihkan!" -ForegroundColor Green
Start-Sleep -Seconds 3
