# Panduan Presentasi & Live Demo Kelompok 1

> **Studi Kasus:** Auto-Scaling & Load Balancing Sistem War Tiket Menggunakan Docker Swarm  
> **Waktu Alokasi:** 11 Menit (7 Menit Paparan & Live Demo + 4 Menit Sesi Tanya Jawab)  

---

## 1. Rencana Alokasi Waktu (Timeline 7 Menit)

| Waktu | Durasi | Agenda | Fokus Penyampaian |
|---|---|---|---|
| **00:00 - 01:30** | 1.5 Menit | Latar Belakang & Problem Statement | Karakteristik *flash crowd traffic* war tiket: lonjakan simultan, risiko crash, dan bahaya *race condition* (overselling). |
| **01:30 - 03:00** | 1.5 Menit | Arsitektur Sistem & Spesifikasi Komponen | Diagram arsitektur, Overlay Network `wartiket-net`, Nginx LB, Node.js Mock API (2 $\rightarrow$ 8 replika), Redis Lua Atomic Locking, serta pembuktian batas CPU 0.25 & RAM 256M. |
| **03:00 - 06:30** | 3.5 Menit | **Live Demo Terminal / Docker** | 1. Status stack & replika awal (2 worker)<br/>2. Tes distribusi load balancing (`node test-quick.js`)<br/>3. Eksekusi skalasi dinamis 2 $\rightarrow$ 8 replika (`docker service scale`)<br/>4. Simulasi Failover / Disaster Recovery (bunuh 2 container paksa saat traffic). |
| **06:30 - 07:00** | 0.5 Menit | Kesimpulan & Penutup | Keberhasilan sistem memenuhi target SLA (< 200ms, error < 1%) dan zero overselling. |
| **07:00 - 11:00** | 4.0 Menit | Sesi Tanya Jawab & Evaluasi Dosen | Menjawab pertanyaan penguji dengan tenang berbasis teknis. |

---

## 2. Naskah Presentasi (Script Kata-demi-Kata)

### Menit 00:00 - 01:30: Pembuka & Latar Belakang
> "Selamat pagi/siang Bapak/Ibu dosen dan rekan-rekan sekalian. Kami dari Kelompok 1 akan mempresentasikan progres tugas besar Cloud Computing kami yang berjudul: **Auto-Scaling & Load Balancing Sistem War Tiket Menggunakan Docker Swarm**.
> 
> Mengapa sistem war tiket menjadi studi kasus kami? Karena saat penjualan tiket konser dibuka, terjadi fenomena *flash crowd*—ribuan pengguna mengakses sistem dalam detik yang sama. Tantangan terbesarnya ada dua: 
> 1. Beban komputasi yang membuat server *hang* atau *Out-of-Memory*, dan 
> 2. Masalah *race condition*, di mana tiket bisa terjual melebihi kuota (*overselling*).
> 
> Solusi yang kami rancang adalah arsitektur *cloud-native* terorkestrasi dengan pembatasan sumber daya ketat: 0.25 core CPU dan 256MB RAM per container."

### Menit 01:30 - 03:00: Arsitektur & Desain Jaringan
> *(Tampilkan diagram arsitektur dari README.md)*  
> "Arsitektur kami terdiri dari tiga lapis komponen utama di dalam Docker Overlay Network `wartiket-net`:
> - **Pertama, Nginx Ingress Load Balancer**: Menjadi pintu gerbang port 80 yang menerima request lalu meneruskannya ke backend service dengan koneksi keep-alive tinggi.
> - **Kedua, Node.js Mock API Replicas**: Service worker yang memproses checkout dengan penundaan buatan 50–100ms. Service ini dirancang elastis, dapat diskalakan dari 2 hingga 8 replika secara instan.
> - **Ketiga, Redis Atomic State Store**: Menggunakan Redis Lua Scripting. Mengapa Lua script? Karena evaluasi stok dan pengurangan stok berjalan secara atomik dalam satu langkah di memori Redis. Ini menjamin tiket tidak akan pernah minus atau oversold."

### Menit 03:00 - 06:30: Live Demo di Terminal
> *(Buka Terminal / PowerShell yang sudah disiapkan)*  
> Ikuti **Urutan Eksekusi Live Demo** di Bab 3 di bawah ini.

### Menit 06:30 - 07:00: Penutup
> "Dari pengujian yang telah kami lakukan, sistem terbukti mampu menyeimbangkan beban trafik secara merata di antara replika, melakukan skalasi dari 2 ke 8 replika tanpa restart, serta melakukan *self-healing* instan ketika terjadi kegagalan container tanpa menggagalkan transaksi.
> Sekian pemaparan dari Kelompok 1, kami persilakan jika ada pertanyaan dari Bapak/Ibu dosen. Terima kasih."

---

## 3. Cheat Sheet Perintah Live Demo (Copy-Paste Ready)

