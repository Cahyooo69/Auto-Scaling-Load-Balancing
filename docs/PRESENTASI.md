# Panduan Presentasi & Live Demo — Pertemuan 1 sampai 5

> **Kelompok 1 — Komputasi Awan (Kelas H7A.7)**  
> **Studi Kasus:** Auto-Scaling & Load Balancing Sistem War Tiket — Docker Swarm  
> **Dosen Pengampu:** Dr. Moch Yasin, S.Kom., M.Kom., M.B.A., CDCP  

---

## Persiapan Umum (Sebelum Presentasi)

```powershell
# 1. Buka Docker Desktop, pastikan Engine running
# 2. Buka terminal di folder project
cd "d:\Kuliah\Kuliah\SEMESTER 7\Cloud Computing\Auto-Scaling & Load Balancing"

# 3. Inisialisasi Swarm (sekali saja, lewati jika sudah)
docker swarm init

# 4. Build image backend & nginx
docker build -t wartiket-app:latest ./app
docker build -t wartiket-nginx:latest ./nginx

# 5. Deploy stack utama
docker stack deploy -c docker-compose.yml wartiket

# 6. Tunggu ~10 detik, verifikasi status
docker stack services wartiket
```

---

## PERTEMUAN 1: Planning & Architecture Design

### Luaran yang Harus Ditunjukkan
1. Diagram arsitektur sistem 3-Tier
2. Skema jaringan overlay Docker
3. Spesifikasi `docker-compose.yml` awal
4. Repositori Git kelompok

### Teks Presentasi

> "Selamat pagi/siang Bapak/Ibu Dosen. Kami dari Kelompok 1 mempresentasikan tugas besar yang berjudul **Auto-Scaling & Load Balancing Sistem War Tiket Menggunakan Docker Swarm**.
>
> **Latar belakang masalah:** Saat tiket konser dijual secara online, ribuan pembeli mengakses sistem dalam hitungan detik pertama (*flash crowd*). Tiga tantangan teknis utamanya:
> 1. **Server crash** karena CPU overload menangani ribuan koneksi simultan.
> 2. **Race condition** yang menyebabkan tiket terjual melebihi stok (*overselling*).
> 3. **Single Point of Failure (SPOF)** — satu server mati, seluruh layanan lumpuh.
>
> **Arsitektur solusi kami** terdiri dari 3 lapis utama di dalam jaringan overlay terisolasi `wartiket-net`:"

#### Cara Menunjukkan Diagram Arsitektur
Buka repositori GitHub atau file diagram di browser:
```
https://github.com/Cahyooo69/Auto-Scaling-Load-Balancing
```
> "**Layer 1 — Nginx Ingress Reverse Proxy:** Menerima seluruh trafik di Port 80. Nginx bertindak sebagai tameng karena ditulis dalam C dengan arsitektur *event-driven (epoll)*, mampu menampung puluhan ribu koneksi konkuren dengan konsumsi RAM sangat kecil.
>
> **Layer 2 — Node.js Microservice Workers:** Backend stateless yang memproses transaksi checkout. Dirancang elastis, dapat diskalakan dari 2 hingga 8 container secara dinamis tanpa downtime.
>
> **Layer 3 — Redis In-Memory Datastore:** Menyimpan kuota stok tiket di RAM. Menggunakan Lua Scripting atomik sehingga operasi cek stok dan pengurangan stok tereksekusi dalam satu siklus CPU Redis — menjamin *0% overselling* secara matematis."

#### Cara Menunjukkan Skema Jaringan Docker
```powershell
docker network ls --filter "name=wartiket"
docker network inspect wartiket_wartiket-net --format "{{.Driver}} | Attachable: {{.Attachable}}"
```
> "Jaringan menggunakan driver `overlay`. Port internal backend (3000) dan Redis (6379) tidak dibuka ke publik sama sekali. Satu-satunya pintu gerbang yang diekspos ke host adalah Port 80 Nginx."

#### Cara Menunjukkan docker-compose.yml
```powershell
code docker-compose.yml
```
Sorot poin kunci:
- `deploy.resources.limits`: `cpus: '0.25'` dan `memory: 256M`
- `networks.wartiket-net`: driver `overlay`
- `redis.command`: `redis-server --appendonly yes` (AOF volume persistence)

