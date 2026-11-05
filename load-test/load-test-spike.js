import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import exec from 'k6/execution';

// Status 200 (Berhasil) dan 409 (Sold Out) adalah respon bisnis valid
http.setResponseCallback(http.expectedStatuses(200, 409));

// Metrik kegagalan server sejati
export const failureRate = new Rate('server_failures');

export const options = {
  // 1.000 VUs LANGSUNG AKTIF DI DETIK KE-0 (Instant Spike Concurrency)
  scenarios: {
    instant_flash_crowd: {
      executor: 'constant-vus',
      vus: 1000,
      duration: '30s',
    },
  },
  thresholds: {
    http_req_duration: ['avg<500', 'p(95)<1000'],
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
    timeout: '10s',
  };

  const res = http.post(url, payload, params);

  // Begitu tiket habis terjual (HTTP 409), hentikan pengujian seketika
  if (res.status === 409) {
    exec.test.abort('War tiket selesai: Seluruh 1.000 tiket telah ludes terjual!');
  }

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

  sleep(0.1);
}

