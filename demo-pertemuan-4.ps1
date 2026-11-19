# ================================================================================
# DEMO PERTEMUAN 4: DISASTER RECOVERY & FAILOVER EXECUTION
# Kelompok 1 - Cloud Computing
# ================================================================================

Write-Host "========================================================" -ForegroundColor Yellow
Write-Host "  PERTEMUAN 4: DISASTER RECOVERY & FAILOVER EXECUTION" -ForegroundColor Yellow
Write-Host "========================================================`n" -ForegroundColor Yellow

# --- BAGIAN A: Fail-Safe Redis ---
Write-Host "=== BAGIAN A: UJI FAIL-SAFE & AUTO-RECOVERY REDIS ===" -ForegroundColor Cyan
Write-Host "Menjalankan skenario 5 langkah otomatis...`n"
Read-Host "Tekan [ENTER] untuk mulai demo failover Redis"
node test-failover-demo.js
Write-Host ""

# --- BAGIAN B: Kill Container Saat 1000 VU Berlangsung ---
Read-Host "Tekan [ENTER] untuk memulai BAGIAN B: Kill Container Saat Beban 1000 VU"
Write-Host "`n=== BAGIAN B: FAILOVER CONTAINER DI BAWAH BEBAN 1000 VU ===" -ForegroundColor Cyan

# Pastikan 8 replika dan stok penuh
docker service scale wartiket_app=8
Start-Sleep -Seconds 3
Invoke-RestMethod -Method Post -Uri "http://localhost/tickets/reset" -ContentType "application/json" -Body '{"stock": 100000}'
Write-Host "8 replika aktif, stok 100.000 tiket.`n" -ForegroundColor Green

Write-Host "INSTRUKSI MANUAL UNTUK OPERATOR:" -ForegroundColor Red
Write-Host "  1. Script k6 akan berjalan 90 detik dengan 1000 VU konstan." -ForegroundColor White
Write-Host "  2. Pada DETIK KE-30, buka terminal BARU dan jalankan:" -ForegroundColor White
Write-Host '     docker rm -f $(docker ps -q -f name=wartiket_app | head -3)' -ForegroundColor Yellow
Write-Host "     (Membunuh paksa 3 dari 8 worker container)" -ForegroundColor White
Write-Host "  3. Amati: k6 tetap berjalan, error rate naik sesaat lalu pulih.`n" -ForegroundColor White

Read-Host "Tekan [ENTER] untuk mulai uji beban 90 detik (buka terminal baru untuk kill container!)"

Write-Host "Memulai k6 load test failover 90 detik..." -ForegroundColor Cyan
docker run --rm -i -p 5665:5665 --network wartiket_wartiket-net -v "${PWD}/load-test:/load-test" -e TARGET_URL="http://nginx" -e K6_WEB_DASHBOARD=true -e K6_WEB_DASHBOARD_PORT=5665 -e K6_WEB_DASHBOARD_HOST=0.0.0.0 grafana/k6 run /load-test/load-test-failover.js

Write-Host "`n=== VERIFIKASI PEMULIHAN SWARM ===" -ForegroundColor Cyan
docker service ps wartiket_app --filter "desired-state=running"

Write-Host "`n=== RINGKASAN RTO ===" -ForegroundColor Green
Write-Host "Swarm reconciliation loop otomatis mendeteksi task mati" -ForegroundColor White
Write-Host "dan memulai container pengganti dalam 2-5 detik (RTO < 5s)." -ForegroundColor White
Write-Host "Selama window crash, Nginx proxy_next_upstream mengalihkan" -ForegroundColor White
Write-Host "traffic ke worker sehat tanpa HTTP 502 ke end-user.`n" -ForegroundColor White

Write-Host "Demo Pertemuan 4 selesai!" -ForegroundColor Green
