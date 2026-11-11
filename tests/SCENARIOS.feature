# language: id
Fitur: Pengujian End-to-End, Stabilitas Anti-Stuck, dan Konkurensi Sistem War Tiket Konser Musik

  Latar Belakang:
    Dengan cluster Docker Swarm ("wartiket_app", "wartiket_nginx", "wartiket_redis", "wartiket_db") berjalan di "http://localhost"
    Dan kuota demo telah direset ke kondisi awal melalui "POST /api/tickets/reset"

  Skenario Outline: [Skenario 1] Autentikasi Multi-POV Demo Account (2 POV)
    Dengan pengguna berada di halaman Beranda "/"
    Ketika pengguna menekan tombol "#navBtnAuth" ("Masuk") pada top navbar
    Dan pengguna memilih tombol demo akun "<label_pov>" untuk mengisi email "<email>"
    Dan pengguna menekan tombol "#btnLoginSubmit" ("Masuk Sekarang")
    Maka request "POST /api/auth/login" mengembalikan HTTP 200 dengan data profil "<nama_lengkap>"
    Dan label "#navAuthLabel" pada navbar berubah dari "Masuk" menjadi nama akun aktif
    Dan "#navBtnAuth" tidak macet dalam status loading

    Contoh:
      | label_pov | email             | nama_lengkap   |
      | ADMIN     | admin@wartiket.id | Admin WarTiket |
      | USER      | user@wartiket.id  | User Penonton  |

  Skenario: [Skenario 2] Navigasi SPA Anti-Jitter, Top Navbar Sticky/Fixed, dan Footer 3 Kolom
    Dengan pengguna membuka "/"
    Ketika pengguna memverifikasi top navbar ".navbar"
    Maka ikon pencarian "#btnToggleSearchPanel" terlihat di sebelah tombol "Masuk" pada "/" dan "/konser"
    Tetapi ikon pencarian "#btnToggleSearchPanel" tersembunyi pada "/riwayat", "/kontak", dan "/live-test"
    Dan tidak ada tautan "/cara-war" atau "/guide.html" pada halaman mana pun serta akses "/cara-war" mengembalikan HTTP 404
    Ketika pengguna menggulir halaman sejauh 600px ke bawah
    Maka posisi ".navbar" ("position: sticky; top: 0; z-index: 1000") tetap terkunci stabil di puncak viewport dan koordinat X menu tidak bergeser antar halaman
    Dan footer ".site-footer .footer-inner" tersusun dalam 3 kolom sejajar pada desktop (1440px)
    Dan elemen "#footerClusterStatus" serta tombol ".btn-footer-reset" ("Reset Kuota Demo") tersedia dan responsif

  Skenario: [Skenario 3] War Kursi E-05 hingga Terbit E-Ticket dan Pemulihan Error Anti-Stuck
    Dengan pengguna sudah login sebagai "Dosen Penguji" ("dosen@wartiket.id")
    Dan pengguna berada di halaman "/konser"
    Ketika pengguna menekan tombol "War Sekarang" pada konser pertama ("The Night of Jazz & Symphony")
    Maka modal "#warModal" terbuka dan memuat peta 60 kursi melalui "GET /api/concerts/1/seats" tanpa cache
    Ketika pengguna memilih kursi tersedia "E-05" lalu menekan "#btnProceedToData" ("Lanjut ke Data Diri")
    Maka form "#phaseDataDiri" terisi otomatis dengan nama dan email akun login
    Ketika pengguna menekan "#btnBayarSekarang" ("Bayar & Terbitkan E-Ticket")
    Maka "POST /api/tickets/buy" sukses dengan HTTP 200 dan menampilkan kartu E-Ticket "#phaseETicket"
    Dan "#ticketSeat" menampilkan "E-05" serta "#ticketBuyer" menampilkan "Dr. Ir. Budi Santoso, M.Kom"

  Skenario: [Skenario 3b] Pencegahan Stuck Saat Network Hang, Abort Cepat Tab Konser, atau Konflik 409
    Dengan modal "#warModal" sedang terbuka pada langkah 2 "#phaseDataDiri"
    Ketika request "POST /api/tickets/buy" mengalami timeout atau kegagalan jaringan (simulated 504/abort)
    Maka banner "#warFeedbackBanner" menampilkan pesan kesalahan yang ramah pengguna
    Dan tombol "#btnBayarSekarang" serta "#btnBackToSeat" kembali aktif (tidak stuck loading abadi)
    Dan ketika kursi terlanjur diambil pengguna lain (HTTP 409), modal menampilkan alert konflik pada "#warFeedbackBanner" dan mengembalikan pengguna ke peta kursi yang sudah tersinkronisasi ulang

  Skenario: [Skenario 4] Cetak / PDF E-Ticket Resmi Bebas Elemen Debug Worker
    Dengan kartu "#eTicketPrintArea" pada "#phaseETicket" sedang ditampilkan untuk akun bergelar panjang
    Ketika browser masuk ke mode "@media print" atau mengekspor PDF
    Maka elemen ".navbar", ".site-footer", ".eticket-worker-box", ".eticket-actions", dan ".eticket-screen-heading" memiliki style "display: none"
    Dan kartu E-Ticket muat tepat 1 halaman cetak dengan kontras tinggi tanpa nama penonton terpotong

  Skenario: [Skenario 5] Uji Konkurensi Race Condition Kursi Sama (0% Overselling via Redis Atomic Lock)
    Dengan stok konser 1 dan status kursi "E-05" dalam keadaan "Available"
    Ketika 20 pengguna mengirim request "POST /api/tickets/buy" secara bersamaan tepat untuk "{ concertId: 1, seatNumber: 'E-05' }"
    Maka tepat 1 request berhasil dengan HTTP 200 (winner)
    Dan 19 request lainnya ditolak dengan HTTP 409 (conflict / lock acquired by another user)
    Dan jumlah server error (HTTP 5xx) adalah 0
    Dan status kursi "E-05" pada "GET /api/concerts/1/seats" berubah konsisten menjadi "Booked"

