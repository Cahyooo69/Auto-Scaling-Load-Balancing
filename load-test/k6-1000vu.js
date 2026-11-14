import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

/**
 * ============================================================================
 * STRESS & LOAD TESTING 1.000 VIRTUAL USERS (k6) - TIKETWAR CLOUD CLUSTER
 * ============================================================================
 * 
 * Skenario Ramp-up 3 Menit:
 *   - 0s - 30s : Naik dari 0 ke 10 VU (Pemanasan / Warm up)
 *   - 30s - 1m : Naik dari 10 ke 100 VU (Peningkatan beban transaksi)
 *   - 1m - 2m  : Naik dari 100 ke 500 VU (Spike awal antrean)
 *   - 2m - 3m  : Puncak War Tiket di 1.000 VU konstan
 *
 * Target Metrik SLA:
 *   - p95 Response Time < 200ms
 *   - Error Rate (HTTP 5xx / Koneksi Putus) < 1%
 *   - Atomic Redis Lock 0% Overselling
 *
 * Cara Menjalankan:
 *   k6 run load-test/k6-1000vu.js
 *   atau via script: .\run-k6.bat
 */

export const unexpectedFailRate = new Rate('unexpected_5xx_failure_rate');
export const successBookingRate = new Rate('successful_booking_rate');
export const conflictLockRate = new Rate('seat_conflict_409_rate');
export const buyLatencyTrend = new Trend('ticket_buy_latency_ms');
export const totalCheckouts = new Counter('total_checkout_attempts');

export const options = {
  stages: [
    { duration: '30s', target: 10 },    // Tahap 1 (0s - 30s): Warm up ke 10 VU
    { duration: '30s', target: 100 },   // Tahap 2 (30s - 1m): Ramp up ke 100 VU
    { duration: '60s', target: 500 },   // Tahap 3 (1m - 2m): Spike antrean ke 500 VU
    { duration: '60s', target: 1000 },  // Tahap 4 (2m - 3m): Puncak War Tiket 1.000 VU
  ],
  thresholds: {
    // SLA Metrik 1: Latensi p95 di bawah 200 milidetik
    http_req_duration: ['p(95)<200'],
    // SLA Metrik 2: Kegagalan server/koneksi putus < 1%
    unexpected_5xx_failure_rate: ['rate<0.01'],
    http_req_failed: ['rate<0.01'],
  },
  insecureSkipTLSVerify: true,
};

const BASE_URL = __ENV.TARGET_URL || 'https://wartiketkonser.id';

// Setup awal: pastikan kuota dan status cluster bersih sebelum tes dimulai
export function setup() {
  const resetRes = http.post(`${BASE_URL}/api/tickets/reset`, '{}', {
    headers: { 'Content-Type': 'application/json' },
    timeout: '10s',
  });
  console.log(`[Setup Cluster] Reset kuota & lock status: HTTP ${resetRes.status}`);
  return { startTime: new Date().toISOString() };
}

export default function () {
  totalCheckouts.add(1);

  // Kursi hot spot baris A s.d. E (sesuai seed database) untuk simulasi Race Condition
  const hotSeats = ['A-01', 'A-02', 'B-01', 'B-02', 'C-01', 'C-02', 'D-01', 'E-05'];
  const targetSeat = hotSeats[Math.floor(Math.random() * hotSeats.length)];
  const userId = (__VU * 1000) + __ITER;

  const payload = JSON.stringify({
    userId: userId,
    concertId: 1,
    seatNumber: targetSeat,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'k6-WarTiket-1000VU-StressTest',
    },
    timeout: '6s',
  };

  const start = Date.now();
  const res = http.post(`${BASE_URL}/api/tickets/buy`, payload, params);
  const latency = Date.now() - start;

  buyLatencyTrend.add(latency);

  // Evaluasi Respons HTTP:
  // - 200 OK  : Pemenang kursi (Transaksi sukses)
  // - 409     : Conflict (Wajar dalam Race Condition; membuktikan Redis Atomic Lock mencegah double booking)
  // - 429     : Rate limited / Queued
  // - 5xx / 0 : Unexpected failure (Server crash / timeout)

  const isSuccess = res.status === 200;
  const isConflict = res.status === 409;
  const isServerFailure = res.status >= 500 || res.status === 0;

  successBookingRate.add(isSuccess);
  conflictLockRate.add(isConflict);
  unexpectedFailRate.add(isServerFailure);

  check(res, {
    'Status code valid (200 OK / 409 Conflict)': (r) => r.status === 200 || r.status === 409,
    'Bebas dari error 502/503/504 Bad Gateway': (r) => r.status < 500,
    'Response time di bawah 500ms': (r) => r.timings.duration < 500,
  });

  // Jeda dinamis antar iterasi (50ms - 150ms) mensimulasikan ketikan pengguna asli
  sleep(0.05 + Math.random() * 0.1);
}

export function teardown(data) {
  console.log(`[Teardown Cluster] Pengujian 1.000 VU selesai (dimulai pada: ${data.startTime}).`);
  const finalHealth = http.get(`${BASE_URL}/api/system/info`, { timeout: '5s' });
  console.log(`[Status Akhir Nginx & Database]: HTTP ${finalHealth.status}`);
}
