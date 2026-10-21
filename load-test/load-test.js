import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

// Custom metric to track true server failures (5xx, network drops)
export const failureRate = new Rate('server_failures');

export const options = {
  stages: [
    { duration: '30s', target: 10 },    // Warm up / low load: 10 VUs
    { duration: '45s', target: 100 },   // Medium load: 100 VUs
    { duration: '45s', target: 500 },   // High load: 500 VUs
    { duration: '60s', target: 1000 },  // Peak war tiket load: 1000 VUs
  ],
  thresholds: {
    // Target SLA: Response time < 200ms (95th percentile)
    http_req_duration: ['p(95)<200'],
    // Target SLA: Server error rate < 1%
    server_failures: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://localhost';

export default function () {
  const url = `${BASE_URL}/tickets/buy`;
  const payload = JSON.stringify({ userId: `user_${__VU}_${__ITER}` });
  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: '5s',
  };

  const res = http.post(url, payload, params);

  // Status 200 (Success bought) and 409 (Sold Out) are valid business outcomes
  // Any 5xx or connection error is counted as a server failure
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
    'response time < 200ms': (r) => r.timings.duration < 200,
  });

  // Brief pacing between requests per virtual user (100ms - 200ms)
  sleep(0.1);
}
