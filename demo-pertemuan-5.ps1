# ================================================================================
# DEMO PERTEMUAN 5: MONITORING & FINAL DEMO
# Kelompok 1 - Cloud Computing
# ================================================================================

Write-Host "========================================================" -ForegroundColor Yellow
Write-Host "  PERTEMUAN 5: MONITORING DASHBOARD & FINAL DEMO" -ForegroundColor Yellow
Write-Host "========================================================`n" -ForegroundColor Yellow

# --- LANGKAH 1: Deploy Monitoring Stack ---
Write-Host "=== LANGKAH 1: DEPLOY MONITORING STACK (Prometheus + Grafana + cAdvisor) ===" -ForegroundColor Cyan
docker stack deploy -c docker-compose.monitoring.yml monitoring
Write-Host "Menunggu 10 detik agar monitoring stack siap..." -ForegroundColor Gray
Start-Sleep -Seconds 10

Write-Host "Verifikasi monitoring services:" -ForegroundColor Cyan
docker stack services monitoring
Write-Host ""

# --- LANGKAH 2: Buka Dashboard ---
Write-Host "=== LANGKAH 2: MEMBUKA DASHBOARD ===" -ForegroundColor Cyan
Write-Host "Grafana   : http://localhost:3000  (admin / cloud2026)" -ForegroundColor Green
Write-Host "Prometheus: http://localhost:9090" -ForegroundColor Green
Write-Host "cAdvisor  : http://localhost:8080" -ForegroundColor Green
Start-Process "http://localhost:3000"
Write-Host ""

Read-Host "Tekan [ENTER] setelah login Grafana dan membuka dashboard 'War Tiket - Docker Swarm Monitoring'"

# --- LANGKAH 3: Final Load Test Sambil Pantau Grafana ---
Write-Host "`n=== LANGKAH 3: FINAL LOAD TEST SAMBIL PANTAU GRAFANA REAL-TIME ===" -ForegroundColor Cyan
docker service scale wartiket_app=2
Start-Sleep -Seconds 2
Invoke-RestMethod -Method Post -Uri "http://localhost/tickets/reset" -ContentType "application/json" -Body '{"stock": 50000}'
Write-Host "Baseline: 2 replika, stok 50.000`n" -ForegroundColor Green

Read-Host "Tekan [ENTER] untuk mulai uji beban 2 replika (amati CPU/Memory naik di Grafana)"
docker run --rm -i --network wartiket_wartiket-net -v "${PWD}/load-test:/load-test" -e TARGET_URL="http://nginx" grafana/k6 run /load-test/load-test-demo.js
Write-Host ""

# --- LANGKAH 4: Scale-Out dan Uji Lagi ---
Write-Host "=== LANGKAH 4: SCALE-OUT KE 8 REPLIKA DAN UJI ULANG ===" -ForegroundColor Cyan
docker service scale wartiket_app=8
Start-Sleep -Seconds 3
Invoke-RestMethod -Method Post -Uri "http://localhost/tickets/reset" -ContentType "application/json" -Body '{"stock": 50000}'
Write-Host "8 replika aktif, stok di-reset.`n" -ForegroundColor Green

Read-Host "Tekan [ENTER] untuk mulai uji beban 8 replika (amati CPU terdistribusi merata di Grafana)"
docker run --rm -i --network wartiket_wartiket-net -v "${PWD}/load-test:/load-test" -e TARGET_URL="http://nginx" grafana/k6 run /load-test/load-test-demo.js
Write-Host ""

# --- LANGKAH 5: Demonstrasi Failover di Grafana ---
Write-Host "=== LANGKAH 5: DEMONSTRASI FAILOVER DI GRAFANA ===" -ForegroundColor Cyan
Write-Host "Amati panel 'Running Containers' di Grafana." -ForegroundColor White
Write-Host "Sekarang bunuh 3 container:" -ForegroundColor Red
Write-Host ""

$containers = docker ps -q -f name=wartiket_app | Select-Object -First 3
if ($containers) {
    Write-Host "Membunuh container: $($containers -join ', ')" -ForegroundColor Yellow
    $containers | ForEach-Object { docker rm -f $_ }
    Write-Host "Amati di Grafana: garis CPU 3 container menghilang," -ForegroundColor White
    Write-Host "lalu muncul kembali saat Swarm me-respawn replacement.`n" -ForegroundColor White
    Start-Sleep -Seconds 8
    docker service ps wartiket_app --filter "desired-state=running"
}

Write-Host "`n========================================================" -ForegroundColor Green
Write-Host "  DEMO PERTEMUAN 5 SELESAI - SISTEM UTUH TERVERIFIKASI" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
