# Security Access Matrix, Communication Policy & Sharding Design

> **Disusun sesuai revisi arsitektur Dr. Moch Yasin** (*"Mengapa Server Besar Bisa Tumbang?"*)  
> **Prinsip Utama:** *Defense-in-Depth*, *Least Privilege*, *Zero Public Internal Ports*, *Read/Write Separation*, dan *Anti-Overselling Transaction TTL*.

---

## 1. Inventaris Server / Service & Batas Sumber Daya

| No | Service (Docker Swarm) | Layer | Replika | CPU Limit | RAM Limit | Port Publik | Port Internal (`wartiket-net`) |
|---:|---|---|:---:|:---:|:---:|:---:|:---:|
| 1 | `wartiket_waf` | Layer 1 — WAF Perimeter | 2 (HA) | 0.25 | 128 MB | **80, 443** | — |
| 2 | `wartiket_honeypot` | Layer 1 — Intrusion Trap | 1 | 0.10 | 64 MB | *(Tertutup)* | `8081` |
| 3 | `wartiket_nginx` | Layer 2 — LB & CDN Edge Cache | 2 (HA) | 0.25 | 256 MB | *(Tertutup)* | `80` |
| 4 | `wartiket_minio` | Layer 2 — Object Storage (S3) | 1 | 0.25 | 256 MB | *(Tertutup)* | `9000` (API), `9001` (Console) |
| 5 | `wartiket_app` | Layer 3 — Stateless API Workers | 2 → 8 | 0.25 | 256 MB | *(Tertutup)* | `3000` |
| 6 | `wartiket_redis` | Layer 4 — Session, Queue, Hot Cache | 1 | 0.25 | 256 MB | *(Tertutup)* | `6379` |
| 7 | `wartiket_pgbouncer` | Layer 5 — DB Pooler & Shard Router | 1 | 0.25 | 128 MB | *(Tertutup)* | `5432` |
| 8 | `wartiket_db-shard1-primary` | Layer 5 — Shard 1 Master (Konser 1) | 1 | 0.35 | 384 MB | *(Tertutup)* | `5432` |
| 9 | `wartiket_db-shard1-replica` | Layer 5 — Shard 1 Slave (Konser 1) | 1 | 0.25 | 256 MB | *(Tertutup)* | `5432` |
| 10 | `wartiket_db-shard2-primary` | Layer 5 — Shard 2 Master (Konser 2) | 1 | 0.35 | 384 MB | *(Tertutup)* | `5432` |
| 11 | `wartiket_db-shard2-replica` | Layer 5 — Shard 2 Slave (Konser 2) | 1 | 0.25 | 256 MB | *(Tertutup)* | `5432` |
| 12 | `wartiket_db-shard3-primary` | Layer 5 — Shard 3 Master (Konser 3) | 1 | 0.35 | 384 MB | *(Tertutup)* | `5432` |
| 13 | `wartiket_db-shard3-replica` | Layer 5 — Shard 3 Slave (Konser 3) | 1 | 0.25 | 256 MB | *(Tertutup)* | `5432` |

> **Port Hardening:** Hanya port **80 (HTTP)** dan **443 (HTTPS/TLS 1.2+)** pada `wartiket_waf` yang dibuka ke publik. Port SSH (`22`), FTP (`21`), App (`3000`), Redis (`6379`), PgBouncer/PostgreSQL (`5432`), MinIO (`9000/9001`), dan Honeypot (`8081`) **tertutup total dari publik**.

---

## 2. Daftar User, Kredensial & Hak Akses (*Least Privilege*)

> *Catatan Demo Kuliah:* Nilai kredensial di bawah adalah kredensial lingkungan praktikum lokal (`docker-compose.yml`). Di lingkungan produksi wajib dipindah ke Docker Secrets / Vault dan dirotasi berkala.

| Komponen | Username / Identity | Password / Secret (Env Praktikum) | Scope & Hak Akses Minimal (*Least Privilege*) | Larangan Eksplisit |
|---|---|---|---|---|
| **PostgreSQL Primary** | `wartiket` | `wartiket_secret` | Admin DDL — **hanya dipakai sekali saat boot** untuk migrasi skema (`schema.sql` / `seed.sql`). | Tidak dipakai oleh request transaksi/runtime API. |
| **PostgreSQL Primary (via PgBouncer)** | `app_writer` | `writer_secret_2026` | `SELECT, INSERT, UPDATE, DELETE` pada tabel `public` + `USAGE, SELECT` pada sequences. | **Dilarang** `CREATE`, `DROP`, `ALTER`, `TRUNCATE`, atau akses superuser. |
| **PostgreSQL Read Replica** | `app_reader` | `reader_secret_2026` | **`SELECT` ONLY** pada tabel `public` (katalog konser, denah kursi, login lookup, riwayat order). | **Dilarang** `INSERT`, `UPDATE`, `DELETE`, dan DDL (ditolak oleh role & mode *hot standby*). |
| **PostgreSQL Streaming Replication** | `replicator` | `replicator_secret_2026` | **`REPLICATION` ONLY** untuk `pg_basebackup` dan WAL streaming Primary → Replica. | **Dilarang** membaca/mengubah tabel aplikasi (`SELECT` ditolak). |
| **MinIO Object Storage** | `wartiket_minio` | `minio_secret_2026` | Pengelolaan bucket aset statis `wartiket-assets` (policy publik: *read-only download* via CDN Edge). | Bucket tidak menerima upload dari publik. |
| **Aplikasi API (Buyer)** | `user@wartiket.id` (`role: user`) | `password123` | Login stateless (JWT + Redis session), lihat katalog/kursi, `reserve`/`confirm`/`buy` atas `userId` sendiri, lihat `my-orders`. | Ditolak (`403`) melakukan IDOR atas `userId` lain atau `POST /api/tickets/reset`. |
| **Aplikasi API (Admin/Ops)** | `admin@wartiket.id` (`role: admin`) / `X-Admin-Key` | `password123` / `wartiket-admin-2026` | Akses `/api/tickets/reset`, `/api/admin/security-summary` (audit WAF & Honeypot), dashboard DevOps. | Hanya tersedia untuk role `admin`/`lecturer` atau ops key internal. |
| **Grafana Monitoring** | `admin` | `cloud2026` | Read-only visualisasi metrik cAdvisor, Node Exporter, & Honeypot (`GF_USERS_ALLOW_SIGN_UP=false`). | Tidak ada akses tulis ke DB atau aplikasi. |

