import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// HTTP 200 (Sukses) & 409 (Sold Out) merupakan respon bisnis valid saat war berlangsung
http.setResponseCallback(http.expectedStatuses(200, 409));

// Custom Metrics for Cloud Performance Analysis
export const serverFailureRate = new Rate('server_failures');
export const successCheckoutRate = new Rate('checkout_success');
export const soldOutRate = new Rate('checkout_sold_out');
export const checkoutDuration = new Trend('checkout_duration_ms');
export const totalTransactions = new Counter('total_transactions_attempted');

export const options = {
  stages: [
    // Tahapan Standar 3 SKS: Ramp-up 10 -> 100 -> 500 -> 1000 VU dalam durasi total 3 Menit
    { duration: '30s', target: 10 },    // Tahap 1: Sanity & Baseline (10 VU)
    { duration: '45s', target: 100 },   // Tahap 2: Ramp-up Awal (100 VU)
    { duration: '45s', target: 500 },   // Tahap 3: Beban Menengah (500 VU)
    { duration: '60s', target: 1000 },  // Tahap 4: Peak War Tiket (1.000 VU)
  ],
  thresholds: {
    // Target SLA Dosen: Waktu tanggap < 200ms
    http_req_duration: ['p(95)<200'],
    // SLA Keandalan Dosen: Tingkat kegagalan server (5xx / drop) < 1%
    server_failures: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://localhost';

export function setup() {
  const res = http.post(`${BASE_URL}/api/tickets/reset`, '{}', {
    headers: { 'Content-Type': 'application/json' },
    timeout: '10s',
  });
  check(res, { 'setup reset HTTP 200': (r) => r.status === 200 });
}

export default function () {
  // Simulasi 1.000 Akun Pengguna Dummy dari seed.sql (user1@test.com s/d user1000@test.com)
  const vuId = __VU || 1;
  const userIndex = ((vuId - 1) % 1000) + 1;
  const userEmail = `user${userIndex}@test.com`;
  const password = 'password123';
  
  // Pilih salah satu konser secara bergantian (ID 1, 2, atau 3)
  const concertId = (userIndex % 3) + 1;

  const standardHeaders = {
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'k6-WarTiket-LoadTest/2.0',
    },
    timeout: '10s',
  };

  let userId = userIndex + 5; // Offset ID akun dummy pada database

  // ==========================================================================
  // ALUR 1: LOGIN PENGGUNA (Autentikasi Akun k6)
  // ==========================================================================
  group('1. Login Pengguna', () => {
    const loginPayload = JSON.stringify({
      email: userEmail,
      password: password,
    });

    const loginRes = http.post(`${BASE_URL}/api/auth/login`, loginPayload, standardHeaders);

    const isFailure = loginRes.status >= 500 || loginRes.status === 0;
    serverFailureRate.add(isFailure ? 1 : 0);

    const loginOk = check(loginRes, {
      'login status 200': (r) => r.status === 200,
      'user data returned': (r) => {
        try {
          const body = JSON.parse(r.body);
          if (body.user && body.user.id) {
            userId = body.user.id;
            return true;
          }
          return false;
        } catch (e) {
          return false;
        }
      },
    });
  });

  // Jeda singkat simulasi aktivitas manusia membaca halaman (100ms - 200ms)
  sleep(0.15);

  // ==========================================================================
  // ALUR 2: LIHAT KATALOG KONSER REAL-TIME
  // ==========================================================================
  group('2. Lihat Katalog Konser', () => {
    const concertsRes = http.get(`${BASE_URL}/api/concerts`, standardHeaders);

    const isFailure = concertsRes.status >= 500 || concertsRes.status === 0;
    serverFailureRate.add(isFailure ? 1 : 0);

    check(concertsRes, {
      'katalog status 200': (r) => r.status === 200,
      'katalog berisi minimal 3 konser': (r) => {
        try {
          const list = JSON.parse(r.body);
          return Array.isArray(list) && list.length >= 3;
        } catch (e) {
          return false;
        }
      },
    });
  });

  // Jeda singkat sebelum war tiket (50ms - 100ms)
  sleep(0.1);

  // ==========================================================================
  // ALUR 3: WAR TIKET CHECKOUT (ATOMIC LOCK REDIS + POSTGRESQL ACID)
  // ==========================================================================
  group('3. War Tiket Checkout', () => {
    const buyPayload = JSON.stringify({
      userId: userId,
      concertId: concertId,
    });

    const startTime = Date.now();
    const buyRes = http.post(`${BASE_URL}/api/tickets/buy`, buyPayload, standardHeaders);
    checkoutDuration.add(Date.now() - startTime);
    totalTransactions.add(1);

    const isFailure = buyRes.status >= 500 || buyRes.status === 0;
    serverFailureRate.add(isFailure ? 1 : 0);

    const isSuccess = buyRes.status === 200;
    const isSoldOut = buyRes.status === 409;

    successCheckoutRate.add(isSuccess ? 1 : 0);
    soldOutRate.add(isSoldOut ? 1 : 0);

    check(buyRes, {
      'checkout status 200 (Sukses) atau 409 (Sold Out)': (r) => r.status === 200 || r.status === 409,
      'respon memuat server instance load balancer (servedBy)': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body && body.servedBy !== undefined;
        } catch (e) {
          return false;
        }
      },
      'durasi checkout < 500ms': (r) => r.timings.duration < 500,
    });
  });

  // Jeda antar iterasi pengguna
  sleep(0.2);
}

export function teardown() {
  http.post(`${BASE_URL}/api/tickets/reset`, '{}', {
    headers: { 'Content-Type': 'application/json' },
    timeout: '10s',
  });
}
