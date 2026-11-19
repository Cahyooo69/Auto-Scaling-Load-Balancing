import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Counter, Trend } from 'k6/metrics';

// Status 200, 409 (Sold Out), dan 500 (Redis down) semua dilacak tanpa gagalkan k6
http.setResponseCallback(http.expectedStatuses(200, 409, 500));

export const failureRate = new Rate('server_failures');
export const recoveryRequests = Counter('recovery_requests');
export const failedDuringCrash = Counter('failed_during_crash');
export const rtoTrend = new Trend('rto_detection_ms');

export const options = {
  // 1.000 VU konstan selama 90 detik — container dibunuh di tengah-tengah oleh operator
  scenarios: {
    sustained_load: {
      executor: 'constant-vus',
      vus: 1000,
      duration: '90s',
    },
  },
  thresholds: {
    http_req_duration: ['avg<500'],
    server_failures: ['rate<0.05'], // toleransi 5% saat crash window
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://localhost';

export default function () {
  const url = `${BASE_URL}/tickets/buy`;
  const payload = JSON.stringify({ userId: `failover_${__VU}_${__ITER}` });
  const params = {
    headers: { 'Content-Type': 'application/json' },
    timeout: '10s',
  };

  const res = http.post(url, payload, params);

  const isServerFailure = res.status >= 500 || res.status === 0;
  failureRate.add(isServerFailure ? 1 : 0);

  if (isServerFailure) {
    failedDuringCrash.add(1);
  }

  check(res, {
    'not a network error': (r) => r.status !== 0,
    'valid business response': (r) => r.status === 200 || r.status === 409 || r.status === 500,
  });

  sleep(0.1);
}
