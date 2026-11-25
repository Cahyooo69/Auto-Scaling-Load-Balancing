const assert = require('assert');
const { EventEmitter } = require('events');
const {
  BUY_LUA_SCRIPT,
  LOCK_SEAT_LUA_SCRIPT,
  UNLOCK_SEAT_LUA_SCRIPT,
  QUEUE_SYNC_LUA_SCRIPT,
  mergeRedisSeatLocks,
  releaseRedisCheckoutLock,
} = require('./server');
const { signJwt, verifyJwt, requireAdminOrKey, ADMIN_API_KEY } = require('./src/utils/jwt');
const { createTicketController, resolveBuyerId } = require('./src/controllers/ticketController');
const { getShardId, parseShardIdFromCode, queryShardRead, shards } = require('./src/config/db');
const { createHoneypotState } = require('../honeypot/server');

// Unit test verifying atomic decrement algorithm & Lua script integrity
function testAtomicLogic() {
  console.log('Running testAtomicLogic...');

  let state = { 'concert:tickets:stock': 5 };

  function simulateLua(stockKey) {
    const current = Number(state[stockKey] || 0);
    if (current > 0) {
      state[stockKey] = current - 1;
      return state[stockKey];
    }
    return -1;
  }

  for (let i = 4; i >= 0; i--) {
    const remaining = simulateLua('concert:tickets:stock');
    assert.strictEqual(remaining, i, `Expected remaining stock ${i}, got ${remaining}`);
  }

  const soldOut = simulateLua('concert:tickets:stock');
  assert.strictEqual(soldOut, -1, 'Expected sold out (-1), got ' + soldOut);
  assert.strictEqual(state['concert:tickets:stock'], 0, 'Stock must not drop below zero');

  assert.ok(BUY_LUA_SCRIPT.includes("redis.call('DECR', KEYS[1])"), 'Script must use atomic DECR');
  assert.ok(BUY_LUA_SCRIPT.includes('KEYS[1]'), 'Script must bind to KEYS[1]');

  const parseResetStock = (body, query, fallback = 1000) => {
    const raw = body?.stock ?? query?.stock;
    return raw !== undefined ? parseInt(raw, 10) : fallback;
  };
  assert.strictEqual(parseResetStock({ stock: 0 }, {}), 0);
  assert.strictEqual(parseResetStock({}, { stock: '0' }), 0);
  assert.strictEqual(parseResetStock({}, {}), 1000);

  assert(
    typeof LOCK_SEAT_LUA_SCRIPT === 'string' &&
      LOCK_SEAT_LUA_SCRIPT.includes("redis.call('GET', seatKey)") &&
      LOCK_SEAT_LUA_SCRIPT.includes("'EX'"),
    'LOCK_SEAT_LUA_SCRIPT must check seatKey atomically before SET with EX TTL'
  );
}

