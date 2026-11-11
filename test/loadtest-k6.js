import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

/**
 * Standar Pengujian Beban 3 SKS: Ramp-Up 10 -> 100 -> 500 -> 1.000 VU dalam 3 Menit
 * SLA Target: Response Time p(95) < 200ms & Server Error Rate < 1%
 *
 * Jalankan:
 *   k6 run test/loadtest-k6.js
 *   Get-Content test\loadtest-k6.js -Raw | docker run --rm -i -e TARGET_URL=http://host.docker.internal grafana/k6 run -
 */
const BASE_URL = __ENV.TARGET_URL || 'http://localhost';

// Anggap 200 OK dan 409 Conflict (tiket habis/rebutan seat lock) sebagai HTTP valid bisnis (bukan crash)
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 409));

export const serverFailures = new Rate('server_failures');
export const slaUnder200Ms = new Rate('sla_under_200ms');
export const checkoutSuccess = new Rate('checkout_success');
export const checkoutConflict = new Rate('checkout_conflict');
export const checkoutLatency = new Trend('checkout_latency_ms');
export const totalRequests = new Counter('total_war_requests');

export const options = {
  stages: [
    { duration: '30s', target: 10 },    // Tahap 1: Baseline (10 VU)
    { duration: '45s', target: 100 },   // Tahap 2: Warm Ramp-Up (100 VU)
    { duration: '45s', target: 500 },   // Tahap 3: High Concurrency (500 VU)
    { duration: '45s', target: 1000 },  // Tahap 4: Peak War Tiket (1.000 VU)
    { duration: '15s', target: 0 },     // Tahap 5: Cool-Down (Total tepat 180s / 3 Menit)
  ],
  thresholds: {
    http_req_duration: ['p(95)<200'],
    http_req_failed: ['rate<0.01'],
    server_failures: ['rate<0.01'],
  },
};

export function setup() {
  const res = http.post(`${BASE_URL}/api/tickets/reset`, '{}', {
    headers: { 'Content-Type': 'application/json' },
    timeout: '10s',
  });
  check(res, { 'setup reset HTTP 200': (r) => r.status === 200 });
}

export default function () {
  const vuId = __VU || 1;
  const userIndex = ((vuId - 1) % 1000) + 1;
  const concertId = (userIndex % 3) + 1;
  const params = {
    headers: { 'Content-Type': 'application/json' },
    timeout: '10s',
  };

  let userId = userIndex + 5;
  let jwtToken = '';

  group('1. Login JWT', () => {
    const res = http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify({ email: `user${userIndex}@test.com`, password: 'password123' }),
      params
    );
    const isErr = res.status >= 500 || res.status === 0;
    serverFailures.add(isErr ? 1 : 0);
    slaUnder200Ms.add(res.timings.duration < 200 ? 1 : 0);

    if (res.status === 200) {
      try {
        const body = JSON.parse(res.body);
        userId = body.user?.id || userId;
        jwtToken = body.jwtToken || '';
      } catch {}
    }
  });

  group('2. Katalog Konser (Cached)', () => {
    const res = http.get(`${BASE_URL}/api/concerts`, params);
    serverFailures.add(res.status >= 500 || res.status === 0 ? 1 : 0);
    slaUnder200Ms.add(res.timings.duration < 200 ? 1 : 0);
    check(res, { 'concerts status 200': (r) => r.status === 200 });
  });

  group('3. Checkout War Tiket (Redis Lock + Postgres ACID)', () => {
    const t0 = Date.now();
    const res = http.post(
      `${BASE_URL}/api/tickets/buy`,
      JSON.stringify({ userId, concertId }),
      params
    );
    const elapsed = Date.now() - t0;
    checkoutLatency.add(elapsed);
    totalRequests.add(1);

    const isErr = res.status >= 500 || res.status === 0;
    serverFailures.add(isErr ? 1 : 0);
    slaUnder200Ms.add(res.timings.duration < 200 ? 1 : 0);
    checkoutSuccess.add(res.status === 200 ? 1 : 0);
    checkoutConflict.add(res.status === 409 ? 1 : 0);

    check(res, {
      'checkout 200 OK atau 409 Conflict': (r) => r.status === 200 || r.status === 409,
      'worker servedBy tersedia': (r) => {
        try {
          return Boolean(JSON.parse(r.body).servedBy);
        } catch {
          return false;
        }
      },
    });
  });

  if (jwtToken && (__ITER % 5 === 0)) {
    group('4. Cek Riwayat Pemesanan (JWT)', () => {
      const res = http.get(`${BASE_URL}/api/bookings/my-orders`, {
        headers: { Authorization: `Bearer ${jwtToken}` },
        timeout: '10s',
      });
      serverFailures.add(res.status >= 500 || res.status === 0 ? 1 : 0);
      check(res, { 'my-orders status 200': (r) => r.status === 200 });
    });
  }

  sleep(0.15);
}