#### Cara Menunjukkan Repositori Git
```powershell
git remote -v
git log --oneline -5
```
> "Repositori publik kami: `https://github.com/Cahyooo69/Auto-Scaling-Load-Balancing.git` dengan riwayat komit rapi dari Pertemuan 1 hingga 5."

---

## PERTEMUAN 2: Environment Setup & Core Deployment

### Luaran yang Harus Ditunjukkan
1. Seluruh container **up & running** di jaringan internal Docker
2. Resource limit yang sudah diterapkan dan terverifikasi di level kernel Linux (cgroups)

### Teks Presentasi

> "Pada pertemuan kedua, kami membuktikan bahwa seluruh infrastruktur klaster telah berjalan dan batasan sumber daya berhasil ditegakkan oleh kernel sistem operasi."

### Langkah Demo

#### 1. Status Stack Running
```powershell
docker stack services wartiket
```
> "Layanan aktif dengan Nginx, App workers, dan Redis di jaringan `wartiket-net`."

#### 2. Daftar Task / Container Aktif
```powershell
docker stack ps --filter "desired-state=running" wartiket
```

#### 3. Validasi Penegakan Resource Limit di Level Kernel (Cgroups)
```powershell
docker service inspect wartiket_app --format "{{json .Spec.TaskTemplate.Resources}}"
```
Output validasi:
```json
{"Limits":{"NanoCPUs":250000000,"MemoryBytes":268435456}}
```
> "250.000.000 NanoCPUs = tepat 0,25 Core CPU. 268.435.456 Bytes = tepat 256 MB RAM fisik. Batasan ini ditegakkan langsung oleh kernel Linux via *Control Groups* (cgroups), melindungi laptop host dari freeze saat terjadi lonjakan trafik."

#### 4. Uji Round-Robin Load Balancing
```powershell
node test-quick.js
```
> "Tabel menampilkan kolom `ServedBy` yang terbagi rata antar ID container secara bergantian (*round-robin* 50:50)."

#### 5. Demo Tampilan Web Antarmuka
Buka browser:
```
http://localhost/
```
> "Menampilkan antarmuka live war tiket: counter kuota stok real-time, ID container pelayan, dan tombol reset kuota."

---

## PERTEMUAN 3: Scalability & Load Testing (1–1000 Clients)

### Luaran yang Harus Ditunjukkan
1. Eksekusi skrip pengujian beban bertahap (10 → 100 → 500 → 1.000 VU)
2. Grafik perbandingan throughput (RPS) dan waktu tanggap saat layanan diskalakan

### Teks Presentasi

> "Kami menguji batas kinerja sistem menggunakan Grafana k6 dengan beban bertahap 10 hingga 1.000 Virtual Users selama 45 detik. Kami membandingkan performa antara **Kondisi A (Baseline: 2 Replika)** dan **Kondisi B (Pasca-Skalasi: 8 Replika)**."

### Langkah Demo

Gunakan skrip runner otomatis:
```powershell
.\demo-pertemuan-3.ps1
```

Atau manual langkah demi langkah:

#### 1. Uji Kondisi Baseline (2 Replika)
```powershell
docker service scale wartiket_app=2
Invoke-RestMethod -Method Post -Uri "http://localhost/tickets/reset" -ContentType "application/json" -Body '{"stock": 50000}'

Start-Process "http://localhost:5665"
docker run --rm -p 5665:5665 --network wartiket_wartiket-net -v "${PWD}/load-test:/load-test" -e TARGET_URL="http://nginx" -e K6_WEB_DASHBOARD=true -e K6_WEB_DASHBOARD_PORT=5665 -e K6_WEB_DASHBOARD_HOST=0.0.0.0 grafana/k6 run /load-test/load-test-demo.js
```
> "Hasil 2 Replika: Throughput 1.090 req/s, Checks 99,5%, latensi p99 menyentuh 613 ms dan max 1.000 ms akibat *CPU throttling* pada alokasi 0,25 core."

