# ================================================================================
# DEMO PERTEMUAN 3: SCALABILITY & LOAD TESTING (1 - 1000 VU)
# Kelompok 1 - Cloud Computing
# ================================================================================

Write-Host "=== LANGKAH 1: Inisiasi Baseline (2 Replika) & Reset Stok ===" -ForegroundColor Cyan
docker service scale wartiket_app=2
Invoke-RestMethod -Method Post -Uri "http://localhost/tickets/reset" -ContentType "application/json" -Body '{"stock": 50000}'
Write-Host "Baseline 2 worker siap. Stok diisi 50.000." -ForegroundColor Green
Write-Host ""

Read-Host "Tekan [ENTER] untuk memulai Uji Beban Bertahap 2 Replika (Grafik Live akan otomatis terbuka)..."

Write-Host "=== LANGKAH 2: Uji Beban Bertahap 2 Replika (45 Detik) ===" -ForegroundColor Cyan
Start-Process "http://localhost:5665"
docker run --rm -p 5665:5665 --network wartiket_wartiket-net -v "${PWD}/load-test:/load-test" -e TARGET_URL="http://nginx" -e K6_WEB_DASHBOARD=true -e K6_WEB_DASHBOARD_PORT=5665 -e K6_WEB_DASHBOARD_HOST=0.0.0.0 grafana/k6 run /load-test/load-test-demo.js
Write-Host ""

Read-Host "Tekan [ENTER] untuk melakukan Skalasi Dinamis ke 8 Replika di depan dosen..."

Write-Host "=== LANGKAH 3: Scale-Out ke 8 Replika ===" -ForegroundColor Cyan
docker service scale wartiket_app=8
docker service ps wartiket_app --filter "desired-state=running"
Invoke-RestMethod -Method Post -Uri "http://localhost/tickets/reset" -ContentType "application/json" -Body '{"stock": 50000}'
Write-Host "8 worker aktif dan stok tiket di-reset ke 50.000." -ForegroundColor Green
Write-Host ""

Read-Host "Tekan [ENTER] untuk memulai Uji Beban Bertahap 8 Replika (Grafik Live akan otomatis terbuka)..."

Write-Host "=== LANGKAH 4: Uji Beban Bertahap 8 Replika (45 Detik) ===" -ForegroundColor Cyan
Start-Process "http://localhost:5665"
docker run --rm -p 5665:5665 --network wartiket_wartiket-net -v "${PWD}/load-test:/load-test" -e TARGET_URL="http://nginx" -e K6_WEB_DASHBOARD=true -e K6_WEB_DASHBOARD_PORT=5665 -e K6_WEB_DASHBOARD_HOST=0.0.0.0 grafana/k6 run /load-test/load-test-demo.js
Write-Host ""

Read-Host "Tekan [ENTER] untuk membuka Dokumen Laporan Formal & Grafik Perbandingan..."
Start-Process "Laporan_Progres_Gabungan_Pertemuan_1_2_dan_3_Kelompok_1_Formal.pdf"
Write-Host "Demo selesai dengan sukses!" -ForegroundColor Green

