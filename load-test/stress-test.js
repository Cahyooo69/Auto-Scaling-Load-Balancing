import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

/**
 * Stress Testing: Step-Up Kapasitas Maksimal untuk Identifikasi Bottleneck
 * Menaikkan VU bertahap (200 -> 500 -> 1000 -> 1500 -> 2000 -> 2500) dan memisahkan
 * latensi per tier (Login, Cached Catalog, Seats, Atomic Checkout).
 *
 * Jalankan:
 *   k6 run load-test/stress-test.js
 */
const BASE_URL = __ENV.TARGET_URL || 'http://localhost';

export const http5xxRate = new Rate('stress_5xx_rate');
export const degraded503Rate = new Rate('stress_503_degraded_rate');
export const loginTrend = new Trend('tier_login_ms');
export const catalogTrend = new Trend('tier_catalog_ms');
export const seatsTrend = new Trend('tier_seats_ms');
export const checkoutTrend = new Trend('tier_checkout_ms');
export const totalReqs = new Counter('stress_total_requests');

export const options = {
  stages: [
    { duration: '25s', target: 200 },   // Step 1: Normal peak
    { duration: '30s', target: 500 },   // Step 2: Heavy load
    { duration: '30s', target: 1000 },  // Step 3: Target SLA 1000 VU
    { duration: '30s', target: 1500 },  // Step 4: Overload boundary
    { duration: '30s', target: 2000 },  // Step 5: High stress
    { duration: '30s', target: 2500 },  // Step 6: Breaking point probe
    { duration: '15s', target: 0 },     // Recovery cool-down
  ],
  thresholds: {
    stress_5xx_rate: ['rate<0.05'],
    http_req_duration: ['p(95)<2500'],
  },
};

export function setup() {
  http.post(`${BASE_URL}/api/tickets/reset`, '{}', {
    headers: { 'Content-Type': 'application/json' },
    timeout: '10s',
  });
}

export default function () {
  const userIndex = (((__VU || 1) - 1) % 1000) + 1;
  const concertId = (userIndex % 3) + 1;
  const opts = {
    headers: { 'Content-Type': 'application/json' },
    timeout: '10s',
  };

  // 1. Auth Tier (Redis email cache + DB lower(email) index)
  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: `user${userIndex}@test.com`, password: 'password123' }),
    opts
  );
  loginTrend.add(loginRes.timings.duration);
  totalReqs.add(1);
  http5xxRate.add(loginRes.status >= 500 || loginRes.status === 0 ? 1 : 0);
  degraded503Rate.add(loginRes.status === 503 ? 1 : 0);

  let userId = userIndex + 5;
  if (loginRes.status === 200) {
    try { userId = JSON.parse(loginRes.body).user?.id || userId; } catch {}
  }

  // 2. Catalog Read Tier (Redis Cache)
  const catRes = http.get(`${BASE_URL}/api/concerts`, opts);
  catalogTrend.add(catRes.timings.duration);
  totalReqs.add(1);
  http5xxRate.add(catRes.status >= 500 || catRes.status === 0 ? 1 : 0);

  // 3. Real-Time Seat Map Tier (Redis Cache + MGET Lock Merge)
  const seatsRes = http.get(`${BASE_URL}/api/concerts/${concertId}/seats`, opts);
  seatsTrend.add(seatsRes.timings.duration);
  totalReqs.add(1);
  http5xxRate.add(seatsRes.status >= 500 || seatsRes.status === 0 ? 1 : 0);

  // 4. Write Transaction Tier (Redis Lua + PostgreSQL ACID Pool)
  const buyRes = http.post(
    `${BASE_URL}/api/tickets/buy`,
    JSON.stringify({ userId, concertId }),
    opts
  );
  checkoutTrend.add(buyRes.timings.duration);
  totalReqs.add(1);
  http5xxRate.add(buyRes.status >= 500 || buyRes.status === 0 ? 1 : 0);
  degraded503Rate.add(buyRes.status === 503 ? 1 : 0);

  check(buyRes, {
    'checkout non-5xx': (r) => r.status === 200 || r.status === 409,
  });

  sleep(0.2);
}