#### 2. Skalasi Dinamis ke 8 Replika di Hadapan Penguji
```powershell
docker service scale wartiket_app=8
docker service ps wartiket_app --filter "desired-state=running"
Invoke-RestMethod -Method Post -Uri "http://localhost/tickets/reset" -ContentType "application/json" -Body '{"stock": 50000}'
```
> "Dalam 2 detik, Swarm melipatgandakan worker dari 2 menjadi 8 container secara horizontal tanpa merestart stack."

#### 3. Uji Kondisi Pasca-Skalasi (8 Replika)
```powershell
Start-Process "http://localhost:5665"
docker run --rm -p 5665:5665 --network wartiket_wartiket-net -v "${PWD}/load-test:/load-test" -e TARGET_URL="http://nginx" -e K6_WEB_DASHBOARD=true -e K6_WEB_DASHBOARD_PORT=5665 -e K6_WEB_DASHBOARD_HOST=0.0.0.0 grafana/k6 run /load-test/load-test-demo.js
```

#### 4. Tabel Komparasi Hasil Benchmark

| Parameter Metrik | Kondisi A: 2 Replika | Kondisi B: 8 Replika | Peningkatan / Efisiensi |
|---|:---:|:---:|:---:|
| **Pemenuhan SLA (Checks)** | 99,5% | **100,0%** | **Sempurna (0 dropped)** |
| **Throughput Transaksi** | 1.090 req/s | **1.220 req/s** | **+11,9% (+5.300 tiket)** |
| **Total Transaksi Selesai** | 50.100 Request | **55.400 Request** | Kapasitas naik |
| **Rata-Rata Latensi (`avg`)** | 131 ms | **98 ms** | **Turun 25,2% (< 100ms)** |
| **Persentil ke-95 (`p95`)** | 282 ms | **200 ms** | **Turun 29,1%** |
| **Persentil ke-99 (`p99`)** | 613 ms *(CPU Bottleneck)* | **297 ms** | **Terpangkas 51,5%** |
| **Maksimum Latensi (`max`)** | 1.000 ms | **399 ms** | **Terpangkas 60,1%** |
| **Kegagalan Server (5xx)** | 0,0% | 0,0% | Zero Failure & Zero Overselling |

---

## PERTEMUAN 4: Disaster Recovery (DR) & Failover Execution

### Luaran yang Harus Ditunjukkan
1. Live demo mematikan container utama secara paksa **saat** pengujian 1.000 VU berlangsung
2. Pembuktian failover dan pengukuran RTO (*Recovery Time Objective*)

### Teks Presentasi

> "Pertemuan ini membuktikan ketahanan sistem (*high availability & fault tolerance*). Kami menguji 3 skenario kegagalan: **(A)** Basis data Redis mati, **(B)** Worker container dibunuh paksa saat dihantam 1.000 VU, dan **(C)** Failover Nginx Reverse Proxy."

### Langkah Demo

Gunakan skrip runner otomatis:
```powershell
.\demo-pertemuan-4.ps1
```

Atau jalankan skenario berikut:

#### Bagian A: Demo Fail-Safe & Auto-Recovery Redis (2 Menit)
```powershell
node test-failover-demo.js
```
*Hasil Pembuktian:*
1. Transaksi baseline normal: `HTTP 200 OK`.
2. Redis dimatikan paksa (`docker service scale wartiket_redis=0`).
3. Transaksi saat Redis mati: **Ditolak aman (`HTTP 500 Fail-Safe`)** — sesuai prinsip CAP Theorem (*Consistency*), mencegah penjualan tiket fiktif.
4. Redis dihidupkan kembali (`scale wartiket_redis=1`).
5. Backend ioredis otomatis **Auto-Reconnect dalam 4 detik** tanpa perlu restart aplikasi.

#### Bagian B: Kill Worker Container Saat Pengujian 1.000 VU (3 Menit)