Jalankan persiapan ini sebelum giliran kelompok Anda maju (di latar belakang):
```bash
# 1. Pastikan Docker Swarm aktif
docker swarm init

# 2. Deploy stack
docker stack deploy -c docker-compose.yml wartiket
```

### Langkah Demo 1: Tunjukkan Layanan & Resource Limits Aktif (30 Detik)
Tunjukkan bahwa stack berjalan dan sesuai batasan tugas:
```bash
docker stack services wartiket
docker stack ps wartiket
```
> *Poin bicara:* "Bisa kita lihat di sini, stack `wartiket` sedang aktif dengan 1 Nginx, 1 Redis, dan 2 replika awal Node.js worker."

---

### Langkah Demo 2: Buktikan Load Balancing Berjalan Merata (45 Detik)
Jalankan skrip tes cepat yang menembak 20 request bersamaan:
```bash
node test-quick.js
```
> *Poin bicara:* "Di tabel ini terlihat kolom `ServedBy` bergantian antar ID container. Ini membuktikan bahwa Nginx dan Docker Swarm Routing Mesh membagi beban transaksi secara adil (*round-robin*) ke seluruh replika."

---

### Langkah Demo 3: Demo Dynamic Scaling 2 $\rightarrow$ 8 Replika (45 Detik)
Lakukan scaling di depan dosen:
```bash
docker service scale wartiket_app=8
```
Verifikasi langsung:
```bash
docker service ps wartiket_app
```
> *Poin bicara:* "Hanya dalam hitungan 2 detik, Docker Swarm melipatgandakan worker dari 2 menjadi 8 container untuk mengantisipasi lonjakan trafik puncak war tiket."

---

### Langkah Demo 4: Demo Disaster Recovery & Failover (1 Menit)
Tunjukkan ketahanan sistem saat ada crash mendadak:
```bash
# Ambil salah satu ID container worker
docker ps --filter "name=wartiket_app" --format "{{.ID}}"

# Matikan 2 container secara paksa
docker rm -f <PASTE_CONTAINER_ID_1> <PASTE_CONTAINER_ID_2>
```
Jalankan kembali tes request segera setelah mematikan container:
```bash
node test-quick.js
```
Dan cek status Swarm:
```bash
docker service ps wartiket_app
```
> *Poin bicara:* "Meskipun 2 container worker dimatikan secara paksa, transaksi tetap sukses 100% tanpa error, dan Docker Swarm secara otomatis memunculkan container baru sebagai mekanisme *self-healing* (*Recovery Time Objective* mendekati nol)."

---

## 4. Bedah Tanya Jawab Dosen (Cheat Sheet Q&A 4 Menit)

Berikut prediksi pertanyaan umum dosen Cloud Computing beserta jawaban taktis:

### Q1: *"Mengapa menggunakan Redis Lua Script, kenapa tidak pakai query database biasa?"*
**Jawaban:**
> "Jika menggunakan database biasa dengan logika `SELECT stock` lalu `UPDATE stock = stock - 1`, pada kondisi 1000 request per detik akan terjadi *race condition* karena banyak request membaca nilai stok yang sama sebelum sempat ter-update. Dengan Redis Lua Script, operasi *check-and-decrement* dieksekusi secara atomik dalam satu siklus *single-threaded* di memori RAM, sehingga secara matematis mustahil terjadi *overselling*."

---

### Q2: *"Bagaimana peran Nginx jika Docker Swarm sendiri sudah punya Ingress Routing Mesh?"*
**Jawaban:**
> "Nginx bertindak sebagai *Ingress Reverse Proxy* di layer 7 (HTTP) yang menangani buffering koneksi pengguna, logging waktu respon upstream, serta menjaga koneksi *HTTP keep-alive*. Docker Swarm Ingress kemudian bekerja di layer 4 menggunakan IPVS (*IP Virtual Server*) untuk mendistribusikan paket TCP ke Virtual IP (VIP) masing-masing container replika secara transparan."

---

### Q3: *"Bagaimana Anda menjamin batasan resource CPU 0.25 dan RAM 256MB benar-benar dipatuhi?"*
**Jawaban:**
> "Kami menerapkannya secara eksplisit di berkas `docker-compose.yml` pada blok `deploy.resources.limits` dengan parameter `cpus: '0.25'` dan `memory: 256M`. Docker Swarm menggunakan Linux cgroups di level kernel untuk membatasi kuota CPU cycle dan memori, sehingga meskipun terjadi beban puncak 1000 VU, laptop host tidak akan mengalami *freeze* atau *hang*."

---

### Q4: *"Bagaimana sistem menangani failover saat container mati mendadak?"*
**Jawaban:**
> "Docker Swarm memiliki *healthcheck* bawaan dan *reconciling loop*. Swarm memantau status setiap task. Jika sebuah task mati mendadak, IPVS Swarm langsung mencoret IP task tersebut dari daftar upstream sehat agar tidak menerima trafik baru, sementara kontroler Swarm langsung membuat task pengganti untuk memenuhi target replika (misalnya tetap 8)."