async function testRedisLockHelpers() {
  console.log('Running testRedisLockHelpers...');

  const sampleSeats = [
    { id: 101, seat_number: 'A-01', status: 'Available' },
    { id: 102, seat_number: 'A-02', status: 'Available' },
    { id: 103, seat_number: 'A-03', status: 'Booked' },
  ];

  const mockRedisOk = { mget: async () => [null, 'user:2', 'user:3'] };
  const merged = await mergeRedisSeatLocks(1, sampleSeats, mockRedisOk, true);
  assert.strictEqual(merged[0].status, 'Available');
  assert.strictEqual(merged[1].status, 'Locked');
  assert.strictEqual(merged[2].status, 'Booked');

  const mockRedisFail = { mget: async () => { throw new Error('ECONNREFUSED'); } };
  const fallback = await mergeRedisSeatLocks(1, sampleSeats, mockRedisFail, true);
  assert.deepStrictEqual(fallback, sampleSeats);

  const calls = [];
  const mockRollbackRedis = {
    del: async (key) => { calls.push(['del', key]); return 1; },
    incr: async (key) => { calls.push(['incr', key]); return 1; },
  };
  await releaseRedisCheckoutLock({
    redisClient: mockRollbackRedis,
    stockKey: 'concert:1:stock',
    seatLockKey: 'concert:1:seat:105:lock',
    stockDecremented: true,
    seatLockAcquired: true,
  });
  assert.deepStrictEqual(calls, [
    ['del', 'concert:1:seat:105:lock'],
    ['incr', 'concert:1:stock'],
  ]);

  const unlockCalls = [];
  const mockUnlockRedis = {
    atomicUnlockSeat: async (key, val) => { unlockCalls.push(['atomicUnlockSeat', key, val]); return 1; },
    del: async (key) => { unlockCalls.push(['del', key]); return 1; },
    incr: async (key) => { unlockCalls.push(['incr', key]); return 1; },
  };
  await releaseRedisCheckoutLock({
    redisClient: mockUnlockRedis,
    stockKey: 'concert:1:stock',
    seatLockKey: 'concert:1:seat:105:lock',
    seatLockValue: '4:tok-1',
    stockDecremented: true,
    seatLockAcquired: true,
  });
  assert.deepStrictEqual(unlockCalls, [
    ['atomicUnlockSeat', 'concert:1:seat:105:lock', '4:tok-1'],
    ['incr', 'concert:1:stock'],
  ]);

  assert(UNLOCK_SEAT_LUA_SCRIPT.includes("redis.call('GET', KEYS[1]) == ARGV[1]"));
  assert(QUEUE_SYNC_LUA_SCRIPT.includes('ZPOPMIN') && QUEUE_SYNC_LUA_SCRIPT.includes('ADMITTED'));
}

function testJwtAndRbacHelpers() {
  console.log('Running testJwtAndRbacHelpers...');
  const tok = signJwt({ id: 7, email: 'user@wartiket.id', role: 'user' }, 60);
  const decoded = verifyJwt(tok);
  assert.strictEqual(decoded.id, 7);
  assert.strictEqual(verifyJwt(`${tok}tamper`), null);
  assert.strictEqual(verifyJwt(signJwt({ id: 7 }, -10)), null);

  // RBAC: requireAdminOrKey
  function runMiddleware(headers) {
    let status = 200;
    let passed = false;
    const req = { headers };
    const res = { status(c) { status = c; return this; }, json() { return this; } };
    requireAdminOrKey(req, res, () => { passed = true; });
    return { status, passed };
  }
  assert.deepStrictEqual(runMiddleware({}), { status: 401, passed: false }, 'Unauthenticated admin call must be 401');
  assert.deepStrictEqual(runMiddleware({ authorization: `Bearer ${tok}` }), { status: 403, passed: false }, 'Buyer role must be 403');
  const adminTok = signJwt({ id: 1006, email: 'admin@wartiket.id', role: 'admin' }, 60);
  assert.deepStrictEqual(runMiddleware({ authorization: `Bearer ${adminTok}` }), { status: 200, passed: true });
  assert.deepStrictEqual(runMiddleware({ 'x-admin-key': ADMIN_API_KEY }), { status: 200, passed: true });

  // IDOR guard on resolveBuyerId
  assert.strictEqual(resolveBuyerId({ authUser: { id: 7, role: 'user' }, body: { userId: 99 } }).status, 403);
  assert.strictEqual(resolveBuyerId({ authUser: { id: 7, role: 'user' }, body: { userId: 7 } }).userId, 7);
  assert.strictEqual(resolveBuyerId({ authUser: { id: 1, role: 'admin' }, body: { userId: 99 } }).userId, 1);
}

async function testAuthPasswordCheck() {
  console.log('Running testAuthPasswordCheck...');
  const { createAuthController } = require('./src/controllers/authController');
  const authController = createAuthController({
    pool: null,
    redis: null,
    getDbReady: () => false,
    checkDbConnection: async () => false,
    getRedisReady: () => false,
  });

  let resStatus = 0;
  let resJson = null;
  const mockRes = {
    status(code) { resStatus = code; return this; },
    json(data) { resJson = data; return this; },
    cookie() {},
  };

  await authController.login({ body: { email: 'admin@wartiket.id', password: 'wrongpassword' } }, mockRes);
  assert.strictEqual(resStatus, 401);
  assert.ok(resJson?.message?.includes('Kata sandi salah'));

  resStatus = 0;
  resJson = null;
  await authController.login({ body: { email: 'admin@wartiket.id' } }, mockRes);
  assert.strictEqual(resStatus, 401, 'Missing password must not bypass authentication');

  resStatus = 0;
  resJson = null;
  await authController.login({ body: { email: 'admin@wartiket.id', password: 'password123' } }, mockRes);
  assert.strictEqual(resStatus, 0);
  assert.strictEqual(resJson?.success, true);
}