**Terminal 1 — Jalankan k6 sustain 90 detik:**
```powershell
docker service scale wartiket_app=8
Invoke-RestMethod -Method Post -Uri "http://localhost/tickets/reset" -ContentType "application/json" -Body '{"stock": 100000}'

docker run --rm -i -p 5665:5665 --network wartiket_wartiket-net -v "${PWD}/load-test:/load-test" -e TARGET_URL="http://nginx" -e K6_WEB_DASHBOARD=true -e K6_WEB_DASHBOARD_PORT=5665 -e K6_WEB_DASHBOARD_HOST=0.0.0.0 grafana/k6 run /load-test/load-test-failover.js
```

**Terminal 2 — Di detik ke-30, bunuh 3 container worker sekaligus:**
```powershell
docker rm -f $(docker ps -q -f name=wartiket_app | Select-Object -First 3)
```

**Terminal 2 — Verifikasi Swarm Self-Healing:**
```powershell
docker service ps wartiket_app --filter "desired-state=running"
```

> "Perhatikan hasil dasbor k6:
> - Saat 3 worker mati mendadak, konfigurasi Nginx `proxy_next_upstream error timeout http_502 http_503` langsung membelokkan transaksi ke 5 worker yang sehat. Pengguna akhir tidak mengalami HTTP 502.
> - Swarm *reconciling loop* mendeteksi 3 task hilang dan **membangkitkan 3 container baru dalam 2–5 detik**.
> - **RTO (Recovery Time Objective): $< 5\text{ detik}$.** Sistem pulih total."

#### Bagian C: Uji Gangguan Nginx Mati (High Availability)
```powershell
# Matikan paksa 1 container Nginx
docker rm -f $(docker ps -q -f name=wartiket_nginx | Select-Object -First 1)

# Uji respon port 80
curl.exe -I http://localhost/nginx-health
```
> "Port 80 tetap merespon instan dengan 0ms downtime berkat Swarm Ingress Mesh dan retry otomatis."

---

## PERTEMUAN 5: Monitoring & Final Demo

### Luaran yang Harus Ditunjukkan
1. Integrasi dashboard pemantauan (Prometheus & Grafana) menampilkan konsumsi memori & CPU per container
2. Laporan akhir & pembuktian pemenuhan silabus
3. Demo sistem utuh dari awal sampai akhir

### Teks Presentasi

> "Pada pertemuan terakhir, kami mengintegrasikan *monitoring stack cloud-native* berbasis **Prometheus, Grafana, cAdvisor, dan Node Exporter** untuk memantau metrik klaster secara transparan dan real-time."

### Langkah Demo

Gunakan skrip runner otomatis:
```powershell
.\demo-pertemuan-5.ps1
```

Atau manual langkah demi langkah:

#### 1. Deploy Monitoring Stack
```powershell
docker stack deploy -c docker-compose.monitoring.yml monitoring
docker stack services monitoring
```

#### 2. Buka Dashboard Grafana
Buka browser ke:
```
http://localhost:3000
```
- **Username:** `admin` | **Password:** `cloud2026`
- Buka dashboard: **War Tiket - Docker Swarm Monitoring**
> "Dashboard menampilkan:
> - **CPU Usage per Container (%)**: Menunjukkan utilisasi siklus CPU tiap container terhadap batas 0.25 core.
> - **Memory Usage per Container (MB)**: Memantau batas alokasi RAM 256MB.
> - **Network RX/TX (Bytes/sec)**: Throughput jaringan per container.
> - **Running Containers**: Jumlah task aktif real-time.
> - **Host CPU & Memory Gauge**: Kesehatan node host."

#### 3. Live Benchmark Sambil Amati Grafik Grafana
Jalankan uji beban 2 replika lalu 8 replika:
```powershell
# Uji 2 replika -> Amati grafik CPU 2 worker mendekati limit 25% (CPU bottleneck)
docker service scale wartiket_app=2
Invoke-RestMethod -Method Post -Uri "http://localhost/tickets/reset" -ContentType "application/json" -Body '{"stock": 50000}'
docker run --rm -i --network wartiket_wartiket-net -v "${PWD}/load-test:/load-test" -e TARGET_URL="http://nginx" grafana/k6 run /load-test/load-test-demo.js

# Scale ke 8 replika -> Amati 8 garis CPU terdistribusi rata di bawah 15%
docker service scale wartiket_app=8
Invoke-RestMethod -Method Post -Uri "http://localhost/tickets/reset" -ContentType "application/json" -Body '{"stock": 50000}'
docker run --rm -i --network wartiket_wartiket-net -v "${PWD}/load-test:/load-test" -e TARGET_URL="http://nginx" grafana/k6 run /load-test/load-test-demo.js
```

