import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom Metrics for Cloud Performance Analysis
export const serverFailureRate = new Rate('server_failures');
export const successCheckoutRate = new Rate('checkout_success');
export const soldOutRate = new Rate('checkout_sold_out');
export const checkoutDuration = new Trend('checkout_duration_ms');
export const totalTransactions = new Counter('total_transactions_attempted');

// 200/201 (Sukses), 409 (Sold Out), 410 (Hold Expired) adalah respon bisnis valid
http.setResponseCallback(http.expectedStatuses(200, 201, 409, 410));

export const options = {
  stages: [
    // Tahapan Standar 3 SKS: Ramp-up 10 -> 100 -> 500 -> 1000 VU dalam durasi total 3 Menit
    { duration: '30s', target: 10 },    // Tahap 1: Sanity & Baseline (10 VU)
    { duration: '45s', target: 100 },   // Tahap 2: Ramp-up Awal (100 VU)
    { duration: '45s', target: 500 },   // Tahap 3: Beban Menengah (500 VU)
    { duration: '60s', target: 1000 },  // Tahap 4: Peak War Tiket (1.000 VU)
  ],
  thresholds: {
    http_req_duration: ['p(95)<200'],
    server_failures: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://localhost';

export default function () {
  const vuId = __VU || 1;
  const userIndex = ((vuId - 1) % 1000) + 1;
  const userEmail = `user${userIndex}@test.com`;
  const password = 'password123';
  const concertId = (userIndex % 3) + 1;

  const standardHeaders = {
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'k6-WarTiket-LoadTest/3.0',
    },
    timeout: '10s',
  };

  let jwtToken = '';

  // ==========================================================================
  // ALUR 1: STATELESS LOGIN (Redis Session + HS256 JWT via Read Replica)
  // ==========================================================================
  group('1. Login Pengguna', () => {
    const loginRes = http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify({ email: userEmail, password }),
      standardHeaders
    );
    serverFailureRate.add(loginRes.status >= 500 || loginRes.status === 0 ? 1 : 0);
    check(loginRes, {
      'login status 200': (r) => r.status === 200,
      'jwt token issued': (r) => {
        try {
          const body = JSON.parse(r.body);
          if (body.jwtToken) {
            jwtToken = body.jwtToken;
            return true;
          }
          return false;
        } catch {
          return false;
        }
      },
    });
  });

  sleep(0.15);

  // ==========================================================================
  // ALUR 2: LIHAT KATALOG, ASET CDN & BANDINGKAN DENAH KURSI (Read-Heavy)
  // ==========================================================================
  group('2. Browse Katalog, CDN & Denah Kursi', () => {
    const concertsRes = http.get(`${BASE_URL}/api/concerts`, standardHeaders);
    serverFailureRate.add(concertsRes.status >= 500 || concertsRes.status === 0 ? 1 : 0);
    check(concertsRes, { 'katalog status 200': (r) => r.status === 200 });

    const cdnRes = http.get(`${BASE_URL}/cdn/img/poster-coldplay.svg`, { timeout: '10s' });
    serverFailureRate.add(cdnRes.status >= 500 || cdnRes.status === 0 ? 1 : 0);
    check(cdnRes, { 'cdn asset 200': (r) => r.status === 200 });

    const seatsRes = http.get(`${BASE_URL}/api/concerts/${concertId}/seats`, standardHeaders);
    serverFailureRate.add(seatsRes.status >= 500 || seatsRes.status === 0 ? 1 : 0);
    check(seatsRes, { 'denah kursi 200': (r) => r.status === 200 });
  });

  sleep(0.1);

  // ==========================================================================
  // ALUR 3: 2-STEP CHECKOUT (Hold 5 Menit -> Confirm Payment via PgBouncer)
  // ==========================================================================
  group('3. Reserve (5-Min Hold) & Confirm Payment', () => {
    if (!jwtToken) return;
    const authHeaders = {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwtToken}`,
        'User-Agent': 'k6-WarTiket-LoadTest/3.0',
      },
      timeout: '10s',
    };

    const startTime = Date.now();
    const reserveRes = http.post(
      `${BASE_URL}/api/tickets/reserve`,
      JSON.stringify({ concertId }),
      authHeaders
    );
    totalTransactions.add(1);
    serverFailureRate.add(reserveRes.status >= 500 || reserveRes.status === 0 ? 1 : 0);

    if (reserveRes.status === 409) {
      checkoutDuration.add(Date.now() - startTime);
      soldOutRate.add(1);
      successCheckoutRate.add(0);
      return;
    }

    let bookingCode = '';
    try {
      bookingCode = JSON.parse(reserveRes.body)?.bookingCode || '';
    } catch {}

    if (reserveRes.status === 201 && bookingCode) {
      sleep(0.05);
      const confirmRes = http.post(
        `${BASE_URL}/api/tickets/confirm`,
        JSON.stringify({ bookingCode }),
        authHeaders
      );
      checkoutDuration.add(Date.now() - startTime);
      serverFailureRate.add(confirmRes.status >= 500 || confirmRes.status === 0 ? 1 : 0);

      const ok = confirmRes.status === 200;
      successCheckoutRate.add(ok ? 1 : 0);
      soldOutRate.add(0);

      check(confirmRes, {
        'payment confirmed 200': (r) => r.status === 200,
        'servedBy returned': (r) => {
          try {
            return Boolean(JSON.parse(r.body)?.servedBy);
          } catch {
            return false;
          }
        },
      });
    }
  });

  sleep(0.2);
}
