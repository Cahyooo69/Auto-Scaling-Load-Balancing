import http from 'k6/http';
import { check } from 'k6';
import { Rate } from 'k6/metrics';

http.setResponseCallback(http.expectedStatuses(200, 409));
export const failureRate = new Rate('server_failures');

export const options = {
  // Skenario 1.000 User Serentak memperebutkan 1.000 Tiket (1 User = 1 Percobaan Pembelian)
  scenarios: {
    war_tiket_1000_users: {
      executor: 'per-vu-iterations',
      vus: 1000,
      iterations: 1,
      maxDuration: '30s',
    },
  },
  thresholds: {
    http_req_duration: ['avg<1000', 'p(95)<2000'],
    server_failures: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://localhost';

export default function () {
  const url = `${BASE_URL}/tickets/buy`;
  const payload = JSON.stringify({ userId: `user_${__VU}` });
  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: '15s',
  };

  const res = http.post(url, payload, params);

  const isServerFailure = res.status >= 500 || res.status === 0;
  failureRate.add(isServerFailure ? 1 : 0);

  check(res, {
    'status is 200 or 409': (r) => r.status === 200 || r.status === 409,
    'has valid JSON response': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body && body.servedBy !== undefined;
      } catch (e) {
        return false;
      }
    },
  });
}