#### 4. Live Visualisasi Failover di Grafana
```powershell
docker rm -f $(docker ps -q -f name=wartiket_app | Select-Object -First 3)
```
> "Di layar Grafana terlihat jelas: 3 kurva CPU langsung jatuh ke 0, dan dalam 5 detik muncul 3 kurva baru dari container pengganti. Ini pembuktian visual paling mutlak dari *self-healing* Docker Swarm."

---

## Prediksi Pertanyaan Dosen & Jawaban Taktis

### Q1: *"Mengapa menggunakan Redis Lua Script, kenapa tidak pakai query database SQL biasa?"*
> "Database relasional konvensional membutuhkan dua langkah: `SELECT stock` lalu `UPDATE stock = stock - 1`. Pada konkurensi 1.000 transaksi per detik, jeda mikrodetik di antara kedua query memicu *race condition* karena ribuan thread membaca stok yang sama. Dengan Redis Lua Script, evaluasi ketersediaan dan dekremen stok tereksekusi secara atomik dalam satu siklus CPU di memori single-threaded Redis. Secara matematis mustahil terjadi *overselling*."

### Q2: *"Mengapa harus ada Nginx jika Docker Swarm sendiri sudah punya Ingress Routing Mesh?"*
> "Ada 4 alasan mutlak:
> 1. **Proteksi Event Loop Node.js:** Nginx berbasis C `epoll` menahan ribuan koneksi konkuren dengan RAM fraksional. Node.js yang single-threaded tidak tersandera oleh *TCP handshake storm*.
> 2. **Connection Pooling (`keepalive 128`):** Nginx menyerap 1.000 koneksi client dan menyalurkannya hanya lewat 128 soket persisten ke backend, mencegah habisnya port (*ephemeral socket exhaustion*).
> 3. **Isolasi Keamanan Layer 7:** Port backend (3000) dan Redis (6379) tertutup rapat di jaringan privat. Publik hanya mengakses Port 80.
> 4. **Disk I/O Buffering:** Log transaksi di-buffer di memori (64KB) dan ditulis secara kolektif, melindungi backend dari disk bottleneck."

### Q3: *"Bagaimana Anda menjamin batasan resource CPU 0.25 dan RAM 256MB benar dipatuhi?"*
> "Batasan didefinisikan di `docker-compose.yml` pada blok `deploy.resources.limits` (`cpus: '0.25'`, `memory: 256M`). Docker Swarm menerapkannya melalui Linux kernel *Control Groups (cgroups)*. Dapat divalidasi langsung via `docker service inspect wartiket_app --format '{{json .Spec.TaskTemplate.Resources}}'` yang menghasilkan tepat `250.000.000 NanoCPUs` dan `268.435.456 Bytes`."

### Q4: *"Apa yang terjadi jika basis data Redis crash saat transaksi berlangsung?"*
> "Backend Node.js dikonfigurasi dengan `enableOfflineQueue: false`. Begitu Redis terputus, transaksi langsung ditolak dengan respon aman `HTTP 500 Fail-Safe` tanpa crash. Sesuai prinsip CAP Theorem, sistem memprioritaskan *Consistency* daripada *Availability* palsu. Saat Redis hidup kembali, ioredis otomatis melakukan *auto-reconnect* dalam 4 detik tanpa restart server."

### Q5: *"Berapa Recovery Time Objective (RTO) saat container worker mati mendadak?"*
> "RTO sistem kami adalah **kurang dari 5 detik**. Nginx `proxy_next_upstream` mengalihkan transaksi aktif ke worker sehat secara instan (0 detik downtime bagi pengguna), sementara Docker Swarm mendeteksi task mati dan men-deploy container pengganti baru dalam rentang waktu 2 hingga 5 detik."

