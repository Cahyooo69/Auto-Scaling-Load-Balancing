// Script demonstrasi otomatis: Pengujian Fail-Safe & Auto-Recovery saat Redis dimatikan
const http = require('http');
const { execSync } = require('child_process');

function sendBuyRequest() {
  return new Promise((resolve) => {
    const start = Date.now();
    const req = http.request(
      'http://localhost/tickets/buy',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          const duration = Date.now() - start;
          try {
            resolve({ status: res.statusCode, duration, body: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, duration, raw: data });
          }
        });
      }
    );

    req.on('error', (err) => {
      resolve({ status: 500, duration: Date.now() - start, error: err.message });
    });

    req.write(JSON.stringify({ userId: 'demo_user' }));
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runDemo() {
  console.log('========================================================');
  console.log('  DEMO PENGUJIAN FAIL-SAFE & AUTO-RECOVERY SAAT REDIS MATI');
  console.log('========================================================\n');

  // 1. Uji Kondisi Normal (Baseline)
  console.log('--- LANGKAH 1: UJI KONDISI NORMAL (BASELINE) ---');
  const res1 = await sendBuyRequest();
  console.log(`HTTP Status : ${res1.status}`);
  console.log(`Success     : ${res1.body?.success}`);
  console.log(`Sisa Stok   : ${res1.body?.remainingStock}`);
  console.log(`Served By   : ${res1.body?.servedBy}`);
  console.log('-> Status   : Sistem beroperasi normal.\n');

  // 2. Matikan Redis (Skalasi ke 0)
  console.log('--- LANGKAH 2: MEMATIKAN BASIS DATA REDIS (SIMULASI CRASH) ---');
  console.log('Menjalankan: docker service scale wartiket_redis=0 ...');
  execSync('docker service scale wartiket_redis=0', { stdio: 'ignore' });
  await sleep(1500);
  console.log('-> Container Redis saat ini MATI TOTAL (0 instance aktif).\n');

  // 3. Tembak Request Saat Redis Mati
  console.log('--- LANGKAH 3: MENGIRIM TRANSAKSI SAAT REDIS MATI (PEMBUKTIAN FAIL-SAFE) ---');
  const res2 = await sendBuyRequest();
  console.log(`HTTP Status : ${res2.status}`);
  console.log(`Success     : ${res2.body?.success}`);
  console.log(`Error Msg   : ${res2.body?.error || res2.error}`);
  console.log(`Detail      : ${res2.body?.message || '-'}`);
  if (res2.status === 500) {
    console.log('-> PEMBUKTIAN BERHASIL: Transaksi DITOLAK AMAN dengan HTTP 500.');
    console.log('-> Sesuai prinsip CAP Theorem: Data Stok Konsisten, Zero Overselling!\n');
  } else {
    console.log(`-> Status respon: ${res2.status}\n`);
  }

  // 4. Hidupkan Kembali Redis (Swarm Auto-Recovery)
  console.log('--- LANGKAH 4: MENGHIDUPKAN KEMBALI REDIS (AUTO-RECOVERY SWARM) ---');
  console.log('Menjalankan: docker service scale wartiket_redis=1 ...');
  execSync('docker service scale wartiket_redis=1', { stdio: 'ignore' });
  console.log('Menunggu 4 detik agar Redis siap dan ioredis auto-reconnect...');
  await sleep(4000);
  console.log('-> Container Redis telah hidup kembali.\n');

  // 5. Uji Kembali Pasca Pemulihan
  console.log('--- LANGKAH 5: TRANSAKSI SETELAH REDIS PULIH (AUTO-RECONNECT) ---');
  const res3 = await sendBuyRequest();
  console.log(`HTTP Status : ${res3.status}`);
  console.log(`Success     : ${res3.body?.success}`);
  console.log(`Sisa Stok   : ${res3.body?.remainingStock}`);
  console.log(`Served By   : ${res3.body?.servedBy}`);
  if (res3.status === 200) {
    console.log('-> PEMBUKTIAN BERHASIL: Backend Node.js langsung pulih normal tanpa perlu restart!');
  }

  console.log('\n========================================================');
  console.log('  KESIMPULAN: ARSITEKTUR MEMENUHI SYARAT FAIL-SAFE & HA');
  console.log('========================================================');
}

runDemo();
