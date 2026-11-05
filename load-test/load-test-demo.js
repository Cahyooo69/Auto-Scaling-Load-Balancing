import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

// Status 200 (Bought) dan 409 (Sold Out) keduanya adalah respon bisnis yang valid
http.setResponseCallback(http.expectedStatuses(200, 409));

// Custom metric untuk melacak kegagalan server sejati (5xx / error jaringan)
export const failureRate = new Rate('server_failures');

export const options = {
  // Pengujian Beban Bertahap 4 Level (Sesuai Silabus & Tabel Laporan)
  stages: [
    { duration: '5s',  target: 10 },   // Tahap 1: Inisiasi Beban Rendah (10 VU)
    { duration: '10s', target: 100 },  // Tahap 2: Beban Menengah (100 VU)
    { duration: '15s', target: 500 },  // Tahap 3: Beban Tinggi (500 VU)
    { duration: '15s', target: 1000 }, // Tahap 4: Beban Puncak Maksimum (1.000 VU)
  ],
  thresholds: {
    // Target SLA beban puncak 1000 VU
    http_req_duration: ['avg<350', 'p(95)<500'],
    server_failures: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://localhost';

export default function () {
  const url = `${BASE_URL}/tickets/buy`;
  const payload = JSON.stringify({ userId: `demo_${__VU}_${__ITER}` });
  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: '10s',
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
    'response time wajar': (r) => r.timings.duration < 500,
  });

  // Pacing per virtual user (200ms)
  sleep(0.2);
}
