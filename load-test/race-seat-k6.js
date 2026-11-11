import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

// Skenario 5: 20 VUs serentak memperebutkan kursi YANG SAMA (E-05) untuk membuktikan 0% overselling.
// Jalankan via run-k6.bat atau docker run grafana/k6 (TARGET_URL default ke host.docker.internal)
const BASE_URL = __ENV.TARGET_URL || 'http://localhost';
const SEAT_TARGET = __ENV.TARGET_SEAT || 'E-05';

const ticketSuccess = new Counter('race_ticket_success');
const ticketConflict = new Counter('race_ticket_conflict');
const serverErrors = new Counter('race_server_errors');

export const options = {
  scenarios: {
    seat_race: {
      executor: 'per-vu-iterations',
      vus: 20,
      iterations: 1,
      maxDuration: '30s',
    },
  },
  thresholds: {
    race_ticket_success: ['count==1'],     // Tepat 1 pemenang -> 0% overselling
    race_ticket_conflict: ['count==19'],   // Sisanya ditolak Redis Atomic Lock (HTTP 409)
    race_server_errors: ['count==0'],      // Bebas HTTP 5xx
  },
};

export function setup() {
  const res = http.post(`${BASE_URL}/api/tickets/reset`, '{}', {
    headers: { 'Content-Type': 'application/json' },
  });
  check(res, { 'setup reset HTTP 200': (r) => r.status === 200 });
}

export default function () {
  const payload = JSON.stringify({
    userId: __VU,
    concertId: 1,
    seatNumber: SEAT_TARGET,
  });

  const res = http.post(`${BASE_URL}/api/tickets/buy`, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: '10s',
  });

  if (res.status === 200) ticketSuccess.add(1);
  else if (res.status === 409) ticketConflict.add(1);
  else if (res.status >= 500 || res.status === 0) serverErrors.add(1);

  check(res, {
    'response is clean 200 winner or 409 conflict': (r) => r.status === 200 || r.status === 409,
  });
}

export function teardown() {
  http.post(`${BASE_URL}/api/tickets/reset`, '{}', {
    headers: { 'Content-Type': 'application/json' },
  });
}