### Q6: *"Bagaimana persistensi data stok tiket dijamin jika container Redis dimatikan?"*
> "Redis dijalankan dengan flag `--appendonly yes` (AOF - Append Only File) yang dipetakan ke Docker Named Volume `redis-data:/data`. Setiap perubahan stok dicatat ke disk persisten host secara real-time, sehingga saat container Redis mati dan di-recreate, stok terakhir tidak pernah hilang."

---

## Matriks Pemenuhan Luaran Silabus Kuliah

| Pertemuan | Target Luaran Silabus Dosen Pengampu | Realisasi Implementasi | Status |
|:---:|---|---|:---:|
| **Pertemuan 1** | Diagram arsitektur sistem, skema jaringan Docker, spesifikasi `docker-compose.yml` awal, dan repositori Git kelompok. | Diagram Mermaid 3-tier, skema jaringan overlay `wartiket-net`, berkas compose lengkap, dan repositori GitHub aktif. | **LENGKAP 100%** |
| **Pertemuan 2** | Seluruh container dapat berjalan (*up & running*) dalam jaringan internal Docker dengan *resource limit* yang sudah diterapkan. | 3 Service (Nginx, App, Redis) running di Swarm, batas cgroups kernel 0.25 CPU dan 256MB RAM terverifikasi, load balancing round-robin 50:50. | **LENGKAP 100%** |
| **Pertemuan 3** | Eksekusi skrip pengujian beban bertahap. Grafik perbandingan *throughput* (RPS) dan waktu tanggap saat layanan diskalakan. | Skrip k6 bertahap 1–1.000 VU, komparasi visual dasbor k6 (2 vs 8 replika), tabel kuantitatif, lonjakan throughput ke 1.220 RPS, latensi p99 terpangkas 51,5%. | **LENGKAP 100%** |
| **Pertemuan 4** | Live demo mematikan container utama secara paksa saat pengujian 1.000 VU berlangsung. Pembuktian failover dan pengukuran RTO. | Runner `demo-pertemuan-4.ps1`, `load-test-failover.js`, kill 3/8 worker saat 1.000 VU, RTO < 5s, zero-downtime Nginx failover. | **LENGKAP 100%** |
| **Pertemuan 5** | Integrasi dashboard pemantauan (Prometheus/Grafana) yang menampilkan konsumsi memori/CPU, laporan akhir, serta demo sistem utuh. | `docker-compose.monitoring.yml` (Prometheus, Grafana, cAdvisor, Node Exporter), dashboard real-time Swarm, runner `demo-pertemuan-5.ps1`. | **LENGKAP 100%** |

---

## Ringkasan Skrip Demo per Pertemuan

| File Skrip | Pertemuan | Peran & Deskripsi Eksekusi |
|---|:---:|---|
| [`demo-pertemuan-3.ps1`](demo-pertemuan-3.ps1) | 3 | Runner interaktif uji beban bertahap (2 vs 8 replika) |
| [`demo-pertemuan-4.ps1`](demo-pertemuan-4.ps1) | 4 | Runner interaktif failover Redis & kill container saat 1.000 VU |
| [`demo-pertemuan-5.ps1`](demo-pertemuan-5.ps1) | 5 | Runner interaktif monitoring Prometheus/Grafana & demo utuh |
| [`test-failover-demo.js`](test-failover-demo.js) | 4 | Otomasi 5 skenario disaster recovery & auto-recovery Redis |
| [`load-test/load-test-failover.js`](load-test/load-test-failover.js) | 4 | Beban konstan 1.000 VU (90 detik) untuk pembuktian RTO |
| [`load-test/load-test-demo.js`](load-test/load-test-demo.js) | 3, 5 | Beban bertahap 45 detik (10 → 100 → 500 → 1.000 VU) |
| [`load-test/load-test-1000-users.js`](load-test/load-test-1000-users.js) | 3, 4 | Flash crowd instant spike 1.000 pengguna serentak |
| [`docker-compose.monitoring.yml`](docker-compose.monitoring.yml) | 5 | Stack monitoring (Prometheus, Grafana, cAdvisor, Node Exporter) |