---

## 3. Matriks Pola Komunikasi Antar-Layer

| Sumber (Source) | Tujuan (Destination) | Protokol & Port | Jalur & Kebijakan |
|---|---|---|---|
| Client / Internet | `wartiket_waf` | HTTP `80` / HTTPS `443` | Inspeksi SQLi, XSS, LFI, Bad-Bot, Rate Limiting (`limit_req`). |
| `wartiket_waf` | `wartiket_honeypot` | HTTP `8081` | **Hanya** path jebakan (`/wp-admin`, `/wp-login.php`, `/phpmyadmin`, `/.env`, `/config.php`, `/backup.sql`, `/.git`). |
| `wartiket_waf` | `wartiket_nginx` | HTTP `80` | Trafik bersih yang lolos WAF diteruskan ke Load Balancer & CDN Edge. |
| `wartiket_nginx` (CDN Edge) | `wartiket_minio` | HTTP `9000` | Pull-through cache (`proxy_cache cdn_cache`) untuk `cdn.wartiketkonser.id`, `/cdn/*`, `/img/*`, `/css/*`, `/js/*`. |
| `wartiket_nginx` (LB) | `wartiket_app` | HTTP `3000` | Round-robin Swarm Routing Mesh + failover `proxy_next_upstream`. |
| `wartiket_app` | `wartiket_redis` | TCP `6379` | Stateless login session, waiting queue, hot cache, & temporary seat lock (bukan penyimpanan transaksi finansial). |
| `wartiket_app` (Write) | `wartiket_pgbouncer` → `wartiket_db-primary` | TCP `5432` | Transaction pooling (`MAX_CLIENT_CONN=1000` → `DEFAULT_POOL_SIZE=40`), role `app_writer`, transaksi ACID 2-tahap (TTL 5 menit). |
| `wartiket_app` (Read) | `wartiket_db-replica` | TCP `5432` | Query baca (`SELECT` katalog, kursi, user, riwayat), role `app_reader`. Auto-failover ke Primary jika Replica mati. |
| `wartiket_db-replica` | `wartiket_db-primary` | TCP `5432` | Streaming WAL replication asinkron memakai role `replicator`. |
| `monitoring_prometheus` | `cadvisor:8080`, `node-exporter:9100`, `honeypot:8081` | HTTP (internal) | Scrape metrik setiap 5 detik melalui jaringan overlay internal. |

---

## 4. Rancangan Skalabilitas Lanjut: Sharding & Anti Split-Brain (Skala 1 Juta Customer)

Untuk skala praktikum laptop, proyek ini menjalankan **1 Primary + 1 Read Replica + PgBouncer** (terverifikasi langsung di Docker Swarm). Untuk skala produksi **1 juta+ customer serentak** sebagaimana dibahas Dr. Moch Yasin (`05:46–08:50` & `17:55–18:35`), arsitektur yang sama diperluas dengan pola:

1. **Horizontal Sharding Berbasis `concert_id` (Shard Key):**
   * Karena transaksi pembelian kursi bersifat atomik **per konser** (penonton Konser A tidak berebut kursi Konser B), tabel `seats`, `bookings`, `booking_details`, dan `transactions` dipartisi horizontal berdasarkan `concert_id % N` (mis. Shard 1 = Konser 1..100, Shard 2 = Konser 101..200, dst.) menggunakan router **Citus / PgBouncer Shard Router**.
   * Setiap Shard memiliki **1 Primary + minimal 1 Standby Replica (Backup)** di availability zone berbeda, sehingga matinya 1 shard tidak menghilangkan data dan tidak memengaruhi konser di shard lain.
2. **Penanganan Failover & Pencegahan Split-Brain (`07:20–08:40`):**
   * Jika Primary mati 5 detik lalu hidup kembali, aplikasi **tidak boleh bingung** mengirim data baru ke Primary lama vs Replica baru.
   * Solusinya menggunakan konsensus leader-election (**Patroni + etcd/Raft quorum minimal 3 node**) yang mempromosikan Standby menjadi Primary baru dan melakukan *fencing* (demote otomatis / `pg_rewind`) pada Primary lama saat kembali menyala, sementara router PgBouncer/HAProxy selalu mengarahkan koneksi `WRITE` hanya ke pemegang lease leader yang sah.
