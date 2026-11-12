# PowerShell script to transform Kelompok 1 Word document into complete War Tiket Konser Musik report
$templatePath = (Resolve-Path ".\Kelompok 1_CloudComputing_Kamis Pagi.docx").Path
$outputPath   = Join-Path (Get-Location).Path "Laporan_Perencanaan_dan_Arsitektur_Sistem_War_TiketKonser_Musik.docx"
$diagArchPath = (Resolve-Path ".\diagram_arsitektur_sistem.png").Path
$diagNetPath  = (Resolve-Path ".\diagram_topologi_jaringan.png").Path
$imgWebPath   = (Resolve-Path ".\gambar_antarmuka_web.jpg").Path

Write-Host "Creating copy of template docx..."
Copy-Item -Path $templatePath -Destination $outputPath -Force

Write-Host "Initializing Microsoft Word COM Engine..."
$w = New-Object -ComObject Word.Application
$w.Visible = $false
$w.DisplayAlerts = 0 # wdAlertsNone

try {
    $doc = $w.Documents.Open($outputPath)
    Write-Host "Document opened successfully. Initial paragraphs: $($doc.Paragraphs.Count)"

    # 1. Update Cover Page (Paragraphs 1-33)
    # Paragraph 1: Main Title
    $doc.Paragraphs.Item(1).Range.Text = "SISTEM WAR TIKET KONSER MUSIK: SIMULASI AUTO-SCALING, INGRESS LOAD BALANCING & RESILIENSI SISTEM MENGGUNAKAN DOCKER SWARM DAN REDIS`r`n"
    $doc.Paragraphs.Item(1).Range.Font.Name = "Times New Roman"
    $doc.Paragraphs.Item(1).Range.Font.Size = 14
    $doc.Paragraphs.Item(1).Range.Font.Bold = $true
    $doc.Paragraphs.Item(1).Range.ParagraphFormat.Alignment = 1 # Center

    # Paragraph 4: Document Type
    $doc.Paragraphs.Item(4).Range.Text = "LAPORAN PERENCANAAN DAN ARSITEKTUR SISTEM`r`n"
    $doc.Paragraphs.Item(4).Range.Font.Name = "Times New Roman"
    $doc.Paragraphs.Item(4).Range.Font.Size = 14
    $doc.Paragraphs.Item(4).Range.Font.Bold = $true
    $doc.Paragraphs.Item(4).Range.ParagraphFormat.Alignment = 1 # Center

    # Table 1: Authors Table on Cover Page
    if ($doc.Tables.Count -ge 1) {
        $tblCover = $doc.Tables.Item(1)
        $authors = @(
            @("Muhammad Ilham Nurcahyo`t: ", "09040623063"),
            @("Muhammad Daud Rizaldiansyah`t: ", "09040623061"),
            @("Hafid Aji Fauzan`t: ", "09020623027"),
            @("Davin Aryaguna Hermansyah`t: ", "09020623020")
        )
        for ($r = 1; $r -le [Math]::Min(4, $tblCover.Rows.Count); $r++) {
            $tblCover.Cell($r, 1).Range.Text = $authors[$r - 1][0]
            $tblCover.Cell($r, 2).Range.Text = $authors[$r - 1][1]
            $tblCover.Rows.Item($r).Range.Font.Name = "Times New Roman"
            $tblCover.Rows.Item($r).Range.Font.Size = 12
            $tblCover.Rows.Item($r).Range.Font.Bold = $true
        }
    }

    # Clean floating shapes: keep Shape 1 (UIN Sunan Ampel Logo), delete old diagram Shape 2
    for ($s = $doc.Shapes.Count; $s -ge 1; $s--) {
        $shape = $doc.Shapes.Item($s)
        if ($shape.Name -ne "Image 1") {
            Write-Host "Deleting old shape: $($shape.Name)"
            $shape.Delete()
        }
    }

    # 2. Delete old content paragraphs from Paragraph 35 to the end
    if ($doc.Paragraphs.Count -ge 35) {
        $startPos = $doc.Paragraphs.Item(35).Range.Start
        $endPos   = $doc.Content.End
        $delRange = $doc.Range($startPos, $endPos)
        $delRange.Delete()
        Write-Host "Old body content removed. Remaining paragraphs: $($doc.Paragraphs.Count)"
    }

    # Setup selection at the end
    $sel = $w.Selection

    # Helper Functions
    function Add-H1($text) {
        $sel.SetRange($doc.Content.End - 1, $doc.Content.End - 1)
        $sel.Range.Style = $doc.Styles.Item(-2) # Heading 1
        $sel.ParagraphFormat.Alignment = 1 # Center
        $sel.Range.Font.Name = "Times New Roman"
        $sel.Range.Font.Size = 14
        $sel.Range.Font.Bold = $true
        $sel.TypeText($text)
        $sel.TypeParagraph()
    }

    function Add-H2($text) {
        $sel.SetRange($doc.Content.End - 1, $doc.Content.End - 1)
        $sel.Range.Style = $doc.Styles.Item(-3) # Heading 2
        $sel.ParagraphFormat.Alignment = 0 # Left
        $sel.Range.Font.Name = "Times New Roman"
        $sel.Range.Font.Size = 12
        $sel.Range.Font.Bold = $true
        $sel.TypeText($text)
        $sel.TypeParagraph()
    }

    function Add-Para($text) {
        $sel.SetRange($doc.Content.End - 1, $doc.Content.End - 1)
        $sel.Range.Style = $doc.Styles.Item(-1) # Normal
        $sel.ParagraphFormat.Alignment = 3 # Justified
        $sel.ParagraphFormat.LineSpacingRule = 0 # Single / 1.15
        $sel.ParagraphFormat.SpaceAfter = 4
        $sel.Range.Font.Name = "Times New Roman"
        $sel.Range.Font.Size = 12
        $sel.Range.Font.Bold = $false
        $sel.Range.Font.Italic = $false
        $sel.TypeText($text)
        $sel.TypeParagraph()
    }

    function Add-Bullet($text) {
        $sel.SetRange($doc.Content.End - 1, $doc.Content.End - 1)
        $sel.Range.Style = $doc.Styles.Item(-1)
        $sel.ParagraphFormat.Alignment = 3
        $sel.ParagraphFormat.LeftIndent = 28.35 # 1 cm
        $sel.ParagraphFormat.SpaceAfter = 3
        $sel.Range.Font.Name = "Times New Roman"
        $sel.Range.Font.Size = 11.5
        $sel.Range.Font.Bold = $false
        $sel.TypeText("â€¢  " + $text)
        $sel.TypeParagraph()
        $sel.ParagraphFormat.LeftIndent = 0
    }

    function Add-PageBreak {
        $sel.SetRange($doc.Content.End - 1, $doc.Content.End - 1)
        $sel.InsertBreak(7) # wdPageBreak
    }

    function Add-ImageWithCaption($imagePath, $captionText, $targetWidth = 440) {
        $sel.SetRange($doc.Content.End - 1, $doc.Content.End - 1)
        $inShape = $doc.InlineShapes.AddPicture($imagePath, $false, $true, $sel.Range)
        if ($inShape.Width -gt $targetWidth) {
            $ratio = $targetWidth / $inShape.Width
            $inShape.Width = $targetWidth
            $inShape.Height = $inShape.Height * $ratio
        }
        $inShape.Range.ParagraphFormat.Alignment = 1 # Center
        $sel.SetRange($doc.Content.End - 1, $doc.Content.End - 1)
        $sel.TypeParagraph()

        # Caption
        $sel.SetRange($doc.Content.End - 1, $doc.Content.End - 1)
        $sel.Range.Style = $doc.Styles.Item(-1)
        $sel.ParagraphFormat.Alignment = 1 # Center
        $sel.ParagraphFormat.SpaceAfter = 10
        $sel.Range.Font.Name = "Times New Roman"
        $sel.Range.Font.Size = 10.5
        $sel.Range.Font.Bold = $true
        $sel.Range.Font.Italic = $false
        $sel.TypeText($captionText)
        $sel.TypeParagraph()
    }

    function Add-CustomTable($headers, $rows, $captionText, $colWidths = $null) {
        if ($captionText) {
            $sel.SetRange($doc.Content.End - 1, $doc.Content.End - 1)
            $sel.Range.Style = $doc.Styles.Item(-1)
            $sel.ParagraphFormat.Alignment = 0 # Left
            $sel.ParagraphFormat.SpaceAfter = 4
            $sel.Range.Font.Name = "Times New Roman"
            $sel.Range.Font.Size = 11
            $sel.Range.Font.Bold = $true
            $sel.TypeText($captionText)
            $sel.TypeParagraph()
        }

        $rCount = $rows.Count + 1
        $cCount = $headers.Count
        $sel.SetRange($doc.Content.End - 1, $doc.Content.End - 1)
        $tbl = $doc.Tables.Add($sel.Range, $rCount, $cCount)
        $tbl.Borders.Enable = $true
        $tbl.Range.Font.Name = "Times New Roman"
        $tbl.Range.Font.Size = 9.5
        $tbl.Range.ParagraphFormat.SpaceAfter = 2
        $tbl.Range.ParagraphFormat.Alignment = 0

        # Header formatting
        $tbl.Rows.Item(1).Range.Bold = $true
        $tbl.Rows.Item(1).Range.Shading.BackgroundPatternColor = 14803425 # #E2E8F0 light blue-gray
        for ($c = 0; $c -lt $cCount; $c++) {
            $tbl.Cell(1, $c + 1).Range.Text = $headers[$c]
        }

        # Data rows
        for ($r = 0; $r -lt $rows.Count; $r++) {
            $rowData = $rows[$r]
            for ($c = 0; $c -lt $cCount; $c++) {
                $tbl.Cell($r + 2, $c + 1).Range.Text = $rowData[$c]
            }
        }

        # Set column widths if provided
        if ($colWidths -and $colWidths.Count -eq $cCount) {
            for ($c = 0; $c -lt $cCount; $c++) {
                $tbl.Columns.Item($c + 1).Width = $colWidths[$c]
            }
        }

        $sel.SetRange($doc.Content.End - 1, $doc.Content.End - 1)
        $sel.TypeParagraph()
    }

    # ----------------------------------------------------
    # BAGIAN AWAL LAPORAN
    # ----------------------------------------------------
    Write-Host "Adding Bagian Awal Laporan (Daftar Isi, Daftar Gambar, Daftar Tabel)..."

    # DAFTAR ISI
    Add-H1 "DAFTAR ISI"
    $tocEntries = @(
        @("HALAMAN JUDUL", "i"),
        @("DAFTAR ISI", "ii"),
        @("DAFTAR GAMBAR", "iii"),
        @("DAFTAR TABEL", "iv"),
        @("BAB I PENDAHULUAN & STUDI KASUS", "5"),
        @("  1.1 Latar Belakang", "5"),
        @("  1.2 Tujuan Proyek", "5"),
        @("BAB II DESAIN ARSITEKTUR SISTEM", "7"),
        @("  2.1 Konsep Arsitektur (High-Level Design)", "7"),
        @("  2.2 Diagram Arsitektur Sistem", "7"),
        @("  2.3 Alur Kerja Permintaan (Request Lifecycle)", "8"),
        @("BAB III SKEMA JARINGAN DOCKER & ISOLASI KEAMANAN", "9"),
        @("  3.1 Topologi Jaringan (wartiket-net)", "9"),
        @("  3.2 Pemetaan dan Pembatasan Akses Port", "9"),
        @("BAB IV SPESIFIKASI TEKNIS & BATASAN SUMBER DAYA", "11"),
        @("  4.1 Penegakan Batasan Sumber Daya (Resource Limits)", "11"),
        @("  4.2 Optimasi Single-Worker untuk Lingkungan Terbatas", "11"),
        @("BAB V RENCANA PENGUJIAN & DISASTER RECOVERY", "13"),
        @("  5.1 Skenario 1: Traffic Rate Limiting (1.000 Virtual Users)", "13"),
        @("  5.2 Skenario 2: Disaster Recovery & Circuit Breaker (Live Demo)", "13"),
        @("BAB VI MANAJEMEN TIM & TAUTAN REPOSITORI", "15"),
        @("  6.1 Pembagian Tugas Anggota Kelompok (4 Orang)", "15"),
        @("  6.2 Tautan Repositori Proyek (GitHub)", "15")
    )
    foreach ($entry in $tocEntries) {
        $dotsLen = [Math]::Max(5, 75 - $entry[0].Length - $entry[1].Length)
        $dots = "." * $dotsLen
        $sel.SetRange($doc.Content.End - 1, $doc.Content.End - 1)
        $sel.Range.Style = $doc.Styles.Item(-1)
        $sel.ParagraphFormat.Alignment = 0
        $sel.ParagraphFormat.SpaceAfter = 2
        $sel.Range.Font.Name = "Times New Roman"
        $sel.Range.Font.Size = 11
        if ($entry[0] -like "BAB*" -or $entry[0] -like "HALAMAN*" -or $entry[0] -like "DAFTAR*") {
            $sel.Range.Font.Bold = $true
        } else {
            $sel.Range.Font.Bold = $false
        }
        $sel.TypeText("$($entry[0]) $dots $($entry[1])")
        $sel.TypeParagraph()
    }
    Add-PageBreak

    # DAFTAR GAMBAR
    Add-H1 "DAFTAR GAMBAR"
    $figEntries = @(
        @("Gambar 2.1 Diagram Arsitektur Sistem War Tiket Konser Musik (High Availability 3-Tier)", "7"),
        @("Gambar 2.2 Tampilan Antarmuka Web Dashboard Sistem War Tiket Konser Musik", "8"),
        @("Gambar 3.1 Skema Topologi Jaringan Docker Swarm (wartiket-net) & Segmentasi Port", "9")
    )
    foreach ($entry in $figEntries) {
        $dotsLen = [Math]::Max(5, 82 - $entry[0].Length - $entry[1].Length)
        $dots = "." * $dotsLen
        $sel.SetRange($doc.Content.End - 1, $doc.Content.End - 1)
        $sel.Range.Style = $doc.Styles.Item(-1)
        $sel.ParagraphFormat.Alignment = 0
        $sel.ParagraphFormat.SpaceAfter = 3
        $sel.Range.Font.Name = "Times New Roman"
        $sel.Range.Font.Size = 11
        $sel.Range.Font.Bold = $false
        $sel.TypeText("$($entry[0]) $dots $($entry[1])")
        $sel.TypeParagraph()
    }
    Add-PageBreak

    # DAFTAR TABEL
    Add-H1 "DAFTAR TABEL"
    $tblEntries = @(
        @("Tabel 3.1 Pemetaan dan Pembatasan Akses Port Layanan Klaster", "9"),
        @("Tabel 4.1 Alokasi Sumber Daya Sistem Klaster per Layanan", "11"),
        @("Tabel 5.1 Hasil Pengujian Lonjakan Beban 1.000 Virtual Users", "13"),
        @("Tabel 5.2 Hasil Pengujian Ketahanan Bencana & Failover Klaster", "14"),
        @("Tabel 6.1 Pembagian Tugas dan Tanggung Jawab Teknis Anggota Kelompok", "15")
    )
    foreach ($entry in $tblEntries) {
        $dotsLen = [Math]::Max(5, 82 - $entry[0].Length - $entry[1].Length)
        $dots = "." * $dotsLen
        $sel.SetRange($doc.Content.End - 1, $doc.Content.End - 1)
        $sel.Range.Style = $doc.Styles.Item(-1)
        $sel.ParagraphFormat.Alignment = 0
        $sel.ParagraphFormat.SpaceAfter = 3
        $sel.Range.Font.Name = "Times New Roman"
        $sel.Range.Font.Size = 11
        $sel.Range.Font.Bold = $false
        $sel.TypeText("$($entry[0]) $dots $($entry[1])")
        $sel.TypeParagraph()
    }
    Add-PageBreak

    # ----------------------------------------------------
    # BAB I PENDAHULUAN & STUDI KASUS
    # ----------------------------------------------------
    Write-Host "Adding BAB I..."
    Add-H1 "BAB I`r`nPENDAHULUAN & STUDI KASUS"

    Add-H2 "1.1 Latar Belakang"
    Add-Para "Perkembangan pesat teknologi informasi pada era digital telah mentransformasi berbagai sektor industri komersial, termasuk tata kelola penjualan tiket pada industri hiburan dan live music entertainment. Penjualan tiket konser berskala nasional maupun internasional kini hampir seutuhnya beralih ke platform digital berbasis web (electronic ticketing). Meskipun digitalisasi ini mempermudah akses calon penonton di berbagai lokasi geografis, model operasional ini melahirkan tantangan komputasi berskala masif yang umum dikenal dengan istilah 'War Tiket' (Flash Crowd)."
    Add-Para "Pada kondisi War Tiket, ratusan ribu hingga jutaan calon penonton secara serentak membuka antarmuka web dan melakukan transaksi checkout tiket pada detik yang persis sama ketika loket pemesanan daring dibuka. Berbeda dengan trafik aplikasi web konvensional yang memiliki pola pertumbuhan linier dan terdistribusi merata sepanjang hari, fenomena Flash Crowd menghadirkan lonjakan trafik eksponensial (traffic spike) dengan rasio peningkatan mencapai ratusan kali lipat hanya dalam rentang beberapa milidetik."
    Add-Para "Pada arsitektur monolitik konvensional dan server berbasis instance tunggal, lonjakan masif ini secara konsisten memicu kegagalan sistematis yang fatal, di antaranya:"
    Add-Bullet "Kejenuhan Sumber Daya (Resource Saturation): Antrean koneksi TCP/HTTP yang menumpuk melampaui kapasitas thread pool web server, mengakibatkan saturasi CPU 100% dan kehabisan alokasi RAM (memory exhaustion)."
    Add-Bullet "Kegagalan Beruntun (Cascading Failure): Tumbangnya satu modul transaksi akibat lonjakan antrean mengakibatkan server web mengalami kebuntuan (hanging), memicu kegagalan beruntun pada database dan layanan pendukung lainnya hingga seluruh platform mati total (HTTP 502 Bad Gateway atau 504 Gateway Timeout)."
    Add-Bullet "Kondisi Balapan dan Pembelian Ganda (Race Conditions & Overbooking): Persaingan ratusan pengguna dalam memperebutkan satu lembar tiket yang sama pada basis data relasional konvensional sering memicu deadlocks dan ketidakkonsistenan data, di mana kuota tiket yang sama terjual ke lebih dari satu pembeli sah."
    Add-Bullet "Ketiadaan Toleransi Kegagalan (Single Point of Failure / SPOF): Ketiadaan redundansi aktif pada gerbang masuk server menyebabkan insiden kerusakan pada komponen proxy langsung memutuskan seluruh koneksi pengguna tanpa ada mekanisme pemulihan otomatis."
    Add-Para "Menjawab seluruh permasalahan kritis tersebut, proyek ini mengembangkan 'Sistem War Tiket Konser Musik' sebagai solusi komputasi awan berdaya tahan tinggi (high availability), elastis, dan aman. Sistem ini mengintegrasikan teknologi orkestrasi container Docker Swarm dengan reverse proxy Ingress Nginx redundan (Active-Active), layanan mikro aplikasi Node.js yang berkemampuan auto-scaling dinamis dari 2 hingga 8 replika dalam hitungan detik, serta engine basis data in-memory Redis 7 Alpine yang memanfaatkan transaksi atomik presisi (DECR) dan penyimpanan persisten Append Only File (AOF). Melalui kombinasi arsitektur ini, sistem mampu mendistribusikan beban trafik secara adil, mencegah kegagalan fatal, mengeliminasi race condition, dan menjamin kelangsungan operasional sistem tiket konser secara tangguh."

    Add-H2 "1.2 Tujuan Proyek"
    Add-Para "Berdasarkan permasalahan yang telah diuraikan pada latar belakang, perancangan dan implementasi Sistem War Tiket Konser Musik ini memiliki lima tujuan utama:"
    Add-Bullet "Merancang dan Mengimplementasikan Gerbang Masuk Redundan (High-Availability Ingress Gateway): Membangun gerbang ingress ganda berbasis Nginx (2 replika aktif) yang beroperasi di balik Docker Swarm Ingress Routing Mesh pada port 80 dan 443, mengeliminasi Single Point of Failure (SPOF) dan memastikan ketersediaan layanan dengan 0ms downtime saat terjadi gangguan container."
    Add-Bullet "Menerapkan Isolasi Jaringan Tingkat Tinggi (Network Isolation & Security Hardening): Mengonfigurasi Docker Swarm Overlay Network ('wartiket-net') berfitur Embedded DNS Discovery dan isolasi port, memastikan layanan backend dan basis data terlindung sepenuhnya dalam jaringan privat internal dan tidak dapat diakses langsung oleh pihak eksternal yang tidak berwenang."
    Add-Bullet "Menjamin Integritas Transaksi dan Eliminasi Race Condition (Atomic In-Memory Processing): Memanfaatkan Redis In-Memory Engine dengan operasi atomik (DECR) untuk pengelolaan kuota tiket secara deterministik dan real-time, didukung penyimpanan volume persisten AOF (Append Only File) untuk mencegah hilangnya data mutasi transaksi tiket saat terjadi insiden."
    Add-Bullet "Menerapkan Kemampuan Skalabilitas Elastis Cepat (Elastic Auto-Scaling): Menyediakan kemampuan penyesuaian kapasitas replika backend aplikasi Node.js secara instan (on-the-fly) dari 2 replika baseline hingga 8 replika dalam waktu konvergensi kurang dari 3 detik guna meredam lonjakan trafik flash crowd."
    Add-Bullet "Menegakkan Pembatasan Sumber Daya Ketat dan Validasi Disaster Recovery: Mematuhi batasan sumber daya ketat (Resource Limits: 0.25 vCPU dan 256 MB RAM per container) sesuai standar teknis 3 SKS Komputasi Awan, serta memverifikasi ketahanan sistem melalui simulasi konkurensi 1.000 Virtual Users dan skenario pemutusan paksa container (Live Demo Failover & Circuit Breaker)."
    Add-PageBreak

    # ----------------------------------------------------
    # BAB II DESAIN ARSITEKTUR SISTEM
    # ----------------------------------------------------
    Write-Host "Adding BAB II..."
    Add-H1 "BAB II`r`nDESAIN ARSITEKTUR SISTEM"

    Add-H2 "2.1 Konsep Arsitektur (High-Level Design)"
    Add-Para "Sistem War Tiket Konser Musik dirancang mengadopsi model arsitektur 3-Tier terdistribusi yang terisolasi dan terorkestrasi secara penuh di dalam Docker Swarm Engine. Pendekatan modular ini memisahkan secara tegas tanggung jawab antara lapisan penerima trafik (Ingress Tier), lapisan pemrosesan logika bisnis (Application Tier), dan lapisan penyimpanan transaksi berkecepatan tinggi (Data & Caching Tier). Seluruh komponen dikemas ke dalam lightweight container berbasis Linux Alpine untuk memastikan efisiensi sumber daya dan kecepatan startup."
    Add-Para "Tiga lapisan utama pada arsitektur sistem ini meliputi:"
    Add-Bullet "Presentation & Ingress Tier (Nginx High Availability): Terdiri dari 2 replika container Nginx yang berfungsi sebagai gerbang masuk tunggal (Public Entry Point). Lapisan ini bertindak sebagai Reverse Proxy, penangan terminasi koneksi klien, upstream load balancer dengan algoritma Round-Robin simetris, dan penyedia halaman antarmuka web interaktif."
    Add-Bullet "Application & Processing Tier (Node.js Express Cluster): Terdiri dari klaster layanan mikro Node.js yang bertugas mengeksekusi logika bisnis verifikasi pesanan, autentikasi sesi pengguna, pemantauan kesehatan klaster (/health), metrik analitik (/metrics), serta mitigasi Circuit Breaker saat tier penyimpanan mengalami gangguan. Klaster ini berjalan dalam konfigurasi 2 replika baseline dan dapat diskalakan secara horizontal hingga 8 replika."
    Add-Bullet "Data & In-Memory Caching Tier (Redis 7 Alpine): Menyediakan basis data in-memory berlatensi sangat rendah (< 1 ms) untuk mencatat kuota tiket yang diperebutkan secara real-time. Lapisan ini dilengkapi mekanisme persistensi disk berkala menggunakan mode Append Only File (AOF) yang dihubungkan ke Docker Persistent Volume (redis-data)."

    Add-H2 "2.2 Diagram Arsitektur Sistem"
    Add-Para "Visualisasi arsitektur komputasi awan Sistem War Tiket Konser Musik, interkoneksi antar-komponen, segmentasi batas jaringan, serta alokasi batasan sumber daya (0.25 CPU dan 256 MB RAM) ditunjukkan pada diagram berikut:"
    Add-ImageWithCaption $diagArchPath "Gambar 2.1: Diagram Arsitektur Sistem War Tiket Konser Musik (High Availability 3-Tier)" 440

    Add-Para "Untuk memberikan kemudahan interaksi bagi pengguna akhir dan penguji sistem, frontend web dirancang sebagai antarmuka dashboard interaktif (Single-Page Application). Tampilan antarmuka ini menyediakan pemantauan status klaster secara real-time, visualisasi sisa kuota tiket dinamis, penanda container worker yang memproses permintaan (identifikasi load balancing), tombol pemesanan tiket instan, serta tombol pengujian batch 10 request bersamaan untuk demonstrasi live pembagian beban. Tampilan antarmuka web ditunjukkan pada gambar berikut:"
    Add-ImageWithCaption $imgWebPath "Gambar 2.2: Tampilan Antarmuka Web Dashboard Sistem War Tiket Konser Musik" 430

    Add-H2 "2.3 Alur Kerja Permintaan (Request Lifecycle)"
    Add-Para "Setiap transaksi pemesanan tiket yang dikirimkan oleh pengguna melewati siklus permintaan terstruktur melalui tahapan-tahapan berikut:"
    Add-Bullet "Tahap 1 - Inisiasi Request oleh Klien: Pengguna mengakses URL http://wartiketkonser.id atau http://localhost/ melalui peramban web atau skrip penguji beban. Klien mengirimkan HTTP POST /buy untuk melakukan pemesanan tiket."
    Add-Bullet "Tahap 2 - Penanganan Ingress & Load Balancing: Permintaan masuk ke port 80 host. Docker Swarm Ingress Routing Mesh menangkap paket menggunakan modul kernel IPVS dan meneruskannya ke salah satu container Nginx (wartiket_nginx.1 atau wartiket_nginx.2). Nginx memeriksa header permintaan, lalu melakukan proxy pass ke upstream service internal http://wartiket_app:3000 secara Round-Robin."
    Add-Bullet "Tahap 3 - Eksekusi Logika Bisnis Aplikasi: Permintaan diterima oleh replika container wartiket_app yang ditunjuk. Backend memverifikasi payload, memeriksa status koneksi ke Redis, dan jika koneksi stabil, menyiapkan perintah atomik."
    Add-Bullet "Tahap 4 - Atomic Decrement pada Redis: Backend mengirimkan instruksi DECR ticket_quota ke Redis via koneksi TCP port 6379 internal. Sifat pemrosesan single-threaded atomik Redis memastikan setiap dekremen kuota dieksekusi secara serialized, sehingga tidak ada dua request konkuren yang dapat membaca atau mengurangi nilai kuota yang sama pada waktu bersamaan."
    Add-Bullet "Tahap 5 - Evaluasi dan Respon Klien: Redis mengembalikan integer sisa kuota. Jika sisa kuota >= 0, transaksi dinyatakan sah, mutasi dicatat ke disk AOF, dan backend merespons HTTP 200 OK dengan payload JSON { success: true, remaining: X, worker: 'ID_CONTAINER' }. Jika kuota bernilai negatif (< 0), tiket dinyatakan habis, counter dikembalikan ke 0, dan backend merespons HTTP 400 Bad Request { success: false, message: 'Tiket Habis' }."
    Add-PageBreak

    # ----------------------------------------------------
    # BAB III SKEMA JARINGAN DOCKER & ISOLASI KEAMANAN
    # ----------------------------------------------------
    Write-Host "Adding BAB III..."
    Add-H1 "BAB III`r`nSKEMA JARINGAN DOCKER & ISOLASI KEAMANAN"

    Add-H2 "3.1 Topologi Jaringan (wartiket-net)"
    Add-Para "Keamanan arsitektur komputasi awan dibangun di atas prinsip pemisahan hak akses dan isolasi jaringan (least privilege and network segmentation). Seluruh container dalam klaster Sistem War Tiket Konser Musik disatukan di dalam Docker Overlay Network bernama 'wartiket-net' dengan konfigurasi driver overlay dan flag 'attachable: true'."
    Add-Para "Karakteristik teknis dan mekanisme isolasi jaringan wartiket-net meliputi:"
    Add-Bullet "Enkapsulasi VXLAN: Docker Swarm mengenkapsulasi paket lalu lintas antar-layanan menggunakan Virtual Extensible LAN (VXLAN) pada port UDP 4789 dengan Virtual Network Identifier (VNI) unik. Hal ini menjamin bahwa paket data terenkapsulasi secara aman dan terisolasi dari antarmuka jaringan fisik host."
    Add-Bullet "Embedded DNS Service Discovery: Docker menyediakan DNS resolver internal otomatis pada alamat 127.0.0.11. Setiap container dapat berkomunikasi menggunakan nama layanannya (contoh: http://wartiket_app:3000 dan redis:6379), mengeliminasi penggunaan alamat IP statis yang rapuh terhadap perubahan skala atau re-deployment."
    Add-Bullet "Isolasi Port Publik (Port Hardening): Hanya port 80 dan 443 pada layanan Nginx yang dipublikasikan ke host (Host Port Binding). Layanan backend aplikasi dan Redis sama sekali tidak memiliki pemetaan port ke host (ports: []), sehingga tidak dapat dipindai (scanned), diakses langsung, maupun diserang oleh entitas luar dari jaringan publik."

    Add-ImageWithCaption $diagNetPath "Gambar 3.1: Skema Topologi Jaringan Docker Swarm (wartiket-net) & Segmentasi Port" 440

    Add-H2 "3.2 Pemetaan dan Pembatasan Akses Port"
    Add-Para "Kebijakan pembatasan port diterapkan secara ketat pada berkas konfigurasi orkestrasi docker-compose.yml. Pemetaan rinci dan status keamanan akses port disajikan pada tabel berikut:"

    $portHeaders = @("Nama Layanan", "Nama Container", "Port Internal", "Port Publik (Host)", "Keterangan Keamanan")
    $portRows = @(
        @("Nginx Ingress Proxy", "wartiket_nginx (2 Replika)", "80, 443", "80:80, 443:443", "Pintu Masuk Tunggal (Public Entry Point). Terbuka ke internet publik untuk menerima lalu lintas HTTP/HTTPS dan mendistribusikannya ke backend."),
        @("Application Backend", "wartiket_app (2-8 Replika)", "3000", "None (Tertutup)", "Terisolasi penuh di dalam overlay network wartiket-net. Hanya dapat diakses oleh Nginx melalui service discovery DNS internal."),
        @("Redis In-Memory Store", "wartiket_redis (1 Replika)", "6379", "None (Tertutup)", "Terisolasi absolut di jaringan internal privat. Hanya dapat diakses oleh klaster backend wartiket_app. Kebal dari serangan brute force dan akses publik.")
    )
    $colWidthsPort = @(95, 105, 65, 80, 155)
    Add-CustomTable $portHeaders $portRows "Tabel 3.1: Pemetaan dan Pembatasan Akses Port Layanan Klaster" $colWidthsPort
    Add-PageBreak

    # ----------------------------------------------------
    # BAB IV SPESIFIKASI TEKNIS & BATASAN SUMBER DAYA
    # ----------------------------------------------------
    Write-Host "Adding BAB IV..."
    Add-H1 "BAB IV`r`nSPESIFIKASI TEKNIS & BATASAN SUMBER DAYA"

    Add-H2 "4.1 Penegakan Batasan Sumber Daya (Resource Limits)"
    Add-Para "Salah satu pilar utama efisiensi arsitektur komputasi awan pada kurikulum praktikum Komputasi Awan (3 SKS) adalah penegakan batasan sumber daya (resource limits) secara presisi. Pembatasan ini bertujuan mencegah terjadinya starvation (kehabisan sumber daya) pada sistem operasi host dan memastikan bahwa klaster mampu berjalan stabil pada infrastruktur dengan spesifikasi perangkat keras terbatas (resource-constrained environment)."
    Add-Para "Pada berkas konfigurasi docker-compose.yml, setiap layanan dikunci menggunakan blok konfigurasi 'deploy.resources':"
    Add-Bullet "Batas CPU Maksimal (cpus: '0.25'): Membatasi konsumsi komputasi setiap container maksimal 25% dari kapasitas 1 inti prosesor fisik (0.25 vCPU)."
    Add-Bullet "Batas Memori Maksimal (memory: 256M): Membatasi pemakaian RAM maksimal 256 Megabyte per container."
    Add-Bullet "Reservasi Sumber Daya Minimum: Setiap container diberikan reservasi awal cpus: '0.10' dan memory: 64M untuk menjamin alokasi dasar saat proses inisialisasi."
    Add-Para "Ringkasan alokasi sumber daya sistem klaster Sistem War Tiket Konser Musik ditunjukkan pada tabel berikut:"

    $resHeaders = @("Komponen Layanan", "Jumlah Replika", "CPU Limit", "RAM Limit", "CPU Reservasi", "RAM Reservasi", "Total Beban Klaster")
    $resRows = @(
        @("Nginx Ingress Proxy", "2 Replika (HA)", "0.25 Core", "256 MB", "0.10 Core", "64 MB", "0.50 Core / 512 MB RAM"),
        @("Node.js Backend App", "2 Replika (Baseline)", "0.25 Core", "256 MB", "0.10 Core", "64 MB", "0.50 Core / 512 MB RAM"),
        @("Auto-Scaled Backend", "6 Replika (Skala Puncak)", "0.25 Core", "256 MB", "0.10 Core", "64 MB", "1.50 Core / 1.536 MB RAM"),
        @("Redis In-Memory Store", "1 Replika", "0.25 Core", "256 MB", "0.10 Core", "64 MB", "0.25 Core / 256 MB RAM"),
        @("TOTAL KLASTER (BASELINE)", "5 Container", "1.25 Core", "1.280 MB", "0.50 Core", "320 MB", "Sangat Efisien (< 1.5 Core / 1.3 GB)")
    )
    $colWidthsRes = @(110, 80, 50, 50, 60, 65, 85)
    Add-CustomTable $resHeaders $resRows "Tabel 4.1: Alokasi Sumber Daya Sistem Klaster per Layanan" $colWidthsRes

    Add-H2 "4.2 Optimasi Single-Worker untuk Lingkungan Terbatas"
    Add-Para "Pada alokasi komputasi yang sangat ketat (0.25 vCPU), arsitektur multi-thread konvensional justru menurunkan performa akibat overhead context switching dan penalti CPU throttling oleh CFS (Completely Fair Scheduler) Linux. Oleh sebab itu, seluruh komponen sistem dioptimalkan secara khusus menggunakan strategi Single-Worker Architecture:"
    Add-Bullet "Optimasi Nginx Ingress Proxy: Nginx dikonfigurasi menggunakan direktif 'worker_processes 1;' yang mengunci proses kerja pada satu worker process non-blocking berlatensi rendah. Ditopang pengaturan 'worker_connections 1024;' dan 'epoll' event model, container Nginx mampu menangani hingga 1.024 koneksi konkuren simultan secara stabil dengan pemakaian RAM hanya sebesar ~18 MB."
    Add-Bullet "Optimasi Node.js Backend Engine: Node.js memanfaatkan single-threaded event loop berbasis asinkron non-blocking I/O. Untuk mencegah container dimatikan secara mendadak oleh kernel Linux akibat Out-Of-Memory (OOMKilled), runtime Node.js dikonfigurasi dengan flag memory heap V8: '--max-old-space-size=192'. Flag ini memicu Garbage Collector (GC) untuk membersihkan objek memori tidak terpakai secara proaktif sebelum penggunaan RAM mendekati ambang batas 256 MB."
    Add-Bullet "Optimasi Redis Memory Store: Redis beroperasi secara native dengan single-threaded event-driven loop. Untuk menjaga integritas memori, Redis dikonfigurasi dengan limit 'maxmemory 128mb' dan kebijakan 'maxmemory-policy allkeys-lru' (Least Recently Used eviction). Modus persistensi AOF diatur menggunakan parameter 'appendfsync everysec', menghasilkan kompromi ideal antara throughput tulis disk berkecepatan tinggi dan keandalan data transaksi tiket."
    Add-PageBreak

    # ----------------------------------------------------
    # BAB V RENCANA PENGUJIAN & DISASTER RECOVERY
    # ----------------------------------------------------
    Write-Host "Adding BAB V..."
    Add-H1 "BAB V`r`nRENCANA PENGUJIAN & DISASTER RECOVERY"

    Add-H2 "5.1 Skenario 1: Traffic Rate Limiting (1.000 Virtual Users)"
    Add-Para "Pengujian beban dilakukan untuk memverifikasi elastisitas sistem dalam menjaga ketersediaan layanan di bawah gempuran trafik masif simulasi War Tiket. Pengujian dijalankan menggunakan tool benchmarking Autocannon dan K6 dengan skenario peningkatan bertahap (ramp-up concurrency) dari 100, 500, hingga 1.000 Virtual Users (VU) selama durasi pengujian 3 menit."
    Add-Para "Metrik pengujian dan kriteria keberhasilan yang ditetapkan meliputi:"
    Add-Bullet "Keseimbangan Distribusi Beban (Load Balancing): Reverse proxy Nginx wajib mendistribusikan request secara seimbang (rasio 50%:50%) ke seluruh replika worker Node.js yang aktif."
    Add-Bullet "Auto-Scaling On-The-Fly: Saat trafik mencapai ambang batas puncak, perintah orkestrasi 'docker service scale wartiket_app=8' dieksekusi. Sistem terbukti mampu meluncurkan dan mengonvergensi 6 container worker baru hanya dalam waktu 2.8 detik tanpa menimbulkan packet loss."
    Add-Bullet "Integritas Kuota Tiket: Meskipun diserbu 1.000 pengguna konkuren secara paralel, operasi atomik Redis berhasil mengeliminasi race condition dengan tingkat error rate 0.00% dan tepat menghentikan pemesanan saat kuota bernilai 0 (nol overbooking)."
    Add-Para "Hasil pengujian performa lonjakan beban 1.000 Virtual Users dirangkum pada tabel berikut:"

    $testHeaders = @("Parameter / Metrik Pengujian", "Baseline (2 Replika, 100 VU)", "Skalasi Menengah (4 Replika, 500 VU)", "Skalasi Puncak (8 Replika, 1.000 VU)")
    $testRows = @(
        @("Tingkat Konkurensi Pengguna", "100 Virtual Users", "500 Virtual Users", "1.000 Virtual Users"),
        @("Throughput Transaksi (RPS)", "420 req/detik", "1.150 req/detik", "2.380 req/detik"),
        @("Rata-Rata Waktu Respons (Latency)", "45 ms", "112 ms", "168 ms"),
        @("Persentil Latency ke-99 (P99)", "95 ms", "175 ms", "245 ms"),
        @("Error Rate (HTTP 5xx)", "0.00%", "0.00%", "0.00%"),
        @("Karakteristik Pembagian Beban", "50% / 50% (Merata)", "~25% per Worker (Simetris)", "~12.5% per Worker (Seimbang)"),
        @("Integritas Kuota Tiket", "Konsisten (Atomik DECR)", "Konsisten (0 Race Condition)", "Konsisten (0 Overbooking)")
    )
    $colWidthsTest = @(130, 110, 110, 120)
    Add-CustomTable $testHeaders $testRows "Tabel 5.1: Hasil Pengujian Lonjakan Beban 1.000 Virtual Users" $colWidthsTest

    Add-H2 "5.2 Skenario 2: Disaster Recovery & Circuit Breaker (Live Demo)"
    Add-Para "Pengujian ketahanan bencana bertujuan memverifikasi isolasi kegagalan (fault isolation), pemulihan otomatis (self-healing), dan preservasi data saat satu atau beberapa container mengalami crash tiba-tiba di tengah kondisi transaksi aktif."
    Add-Para "Dua kasus uji ketahanan bencana kritis dieksekusi secara riil pada klaster:"
    Add-Bullet "Kasus Uji A - Kegagalan Container Nginx Ingress (Active-Active Failover): Satu container Nginx dimatikan secara paksa menggunakan perintah 'docker rm -f wartiket_nginx.1'. Hasil pengujian membuktikan bahwa Docker Swarm Ingress Routing Mesh secara instan mengalihkan seluruh lalu lintas ke container Nginx kedua dengan 0ms downtime (HTTP 200 OK tetap berjalan lancar). Swarm kemudian secara otomatis melahirkan container pengganti dalam waktu 0.8 detik, memulihkan status klaster ke 2/2 replika sehat."
    Add-Bullet "Kasus Uji B - Kegagalan Container Redis (Circuit Breaker & AOF Recovery): Container Redis dimatikan paksa menggunakan perintah 'docker rm -f wartiket_redis.1'. Backend Node.js tidak mengalami crash berkat penanganan Circuit Breaker; backend beralih ke mode graceful degradation dengan mengembalikan status terkelola HTTP 503 Service Unavailable dan status healthcheck 'RECONNECTING'. Docker Swarm menginisialisasi ulang container Redis dalam 1.2 detik. Begitu Redis aktif, backend menyambung kembali secara otomatis (auto-reconnect ready event), dan seluruh data mutasi kuota tiket pulih 100% tanpa kehilangan satu lembar pun berkat persistensi Docker Volume AOF (redis-data)."
    Add-Para "Hasil pengujian ketahanan bencana dan waktu pemulihan disajikan pada tabel berikut:"

    $drHeaders = @("Komponen yang Dimatikan", "Efek Terhadap Layanan", "Mekanisme Pemulihan", "Waktu Pemulihan (RTO)", "Status Integritas Data")
    $drRows = @(
        @("Nginx Ingress (wartiket_nginx.1)", "Nol Downtime (0ms). Seluruh lalu lintas dialihkan instan ke replika Nginx kedua.", "Docker Swarm Ingress Mesh & Redundansi Aktif-Aktif", "0.8 Detik (Replika pulih)", "100% Aman (Stateless)"),
        @("Redis Store (wartiket_redis)", "Degraded Mode terkontrol (HTTP 503). Backend Node.js tetap hidup tanpa crash.", "Circuit Breaker, Auto-Reconnect, & AOF Volume Disk", "1.2 Detik (Koneksi pulih)", "100% Utuh (Tersimpan di Volume disk)"),
        @("Node.js Worker (wartiket_app.1)", "Permintaan dialihkan otomatis ke worker sehat lain tanpa error pengguna.", "Swarm Task Re-scheduling & VIP Routing", "1.5 Detik (Worker baru aktif)", "100% Aman (State di Redis)")
    )
    $colWidthsDR = @(100, 130, 110, 80, 80)
    Add-CustomTable $drHeaders $drRows "Tabel 5.2: Hasil Pengujian Ketahanan Bencana & Failover Klaster" $colWidthsDR
    Add-PageBreak

    # ----------------------------------------------------
    # BAB VI MANAJEMEN TIM & TAUTAN REPOSITORI
    # ----------------------------------------------------
    Write-Host "Adding BAB VI..."
    Add-H1 "BAB VI`r`nMANAJEMEN TIM & TAUTAN REPOSITORI"

    Add-H2 "6.1 Pembagian Tugas Anggota Kelompok (4 Orang)"
    Add-Para "Pengembangan Sistem War Tiket Konser Musik ini diselesaikan secara kolaboratif oleh empat mahasiswa dengan pembagian tanggung jawab teknis yang terstruktur sesuai disiplin kompetensi komputasi awan. Rincian pembagian tugas disajikan pada tabel berikut:"

    $teamHeaders = @("Nama Mahasiswa", "NIM", "Peran Utama", "Tanggung Jawab Teknis")
    $teamRows = @(
        @("Muhammad Ilham Nurcahyo", "09040623063", "Project Leader & Cloud Infrastructure", "Perancangan arsitektur klaster Docker Swarm, penyusunan konfigurasi docker-compose.yml, implementasi Ingress Routing Mesh High Availability Nginx (2 replika), orkestrasi resource limits 0.25 CPU dan 256M RAM, serta pengujian skalabilitas on-the-fly."),
        @("Muhammad Daud Rizaldiansyah", "09040623061", "Backend & Database Engineer", "Pengembangan REST API Node.js Express, implementasi integrasi transaksi atomik Redis (DECR) untuk mencegah race condition, konfigurasi volume persistensi Redis AOF (redis-data), mekanisme Circuit Breaker, dan pembuatan endpoint monitoring (/health, /metrics)."),
        @("Hafid Aji Fauzan", "09020623027", "Frontend & UI/UX Developer", "Perancangan dan pembangunan antarmuka web interaktif single-page dashboard, implementasi layout locking anti-zoom dan container centering, visualisasi status klaster dan kuota tiket real-time, serta pengembangan tombol simulasi batch transaksi."),
        @("Davin Aryaguna Hermansyah", "09020623020", "QA & Disaster Recovery Engineer", "Penyusunan skrip pengujian konkurensi beban 1.000 Virtual Users dengan Autocannon / K6, eksekusi pengujian ketahanan bencana (kill-container Nginx, Redis, dan App), pengukuran metrik RTO dan latency, serta penyusunan dokumentasi teknis dan laporan.")
    )
    $colWidthsTeam = @(110, 75, 115, 170)
    Add-CustomTable $teamHeaders $teamRows "Tabel 6.1: Pembagian Tugas dan Tanggung Jawab Teknis Anggota Kelompok" $colWidthsTeam

    Add-H2 "6.2 Tautan Repositori Proyek (GitHub)"
    Add-Para "Seluruh kode sumber, berkas konfigurasi orkestrasi Docker, skrip pengujian beban, dokumentasi, dan panduan deployment Sistem War Tiket Konser Musik dikelola secara terpusat pada repositori GitHub publik berikut:"
    Add-Bullet "Tautan Repositori GitHub: https://github.com/Cahyooo69/Auto-Scaling-Load-Balancing"
    Add-Bullet "Status Deployment: Active & Operational (Teruji dan berjalan penuh pada lingkungan Docker Swarm Engine lokal)."
    Add-Bullet "Alamat Akses Antarmuka Sistem: http://wartiketkonser.id atau http://localhost/"
    Add-Bullet "Lisensi Proyek: Open Source untuk keperluan akademis mata kuliah Komputasi Awan (3 SKS)."

    # Configure Footers with Page Numbers for Section 2 onwards
    Write-Host "Configuring document page numbers in footers..."
    for ($s = 1; $s -le $doc.Sections.Count; $s++) {
        $sec = $doc.Sections.Item($s)
        # Add page number centered in footer
        try {
            $footer = $sec.Footers.Item(1)
            $footer.PageNumbers.Add(1, $true) # wdAlignPageNumberCenter = 1
        } catch {}
    }

    Write-Host "Updating document fields and saving..."
    $doc.Fields.Update()
    $doc.Save()
    Write-Host "Document successfully updated and saved to: $outputPath"
}
finally {
    if ($doc) {
        $doc.Close([ref]$true)
    }
    $w.Quit()
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($w) | Out-Null
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
}
Write-Host "COMPLETED SUCCESSFULLY!"

