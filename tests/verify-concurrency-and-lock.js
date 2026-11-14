/**
 * Concurrency / Race Condition Integration Test (Skenario 5)
 * Sends 20 simultaneous POST /api/tickets/buy requests for the SAME seat (E-05)
 * across 20 distinct userIds to prove Redis Atomic Lock guarantees 0% overselling.
 *
 * Run: node tests/verify-concurrency-and-lock.js
 */
const assert = require('node:assert/strict');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const BASE_URL = (process.env.TARGET_URL || 'https://wartiketkonser.id').replace(/\/+$/, '');
const CONCURRENT_USERS = 20;
const TARGET_CONCERT_ID = 1;
const TARGET_SEAT = 'E-05';

async function postJson(path, payload) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 120) };
  }
  return { status: res.status, body: json };
}

async function run() {
  console.log(`[1/4] Resetting demo quota & locks at ${BASE_URL}/api/tickets/reset...`);
  const reset = await postJson('/api/tickets/reset', {});
  assert.equal(reset.status, 200, `Reset must return HTTP 200, got ${reset.status}`);

  console.log(`[2/4] Launching ${CONCURRENT_USERS} simultaneous checkouts for concert=${TARGET_CONCERT_ID}, seat=${TARGET_SEAT}...`);
  const requests = Array.from({ length: CONCURRENT_USERS }, (_, idx) =>
    postJson('/api/tickets/buy', {
      userId: idx + 1,
      concertId: TARGET_CONCERT_ID,
      seatNumber: TARGET_SEAT,
    }).then((result) => ({ requestId: idx + 1, ...result }))
  );

  const results = await Promise.all(requests);
  const winners = results.filter((r) => r.status === 200 && r.body?.success === true);
  const conflicts = results.filter((r) => r.status === 409);
  const serverErrors = results.filter((r) => r.status >= 500 || r.status < 200);

  console.table(
    results.map((r) => ({
      Req: r.requestId,
      HTTP: r.status,
      Success: Boolean(r.body?.success),
      ServedBy: r.body?.servedBy || '-',
      Message: (r.body?.message || '').slice(0, 48),
    }))
  );

  console.log(`[3/4] Summary: 200 OK=${winners.length}, 409 Conflict=${conflicts.length}, 5xx=${serverErrors.length}`);
  assert.equal(serverErrors.length, 0, 'Must have 0 server 5xx errors under 20-way contention');
  assert.equal(winners.length, 1, `Expected exactly 1 winner for seat ${TARGET_SEAT}, got ${winners.length}`);
  assert.equal(conflicts.length, CONCURRENT_USERS - 1, `Expected ${CONCURRENT_USERS - 1} HTTP 409 rejections`);

  // Verify backend seat query agrees immediately (DB Booked or Redis Lock active)
  const seatsRes = await fetch(`${BASE_URL}/api/concerts/${TARGET_CONCERT_ID}/seats`, {
    headers: { 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(8000),
  });
  assert.equal(seatsRes.status, 200, 'Seat listing endpoint must return 200');
  const seatsJson = await seatsRes.json();
  const targetSeatState = (seatsJson.seats || []).find(
    (s) => s.seatNumber === TARGET_SEAT || s.seat_number === TARGET_SEAT
  );
  assert.ok(targetSeatState, `Seat ${TARGET_SEAT} must exist in concert ${TARGET_CONCERT_ID}`);
  assert.ok(
    targetSeatState.status === 'Booked' || targetSeatState.status === 'Locked',
    `Seat ${TARGET_SEAT} must reflect Booked/Locked after race winner, got ${targetSeatState.status}`
  );

  console.log(`[4/4] Seat ${TARGET_SEAT} state verified as "${targetSeatState.status}". Restoring clean demo quota...`);
  const cleanup = await postJson('/api/tickets/reset', {});
  assert.equal(cleanup.status, 200, 'Final cleanup reset must return HTTP 200');

  console.log('PASS: Redis Atomic Lock enforced 0% overselling (1 winner / 19 conflicts).');
}

run().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});