async function testTwoStepHoldAndExpiry() {
  console.log('Running testTwoStepHoldAndExpiry...');
  const redisOps = [];
  const mockRedis = {
    atomicBuyTicket: async () => 499,
    atomicLockSeat: async () => 1,
    atomicUnlockSeat: async () => 1,
    del: async (k) => { redisOps.push(['del', k]); return 1; },
    incr: async (k) => { redisOps.push(['incr', k]); return 1; },
    pipeline() {
      const cmds = [];
      return {
        incr: (k) => cmds.push(['incr', k]),
        del: (...ks) => cmds.push(['del', ...ks]),
        zrem: () => {},
        exec: async () => { redisOps.push(...cmds); return []; },
      };
    },
  };

  let queryStep = 0;
  const mockPool = {
    query: async (sql, params) => {
      queryStep += 1;
      // 1st query: expireStaleBookings returns 1 expired hold
      if (sql.includes('WITH stale AS')) {
        return { rows: queryStep === 1 ? [{ concert_id: 1, seat_id: 42 }] : [] };
      }
      // Reserve CTE
      if (sql.includes("SET status = 'Locked'")) {
        return {
          rows: [{ id: 10, seat_number: 'A-10', category: 'VIP CAT 1', price: '1500000', booking_code: 'HOLD-TEST-1', expires_at: new Date(Date.now() + 300000).toISOString() }],
        };
      }
      // Confirm CTE: happy path for HOLD-S1-PAID, expired path otherwise
      if (sql.includes("SET status = 'PAID'")) {
        if (params?.[0] === 'HOLD-S1-PAID') {
          return { rows: [{ concert_id: 1, seat_id: 10, seat_number: 'A-10', price: '1500000' }] };
        }
        return { rows: [] };
      }
      if (sql.includes('SELECT status, expires_at FROM bookings')) {
        return { rows: [{ status: 'EXPIRED', expires_at: new Date(Date.now() - 1000).toISOString() }] };
      }
      return { rows: [] };
    },
  };

  const controller = createTicketController({
    pool: mockPool,
    queryRead: mockPool.query,
    redis: mockRedis,
    getDbReady: () => true,
    checkDbConnection: async () => true,
    getRedisReady: () => true,
  });

  // 1. Expired sweeper restores Redis stock & removes lock
  const expiredCount = await controller.expireStaleBookings();
  assert.strictEqual(expiredCount, 1);
  assert.ok(redisOps.some((op) => op[0] === 'incr' && op[1] === 'concert:1:stock'), 'Expired booking must restore Redis stock');
  assert.ok(redisOps.some((op) => op[0] === 'del' && op[1] === 'concert:1:seat:42:lock'), 'Expired booking must clear seat lock');

  // 2. Reserve seat returns 201 PENDING with TTL
  let st = 0;
  let payload = null;
  const mkRes = () => ({ status(c) { st = c; return this; }, json(d) { payload = d; return this; } });
  await controller.reserveTicket({ authUser: { id: 7 }, body: { concertId: 1, holdTtlSec: 300 } }, mkRes());
  assert.strictEqual(st, 201);
  assert.strictEqual(payload.status, 'PENDING');
  assert.strictEqual(payload.holdTtlSec, 300);

  // 3. Confirming an active hold returns 200 PAID & clears Redis seat lock/cache
  st = 0;
  payload = null;
  await controller.confirmBooking({ authUser: { id: 7 }, body: { bookingCode: 'HOLD-S1-PAID' } }, mkRes());
  assert.strictEqual(st, 200, 'Active reservation confirmation must return HTTP 200');
  assert.strictEqual(payload.status, 'PAID');
  assert.strictEqual(payload.ticket.orderId, 'HOLD-S1-PAID');
  assert.ok(redisOps.some((op) => op[0] === 'del' && op.includes('concert:1:seat:10:lock')), 'Paid booking must clear Redis seat lock');

  // 4. Confirming an expired hold returns 410 Gone
  st = 0;
  payload = null;
  await controller.confirmBooking({ authUser: { id: 7 }, body: { bookingCode: 'HOLD-EXPIRED' } }, mkRes());
  assert.strictEqual(st, 410, 'Expired reservation confirmation must return HTTP 410 Gone');
  assert.strictEqual(payload.status, 'EXPIRED');
}

