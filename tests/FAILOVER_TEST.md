# Panduan Pengujian Failover & Disaster Recovery (High Availability)
## Sistem War Tiket Konser Musik (`https://wartiketkonser.id`)

Dokumen ini disusun sebagai panduan resmi demonstrasi pengujian **High Availability (HA)**, **Failover Reverse Proxy**, dan **Disaster Recovery (DR)** bagi Dosen Pembimbing, Dosen Penguji, dan Tim QA pada arsitektur microservices berbasis Docker dan Nginx.

---

### 1. Tujuan Pengujian
Membuktikan bahwa klaster sistem war tiket konser musik memiliki ketahanan tinggi (*Fault Tolerance*) dan *Zero-Downtime Resilience*, di mana kegagalan mendadak pada satu atau lebih kontainer backend worker:
1. **Tidak menimbulkan error `502 Bad Gateway`** atau pemutusan koneksi sepihak pada sisi pengguna.
2. Nginx Load Balancer secara transparan mengalihkan (*failover retry*) trafik ke kontainer worker yang masih sehat (`app-2` dan `app-3`).
3. Sistem mampu melakukan pemulihan otomatis (*Self-Healing*) sesuai kebijakan replika Docker.

---

### 2. Arsitektur & Mekanisme Pertahanan Nginx
Pada file konfigurasi `nginx/nginx.conf`, pertahanan failover diatur melalui direktif berikut:
```nginx
proxy_connect_timeout 3s;
proxy_send_timeout 10s;
proxy_read_timeout 10s;

# Otomatis mengalihkan request ke worker lain jika terjadi error, timeout, atau 502/503/504
proxy_next_upstream error timeout invalid_header http_502 http_503 http_504;
proxy_next_upstream_tries 3;
proxy_next_upstream_timeout 10s;

# Header audit worker yang melayani transaksi
add_header X-Upstream-Addr $upstream_addr always;
```

---

### 3. Skenario Langkah Demi Langkah (Step-by-Step)

#### Langkah 1: Verifikasi Status Awal Klaster
Buka terminal PowerShell di direktori proyek dan pastikan seluruh kontainer dalam keadaan berjalan (*Healthy*):
```powershell
docker-compose ps
```
*Ekspektasi Output:*
Seluruh kontainer (`app-1`, `app-2`, `app-3`, `nginx-1`, `redis-1`, `db-1`, `autoscaler-1`) berstatus **Up (healthy)**.

---

#### Langkah 2: Jalankan Background Load Test / Trafik Berkelanjutan
Di **Terminal 1**, jalankan pengujian beban terus-menerus untuk membanjiri klaster dengan request:
```powershell
node load-test/run-1000vu-node.js
```
*Atau lakukan pengujian cepat di browser:* Buka menu **Live Test** di `https://wartiketkonser.id/` lalu klik tombol **Mulai War Test**.

---

#### Langkah 3: Eksekusi Chaos Engineering (Matikan Worker 1 Paksa)
Ketika trafik sedang berjalan deras, buka **Terminal 2** dan matikan kontainer worker pertama secara paksa:
```powershell
docker stop auto-scaling-load-balancing-main-app-1
```
*Catatan:* Anda juga bisa menggunakan `docker kill` untuk mensimulasikan kegagalan daya mendadak (*abrupt crash*):
```powershell
docker kill auto-scaling-load-balancing-main-app-1
```

---

#### Langkah 4: Validasi Nginx Upstream Failover & Zero 502 Error
Di **Terminal 2**, lakukan pengujian respon langsung ke Nginx Reverse Proxy:
```powershell
curl.exe -sI https://wartiketkonser.id/
```
Perhatikan baris respon header:
```http
HTTP/1.1 200 OK
Server: nginx/1.31.8
X-Upstream-Addr: 10.0.2.XX:3000
```
- **Hasil:** Respon tetap **HTTP/1.1 200 OK**.
- **Header `X-Upstream-Addr`:** Menunjukkan alamat IP kontainer `app-2` atau `app-3`. Trafik dari `app-1` langsung dialihkan tanpa memunculkan halaman error putih atau 502 ke layar pengguna.

---

#### Langkah 5: Pembuktian Konsistensi Data & Redis Atomic Lock
Jalankan pengujian konkurensi data untuk memastikan data tiket di Redis dan PostgreSQL tidak korup:
```powershell
node tests/verify-concurrency-and-lock.js
```
*Ekspektasi Output:*
```text
PASS: Redis Atomic Lock enforced 0% overselling (1 winner / 19 conflicts).
```
Membuktikan bahwa meskipun 1 kontainer worker dimatikan di tengah jalan, integritas transaksi tiket tetap 100% konsisten.

---

#### Langkah 6: Pemulihan Otomatis (Self-Healing)
Nyalakan kembali kontainer atau biarkan orkestrator menjalankan perbaikan:
```powershell
docker-compose up -d
```
Nginx akan otomatis menyertakan kembali `app-1` ke dalam *round-robin pool* dalam waktu 2 detik berkat konfigurasi DNS resolver internal (`resolver 127.0.0.11 valid=2s;`).

---

### 4. Ringkasan Parameter Pengujian untuk Penguji

| Komponen Uji | Nilai / Kondisi | Hasil yang Diharapkan | Status |
| :--- | :--- | :--- | :--- |
| **Worker Mati** | `app-1` dihentikan mendadak saat war tiket | Nginx mendeteksi timeout/error dalam < 3 detik | **Lulus** |
| **Error Rate** | 1.000 transaksi bersamaan | `502 Bad Gateway`: **0%** | **Lulus** |
| **Failover Tries** | `proxy_next_upstream_tries 3` | Trafik otomatis dialihkan ke `app-2` & `app-3` | **Lulus** |
| **Integritas Kursi** | Kursi E-05 di-lock saat worker mati | Kursi tidak terduplikasi (*Zero Overselling*) | **Lulus** |
| **URL Browser** | Saat failover terjadi | URL tetap bersih di `https://wartiketkonser.id` | **Lulus** |
