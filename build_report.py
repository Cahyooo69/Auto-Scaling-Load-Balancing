import base64
import os
import re

# Read both images
with open('k6_results_2_replicas.png', 'rb') as f:
    b64_2 = base64.b64encode(f.read()).decode('utf-8')

with open('k6_results_8_replicas.png', 'rb') as f:
    b64_8 = base64.b64encode(f.read()).decode('utf-8')

# Read original base template before page 3
with open('laporan_progres_gabungan_pertemuan_1_2_3.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace footer counts from '3' to '4'
content = content.replace('Halaman 1 dari 3', 'Halaman 1 dari 4')
content = content.replace('Halaman 2 dari 3', 'Halaman 2 dari 4')

# Find where page 3 starts
split_marker = '<!-- ==================== HALAMAN 3'
parts = content.split(split_marker)
header_and_pages_1_2 = parts[0]

page_3_and_4 = f"""<!-- ==================== HALAMAN 3: BUKTI METRIK K6 (ATAS & BAWAH) ==================== -->
  <div class="page">
    <h2 class="section-title">3.2 Tangkapan Layar &amp; Analisis Komparasi Kinerja Metrik Grafana k6</h2>
    <p>
      Berikut adalah bukti visual tangkapan layar dasbor resmi <strong>Grafana k6</strong> yang membandingkan metrik secara langsung antara <strong>Kondisi A (Baseline: 2 Replika Worker)</strong> dan <strong>Kondisi B (Pasca-Skalasi: 8 Replika Worker)</strong> saat beban puncak mencapai 1.000 Virtual Users (VU):
    </p>

    <!-- GAMBAR 1: KONDISI A (2 REPLIKA) ATAS -->
    <div style="background: #ffffff; border: 1.5px solid #cbd5e0; border-radius: 4px; padding: 6px 8px; margin-bottom: 7px;">
      <div style="font-size: 8.2pt; font-weight: 700; color: #1a365d; margin-bottom: 4px;">
        Gambar 1: Dasbor Metrik k6 &mdash; Kondisi A: Baseline 2 Replika Worker (Total 0,5 Core CPU)
      </div>
      <img src="data:image/png;base64,{b64_2}" alt="k6 Results 2 Replicas" style="width: 100%; height: auto; border: 1px solid #cbd5e0; border-radius: 3px; display: block;">
      <div style="font-size: 7.2pt; color: #2d3748; margin-top: 5px; line-height: 1.35;">
        <strong>Poin-Poin Analisis Kinerja Kondisi A (2 Replika):</strong>
        <ul style="margin: 2px 0 0 14px; padding: 0;">
          <li><strong>Tingkat Kepatuhan SLA (Checks 99,5%):</strong> Terdapat 0,5% request di beban puncak 1.000 VU yang merespon &gt; 500 ms karena CPU worker menyentuh batas saturasi.</li>
          <li><strong>Throughput Transaksi (1,09k req/s):</strong> Sistem memproses total <strong>50.100 transaksi</strong> dalam 45 detik dengan kecepatan rata-rata 1.090 request per detik.</li>
          <li><strong>Profil Waktu Tanggap (Latensi):</strong> Rata-rata <em>131 ms</em>, median <em>99 ms</em>, dan p95 <em>282 ms</em>. Latensi ekor melonjak tajam pada <strong>p99: 613 ms</strong> dan <strong>Max: 1.000 ms</strong> akibat <em>CPU throttling</em> (0,25 CPU per worker).</li>
          <li><strong>Keandalan Server:</strong> <code>http_req_failed: 0.0%</code> dan <code>server_failures: 0.0%</code> (tidak ada HTTP 500 maupun koneksi putus).</li>
        </ul>
      </div>
    </div>

    <!-- GAMBAR 2: KONDISI B (8 REPLIKA) BAWAH -->
    <div style="background: #ffffff; border: 1.5px solid #2b6cb0; border-radius: 4px; padding: 6px 8px; margin-bottom: 5px;">
      <div style="font-size: 8.2pt; font-weight: 700; color: #1a365d; margin-bottom: 4px;">
        Gambar 2: Dasbor Metrik k6 &mdash; Kondisi B: Pasca-Skalasi 8 Replika Worker (Total 2,0 Core CPU)
      </div>
      <img src="data:image/png;base64,{b64_8}" alt="k6 Results 8 Replicas" style="width: 100%; height: auto; border: 1px solid #cbd5e0; border-radius: 3px; display: block;">
      <div style="font-size: 7.2pt; color: #2d3748; margin-top: 5px; line-height: 1.35;">
        <strong>Poin-Poin Analisis Kinerja Kondisi B (8 Replika):</strong>
        <ul style="margin: 2px 0 0 14px; padding: 0;">
          <li><strong>Tingkat Kepatuhan SLA (Checks 100,0% Sempurna):</strong> Seluruh 55.400 request tuntas memenuhi SLA (&lt; 500 ms) tanpa ada satupun request yang mengalami perlambatan.</li>
          <li><strong>Throughput &amp; Volume Meningkat (1,22k req/s):</strong> Throughput naik menjadi 1.220 req/s. Total transaksi sukses bertambah <strong>+5.300 tiket</strong> (menjadi <strong>55.400 request</strong>) dalam durasi 45 detik yang sama.</li>
          <li><strong>Pemangkasan Drastis Latensi Ekor:</strong> Rata-rata respon turun ke <strong>98 ms</strong> (di bawah 100 ms), median <em>89 ms</em>, dan p95 <em>200 ms</em>. Latensi ekor puncak <strong>p99 terpangkas 51,5% menjadi 297 ms</strong> dan <strong>Max terpangkas 60,1% menjadi 399 ms</strong>.</li>
          <li><strong>Keandalan &amp; Integritas Kuota:</strong> <code>server_failures: 0.0%</code> dengan kuota inventaris tiket Redis berhenti tepat di angka 0 (<em>zero overselling guarantee</em>).</li>
        </ul>
      </div>
    </div>

    <div class="footer">
      Laporan Progres Kompilasi Kelompok 1 &bull; Komputasi Awan (3 SKS) &bull; Halaman 3 dari 4
    </div>
  </div>

  <!-- ==================== HALAMAN 4: TABEL DATA KUANTITATIF & PEMBAHASAN EVALUASI ==================== -->
  <div class="page">
    <h2 class="section-title">3.3 Tabel Data Pengukuran Kinerja Kuantitatif Hasil Uji Beban</h2>
    <table class="content-table">
      <thead>
        <tr>
          <th>Metrik Kinerja Sistem</th>
          <th style="background-color: #4a5568; text-align: center;">Kondisi A: 2 Replika (0,5 Core CPU)</th>
          <th style="background-color: #2b6cb0; text-align: center;">Kondisi B: 8 Replika (2,0 Core CPU)</th>
          <th style="text-align: center;">Dampak Skalabilitas Horizontal</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>Checks (Pemenuhan SLA)</strong></td>
          <td style="text-align: center;">99,5% <span class="badge badge-limit">0,5% Breach</span></td>
          <td style="text-align: center;"><strong>100,0%</strong> <span class="badge">Sempurna</span></td>
          <td>Eliminasi total seluruh request lambat (&gt; 500 ms)</td>
        </tr>
        <tr>
          <td><strong>Throughput Transaksi (RPS)</strong></td>
          <td style="text-align: center;">1,09k req/s (~1.090 req/s)</td>
          <td style="text-align: center;"><strong>1,22k req/s (~1.220 req/s)</strong></td>
          <td><span class="badge">+11,9% Throughput</span> (+5.300 tiket terlayani)</td>
        </tr>
        <tr>
          <td><strong>Total Transaksi Selesai</strong></td>
          <td style="text-align: center;">50.100 Request</td>
          <td style="text-align: center;"><strong>55.400 Request</strong></td>
          <td>Peningkatan kapasitas volume pemrosesan</td>
        </tr>
        <tr>
          <td><strong>Rata-Rata Latensi (Avg)</strong></td>
          <td style="text-align: center;">131 ms</td>
          <td style="text-align: center;"><strong>98 ms</strong></td>
          <td><span class="badge">Reduksi 25,2%</span> (latensi di bawah 100 ms)</td>
        </tr>
        <tr>
          <td><strong>Latensi Median (Med)</strong></td>
          <td style="text-align: center;">99 ms</td>
          <td style="text-align: center;"><strong>89 ms</strong></td>
          <td>Respon konsisten di bawah 90 ms</td>
        </tr>
        <tr>
          <td><strong>Latensi Persentil ke-90 (p90)</strong></td>
          <td style="text-align: center;">203 ms</td>
          <td style="text-align: center;"><strong>162 ms</strong></td>
          <td>Reduksi 20,2% pada 90% pengguna</td>
        </tr>
        <tr>
          <td><strong>Latensi Persentil ke-95 (p95)</strong></td>
          <td style="text-align: center;">282 ms</td>
          <td style="text-align: center;"><strong>200 ms</strong></td>
          <td><span class="badge">Reduksi 29,1%</span> (stabil pada toleransi SLA)</td>
        </tr>
        <tr>
          <td><strong>Latensi Ekor Puncak (p99)</strong></td>
          <td style="text-align: center;">613 ms <span class="badge badge-fail">Antrean CPU</span></td>
          <td style="text-align: center;"><strong>297 ms</strong></td>
          <td><span class="badge" style="background-color: #2b6cb0;">Terpangkas 51,5%</span> (hilangkan bottleneck)</td>
        </tr>
        <tr>
          <td><strong>Maksimum Waktu Tunggu (Max)</strong></td>
          <td style="text-align: center;">1.000 ms (1,0 detik)</td>
          <td style="text-align: center;"><strong>399 ms</strong></td>
          <td>Reduksi 60,1% antrean CPU throttling</td>
        </tr>
        <tr>
          <td><strong>Tingkat Kegagalan (Failures)</strong></td>
          <td style="text-align: center;">0,0% (0 request)</td>
          <td style="text-align: center;"><strong>0,0% (0 request)</strong></td>
          <td>Zero error rate &amp; 0% overselling inventaris</td>
        </tr>
      </tbody>
    </table>

    <h2 class="section-title">3.4 Pembahasan Teknis dan Analisis Hasil Evaluasi Kinerja</h2>
    <div class="callout-evaluasi">
      <strong>Temuan Pokok Evaluasi:</strong> Skalabilitas horizontal dinamis dari 2 menjadi 8 replika worker terbukti meningkatkan total transaksi dari <strong>50.100</strong> menjadi <strong>55.400 request</strong>, memangkas latensi ekor p99 sebesar <strong>51,5%</strong> (dari 613 ms menjadi 297 ms), serta meningkatkan tingkat kepatuhan checks SLA menjadi <strong>100,0% sempurna</strong>.
    </div>
    <ul>
      <li><strong>Analisis Degradasi Kinerja pada 2 Replika:</strong> Keterbatasan sumber daya pada 2 worker (total 0,5 core CPU) menyebabkan mekanisme penjadwalan Linux *Completely Fair Scheduler* (CFS) membatasi kuota eksekusi (*CPU throttling*). Akibatnya, pada beban puncak 1.000 VU terjadi antrean pemrosesan yang menyebabkan latensi p99 melonjak hingga 613 ms (max 1.000 ms) dan menurunkan kepatuhan checks menjadi 99,5%.</li>
      <li><strong>Efektivitas Skalabilitas Horizontal Dinamis:</strong> Penambahan kapasitas menjadi 8 kontainer (total 2,0 core CPU) memperluas kapasitas pemrosesan paralel. Beban terdistribusi merata ke seluruh worker melalui Swarm IPVS Routing Mesh, menjaga rata-rata latensi turun ke 98 ms, p95 stabil pada 200 ms, dan p99 terpangkas menjadi 297 ms.</li>
      <li><strong>Integritas Transaksi (*Zero Overselling Guarantee*):</strong> Dari total 55.400 transaksi yang dikirimkan, kuota inventaris tiket pada basis data Redis berkurang secara atomik via Lua script hingga tepat pada angka 0. Seluruh permintaan setelah kuota habis ditolak secara aman dengan status HTTP 409 (*Sold Out*). Tidak ditemukan anomali kuota negatif (*0% overselling*) dengan tingkat kegagalan server (*5xx error*) sebesar **0,00%**.</li>
    </ul>

    <h2 class="section-title">3.5 Matriks Komparasi Pemenuhan Seluruh Luaran Silabus</h2>
    <table class="content-table">
      <thead>
        <tr>
          <th style="width: 18%;">Tahapan Evaluasi</th>
          <th style="width: 67%;">Deskripsi Rincian Target Luaran Silabus</th>
          <th style="width: 15%; text-align: center;">Status Verifikasi</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>Pertemuan 1</strong></td>
          <td>Diagram arsitektur sistem, skema jaringan Docker, spesifikasi docker-compose.yml awal, dan repositori Git kelompok.</td>
          <td style="text-align: center;"><span class="badge">Lengkap 100%</span></td>
        </tr>
        <tr>
          <td><strong>Pertemuan 2</strong></td>
          <td>Seluruh container dapat berjalan (up &amp; running) dalam jaringan internal Docker dengan resource limit yang sudah diterapkan.</td>
          <td style="text-align: center;"><span class="badge">Lengkap 100%</span></td>
        </tr>
        <tr>
          <td><strong>Pertemuan 3</strong></td>
          <td>Eksekusi skrip pengujian beban bertahap. Grafik perbandingan throughput (RPS) dan waktu tanggap saat layanan diskalakan.</td>
          <td style="text-align: center;"><span class="badge">Lengkap 100%</span></td>
        </tr>
      </tbody>
    </table>

    <div class="footer">
      Laporan Progres Kompilasi Kelompok 1 &bull; Komputasi Awan (3 SKS) &bull; Halaman 4 dari 4
    </div>
  </div>
</body>
</html>"""

full_html = header_and_pages_1_2 + page_3_and_4

with open('laporan_progres_gabungan_pertemuan_1_2_3.html', 'w', encoding='utf-8') as f:
    f.write(full_html)

print("Updated laporan_progres_gabungan_pertemuan_1_2_3.html successfully with stacked images!")

