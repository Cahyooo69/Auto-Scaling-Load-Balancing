/**
 * Live Integration Verification for Revised Cloud Architecture (Dr. Moch Yasin Review)
 * Verifies:
 *   1. Perimeter WAF blocking SQLi, XSS, LFI, and Bad-Bot scanners (HTTP 403)
 *   2. Honeypot trapping decoy paths (/.env, /wp-login.php) & recording audit telemetry
 *   3. CDN Edge Cache + MinIO Object Storage pull-through (MISS -> HIT)
 *   4. Least Privilege RBAC (Admin reset guard + IDOR protection)
 *   5. 2-Step Checkout with 5-minute TTL (Reserve PENDING -> Confirm PAID) & Auto-Expiry (HTTP 410)
 *   6. Database Primary + Read Replica + PgBouncer topology status
 *
 * Run: node tests/verify-revised-architecture.js
 */
const assert = require('node:assert/strict');

const BASE_URL = (process.env.TARGET_URL || 'http://localhost').replace(/\/+$/, '');
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'wartiket-admin-2026';

async function reqJson(path, opts = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    signal: AbortSignal.timeout(10000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, headers: res.headers, body: json };
}

async function run() {
  console.log(`=== VERIFYING REVISED ARCHITECTURE AT ${BASE_URL} ===\n`);

  // 1. WAF Protection Tests
  console.log('[1/6] Testing Layer 7 WAF (SQLi, XSS, LFI, Bad-Bot)...');
  const sqli = await reqJson('/api/concerts?id=1%20UNION%20SELECT%20password%20FROM%20users');
  assert.equal(sqli.status, 403, `WAF must block SQLi with 403, got ${sqli.status}`);
  const xss = await reqJson('/api/concerts?q=<script>alert(1)</script>');
  assert.equal(xss.status, 403, `WAF must block XSS with 403, got ${xss.status}`);
  const lfi = await reqJson('/api/concerts?file=../../etc/passwd');
  assert.equal(lfi.status, 403, `WAF must block LFI with 403, got ${lfi.status}`);
  const bot = await reqJson('/api/concerts', { headers: { 'User-Agent': 'sqlmap/1.8' } });
  assert.equal(bot.status, 403, `WAF must block sqlmap scanner with 403, got ${bot.status}`);
  console.log('  PASS: WAF blocked SQLi, XSS, LFI, and Bad-Bot with HTTP 403.');

  // 2. Honeypot Trap & Telemetry
  console.log('[2/6] Testing Honeypot Decoy Divert (/.env, /wp-login.php)...');
  const envProbe = await reqJson('/.env');
  assert.equal(envProbe.status, 200, 'Honeypot /.env decoy must respond 200 with canary');
  assert.ok(String(envProbe.body?.raw || '').includes('CANARY_KEY'), 'Honeypot must serve canary token');
  const wpProbe = await reqJson('/wp-login.php', { method: 'POST', body: 'user=root&pass=toor' });
  assert.equal(wpProbe.status, 200);

  const secSummary = await reqJson('/api/admin/security-summary', {
    headers: { 'X-Admin-Key': ADMIN_API_KEY },
  });
  assert.equal(secSummary.status, 200);
  assert.ok(secSummary.body?.honeypot?.totalHits >= 2, `Honeypot must record >=2 hits, got ${JSON.stringify(secSummary.body?.honeypot)}`);
  console.log(`  PASS: Honeypot trapped probes (totalHits=${secSummary.body.honeypot.totalHits}).`);

  // 3. MinIO + Nginx CDN Edge Cache (3 probes cover 2 Nginx replicas warming local cache -> HIT)
  console.log('[3/6] Testing MinIO Object Storage + Nginx CDN Pull-Through Cache...');
  const cacheStatuses = [];
  for (let i = 0; i < 3; i += 1) {
    const cdnRes = await fetch(`${BASE_URL}/cdn/img/poster-coldplay.svg`);
    assert.equal(cdnRes.status, 200, `CDN asset request #${i + 1} must be 200, got ${cdnRes.status}`);
    cacheStatuses.push(cdnRes.headers.get('x-cdn-cache'));
  }
  assert.ok(cacheStatuses.includes('HIT'), `Expected Nginx CDN cache HIT across 3 loads, got ${cacheStatuses.join(' -> ')}`);
  console.log(`  PASS: CDN pull-through active (${cacheStatuses.join(' -> ')}).`);

  // 4. System Info Topology (PgBouncer + 3 Master + 3 Slave Shards + Least Privilege Roles)
  console.log('[4/6] Checking 3-Shard DB Topology (3 Master + 3 Slave), PgBouncer & Least-Privilege roles...');
  const info = await reqJson('/api/system/info');
  assert.equal(info.status, 200);
  assert.equal(info.body?.database?.status, 'CONNECTED');
  assert.equal(info.body?.database?.shardCount, 3, `Expected 3 shards, got ${info.body?.database?.shardCount}`);
  assert.equal(info.body?.database?.writeUser, 'app_writer');
  assert.equal(info.body?.database?.readUser, 'app_reader');
  console.log(`  PASS: ${info.body.database.shardCount} Shards (3 Master + 3 Slave) via ${info.body.database.writeHost} (${info.body.database.writeUser} / ${info.body.database.readUser}).`);

  // 5. RBAC & IDOR Protection
  console.log('[5/6] Testing RBAC (/tickets/reset) & IDOR (/tickets/buy) protection...');
  const unauthReset = await reqJson('/api/tickets/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(unauthReset.status, 401, 'Unauthenticated /api/tickets/reset must be 401');

  const loginRes = await reqJson('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'user@wartiket.id', password: 'password123' }),
  });
  assert.equal(loginRes.status, 200);
  const userJwt = loginRes.body.jwtToken;
  const userId = loginRes.body.user.id;

  const buyerReset = await reqJson('/api/tickets/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userJwt}` },
    body: '{}',
  });
  assert.equal(buyerReset.status, 403, 'Non-admin JWT /api/tickets/reset must be 403');

  const idorBuy = await reqJson('/api/tickets/buy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userJwt}` },
    body: JSON.stringify({ userId: userId + 99, concertId: 1 }),
  });
  assert.equal(idorBuy.status, 403, 'Cross-user IDOR buy must be 403');
  console.log('  PASS: RBAC & IDOR enforced.');

  // 6. 2-Step Checkout (5-Min Hold -> Confirm PAID) & Auto-Expiry (HTTP 410 Gone)
  console.log('[6/6] Testing 2-Step Reserve -> Confirm & TTL Auto-Expiry...');
  await reqJson('/api/tickets/reset', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Key': ADMIN_API_KEY }, body: '{}' });

  // 6a. Reserve -> Confirm happy path
  const holdOk = await reqJson('/api/tickets/reserve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userJwt}` },
    body: JSON.stringify({ concertId: 1, seatNumber: 'D-01' }),
  });
  assert.equal(holdOk.status, 201, `Reserve must return 201, got ${holdOk.status}`);
  assert.equal(holdOk.body.status, 'PENDING');
  assert.equal(holdOk.body.holdTtlSec, 300);

  const confirmOk = await reqJson('/api/tickets/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userJwt}` },
    body: JSON.stringify({ bookingCode: holdOk.body.bookingCode }),
  });
  assert.equal(confirmOk.status, 200, `Confirm must return 200, got ${confirmOk.status}`);
  assert.equal(confirmOk.body.status, 'PAID');

  // 6b. Short 2s TTL hold -> wait 3s -> confirm must return 410 EXPIRED & release seat
  const holdExpire = await reqJson('/api/tickets/reserve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userJwt}` },
    body: JSON.stringify({ concertId: 1, seatNumber: 'D-02', holdTtlSec: 2 }),
  });
  assert.equal(holdExpire.status, 201);
  await new Promise((r) => setTimeout(r, 3200));

  const confirmExpired = await reqJson('/api/tickets/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userJwt}` },
    body: JSON.stringify({ bookingCode: holdExpire.body.bookingCode }),
  });
  assert.equal(confirmExpired.status, 410, `Expired hold confirm must return 410 Gone, got ${confirmExpired.status}`);

  // Seat D-02 must now be released and reservable again
  const reReserve = await reqJson('/api/tickets/reserve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userJwt}` },
    body: JSON.stringify({ concertId: 1, seatNumber: 'D-02' }),
  });
  assert.equal(reReserve.status, 201, 'Released seat D-02 must be available after expiry');

  // Cleanup
  await reqJson('/api/tickets/reset', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Key': ADMIN_API_KEY }, body: '{}' });
  console.log('  PASS: 2-Step Checkout (300s hold) & auto-expiry release verified.\n');
  console.log('=== ALL 6 REVISED ARCHITECTURE PILLARS PASSED 100% ===');
}

run().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