async function testQueryShardReadFallback() {
  console.log('Running testQueryShardReadFallback...');
  const shard = shards[1];
  const orig = { hasReplica: shard.hasReplica, readPool: shard.readPool, writePool: shard.writePool, readReady: shard.readReady };
  let primaryCalled = false;
  try {
    shard.hasReplica = true;
    shard.readReady = true;
    shard.readPool = { query: async () => { throw new Error('ECONNREFUSED replica'); } };
    shard.writePool = { query: async (sql) => { primaryCalled = true; return { rows: [{ sql }] }; } };

    const res = await queryShardRead(1, 'SELECT 1');
    assert.strictEqual(primaryCalled, true, 'queryShardRead must fall back to Primary when Replica fails');
    assert.strictEqual(shard.readReady, false, 'Failed Replica must mark shard.readReady = false');
    assert.strictEqual(res.rows[0].sql, 'SELECT 1');
  } finally {
    Object.assign(shard, orig);
  }
}

async function testHoneypotTrap() {
  console.log('Running testHoneypotTrap...');
  const { handler, getStats } = createHoneypotState();

  function invoke(method, url, body = '') {
    return new Promise((resolve) => {
      const req = new EventEmitter();
      req.method = method;
      req.url = url;
      req.headers = { 'x-real-ip': '203.0.113.55', 'user-agent': 'sqlmap/1.8' };
      let code = 0;
      let headers = {};
      let out = '';
      const res = {
        writeHead(c, h) { code = c; headers = h; },
        end(d = '') { out = d; resolve({ code, headers, body: out }); },
      };
      handler(req, res);
      if (body) req.emit('data', Buffer.from(body));
      req.emit('end');
    });
  }

  const envTrap = await invoke('GET', '/.env');
  assert.strictEqual(envTrap.code, 200);
  assert.ok(envTrap.body.includes('CANARY_KEY'), '.env honeypot must serve canary token');

  const wpTrap = await invoke('POST', '/wp-login.php', 'user=admin&pass=1234');
  assert.strictEqual(wpTrap.code, 200);
  assert.strictEqual(getStats().totalHits, 2);

  const metrics = await invoke('GET', '/metrics');
  assert.ok(metrics.body.includes('wartiket_honeypot_hits_total{path="ALL",method="ALL"} 2'));
}

function testShardRouting() {
  console.log('Running testShardRouting...');
  assert.strictEqual(getShardId(1, 3), 1, 'Concert 1 must map to Shard 1');
  assert.strictEqual(getShardId(2, 3), 2, 'Concert 2 must map to Shard 2');
  assert.strictEqual(getShardId(3, 3), 3, 'Concert 3 must map to Shard 3');
  assert.strictEqual(getShardId(4, 3), 1, 'Concert 4 must wrap cleanly to Shard 1');
  assert.strictEqual(parseShardIdFromCode('HOLD-S2-ABC123', 3), 2);
  assert.strictEqual(parseShardIdFromCode('TRX-S3-XYZ', 3), 3);
  assert.strictEqual(parseShardIdFromCode('TRX-LEGACY-1', 3), null);
}

(async () => {
  testAtomicLogic();
  testShardRouting();
  testJwtAndRbacHelpers();
  await testRedisLockHelpers();
  await testAuthPasswordCheck();
  await testTwoStepHoldAndExpiry();
  await testQueryShardReadFallback();
  await testHoneypotTrap();
  console.log('All unit tests passed successfully.');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
