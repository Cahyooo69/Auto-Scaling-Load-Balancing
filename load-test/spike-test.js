import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

/**
 * Spike Testing: Flash-Crowd War Tiket (0 -> Ribuan User di Detik yang Sama)
 * Membuktikan keadilan Load Balancer Nginx/Swarm & kesiapan Auto-Scaling (2 -> 8 replika).
 *
 * Jalankan:
 *   k6 run load-test/spike-test.js
 *   k6 run -e SPIKE_VUS=2000 -e TARGET_URL=http://localhost load-test/spike-test.js
 */
const BASE_URL = __ENV.TARGET_URL || 'http://localhost';
const SPIKE_VUS = parseInt(__ENV.SPIKE_VUS || '1500', 10);

export const serverFailureRate = new Rate('server_failures');
export const queueAdmittedRate = new Rate('queue_admitted');
export const checkoutSuccessRate = new Rate('checkout_success');
export const checkoutSoldOutRate = new Rate('checkout_sold_out');
export const checkoutLatency = new Trend('checkout_duration_ms');
export const lbHeaderPresent = new Rate('lb_served_by_present');
export const totalSpikeRequests = new Counter('spike_checkout_attempts');

export const options = {
  stages: [
    { duration: '10s', target: 50 },          // Warm-up baseline
    { duration: '5s', target: SPIKE_VUS },    // Sudden Flash-Crowd Spike!
    { duration: '45s', target: SPIKE_VUS },   // Sustain spike (memicu Swarm scale 2 -> 8)
    { duration: '10s', target: 0 },           // Cool-down
  ],
  thresholds: {
    http_req_duration: ['p(95)<1500'],
    server_failures: ['rate<0.02'],
    lb_served_by_present: ['rate>0.98'],
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
    timeout: '12s',
  };

  let userId = userIndex + 5;
  let queueToken = null;

  group('1. Login & Session Sync', () => {
    const loginRes = http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify({ email: `user${userIndex}@test.com`, password: 'password123' }),
      params
    );
    serverFailureRate.add(loginRes.status >= 500 || loginRes.status === 0 ? 1 : 0);
    if (loginRes.status === 200) {
      try {
        const body = JSON.parse(loginRes.body);
        if (body.user?.id) userId = body.user.id;
        lbHeaderPresent.add(body.servedBy ? 1 : 0);
      } catch {}
    }
  });

  group('2. Masuk Antrean Terdistribusi (Redis Queue)', () => {
    const qRes = http.post(
      `${BASE_URL}/api/queue/join`,
      JSON.stringify({ userId, concertId }),
      params
    );
    serverFailureRate.add(qRes.status >= 500 || qRes.status === 0 ? 1 : 0);

    if (qRes.status === 200) {
      try {
        let qBody = JSON.parse(qRes.body);
        queueToken = qBody.queueToken;
        if (qBody.status === 'QUEUED' && queueToken) {
          sleep(0.5);
          const pollRes = http.get(`${BASE_URL}/api/queue/status?token=${encodeURIComponent(queueToken)}`, params);
          if (pollRes.status === 200) {
            qBody = JSON.parse(pollRes.body);
          }
        }
        queueAdmittedRate.add(qBody.status === 'ADMITTED' ? 1 : 0);
      } catch {}
    }
  });

  group('3. Katalog Cached & Checkout Atomic', () => {
    const catRes = http.get(`${BASE_URL}/api/concerts`, params);
    serverFailureRate.add(catRes.status >= 500 || catRes.status === 0 ? 1 : 0);

    const t0 = Date.now();
    const buyRes = http.post(
      `${BASE_URL}/api/tickets/buy`,
      JSON.stringify({ userId, concertId, queueToken }),
      params
    );
    checkoutLatency.add(Date.now() - t0);
    totalSpikeRequests.add(1);

    const is5xx = buyRes.status >= 500 || buyRes.status === 0;
    serverFailureRate.add(is5xx ? 1 : 0);
    checkoutSuccessRate.add(buyRes.status === 200 ? 1 : 0);
    checkoutSoldOutRate.add(buyRes.status === 409 ? 1 : 0);

    check(buyRes, {
      'spike checkout clean 200 or 409': (r) => r.status === 200 || r.status === 409,
      'has servedBy & X-Upstream-Addr': (r) => {
        try {
          const b = JSON.parse(r.body);
          return Boolean(b.servedBy) && Boolean(r.headers['X-Upstream-Addr'] || r.headers['x-upstream-addr']);
        } catch {
          return false;
        }
      },
    });
  });

  sleep(0.1);
}

