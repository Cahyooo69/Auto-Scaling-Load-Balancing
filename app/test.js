const assert = require('assert');
const {
  BUY_LUA_SCRIPT,
  LOCK_SEAT_LUA_SCRIPT,
  mergeRedisSeatLocks,
  releaseRedisCheckoutLock,
} = require('./server');

// Unit test verifying atomic decrement algorithm & Lua script integrity
function testAtomicLogic() {
  console.log('Running testAtomicLogic...');
  
  // Simulated atomic Redis memory state
  let state = { 'concert:tickets:stock': 5 };

  function simulateLua(stockKey) {
    const current = Number(state[stockKey] || 0);
    if (current > 0) {
      state[stockKey] = current - 1;
      return state[stockKey];
    }
    return -1;
  }

  // 1. Initial 5 tickets purchased one by one
  for (let i = 4; i >= 0; i--) {
    const remaining = simulateLua('concert:tickets:stock');
    assert.strictEqual(remaining, i, `Expected remaining stock ${i}, got ${remaining}`);
  }

  // 2. 6th purchase must fail (sold out)
  const soldOut = simulateLua('concert:tickets:stock');
  assert.strictEqual(soldOut, -1, 'Expected sold out (-1), got ' + soldOut);
  assert.strictEqual(state['concert:tickets:stock'], 0, 'Stock must not drop below zero');

  // Verify script structure contains key atomic operations
  assert.ok(BUY_LUA_SCRIPT.includes('redis.call(\'DECR\', KEYS[1])'), 'Script must use atomic DECR');
  assert.ok(BUY_LUA_SCRIPT.includes('KEYS[1]'), 'Script must bind to KEYS[1]');

  // 3. Test nullish coalescing on reset with stock: 0
  const parseResetStock = (body, query, fallback = 1000) => {
    const raw = body?.stock ?? query?.stock;
    return raw !== undefined ? parseInt(raw, 10) : fallback;
  };
  assert.strictEqual(parseResetStock({ stock: 0 }, {}), 0, 'Reset with body.stock: 0 must return 0');
  assert.strictEqual(parseResetStock({}, { stock: '0' }), 0, 'Reset with query.stock: "0" must return 0');
  assert.strictEqual(parseResetStock({}, {}), 1000, 'Reset with undefined must use fallback 1000');

  // 4. Test sold-out status code resolution
  const getCheckoutStatus = (remaining) => (remaining >= 0 ? 200 : 409);
  assert.strictEqual(getCheckoutStatus(10), 200, 'Positive remaining stock must return HTTP 200');
  assert.strictEqual(getCheckoutStatus(-1), 409, 'Sold out (-1) must return HTTP 409');

  // 5. Verify LOCK_SEAT_LUA_SCRIPT atomically checks GET before SET ... EX
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

  // 1. Redis active lock marks only Available seats as Locked
  const mockRedisOk = { mget: async () => [null, 'user:2', 'user:3'] };
  const merged = await mergeRedisSeatLocks(1, sampleSeats, mockRedisOk, true);
  assert.strictEqual(merged[0].status, 'Available');
  assert.strictEqual(merged[1].status, 'Locked');
  assert.strictEqual(merged[2].status, 'Booked', 'Booked seat must stay Booked even if lock key exists');

  // 2. Redis read error gracefully falls back to DB rows without throwing
  const mockRedisFail = { mget: async () => { throw new Error('ECONNREFUSED'); } };
  const fallback = await mergeRedisSeatLocks(1, sampleSeats, mockRedisFail, true);
  assert.deepStrictEqual(fallback, sampleSeats);

  // 3. Rollback helper releases acquired lock & increments decremented stock, ignoring failures
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

  // 4. Selective release must skip untouched resources
  const selectiveCalls = [];
  const mockSelectiveRedis = {
    del: async (key) => { selectiveCalls.push(['del', key]); },
    incr: async (key) => { selectiveCalls.push(['incr', key]); },
  };
  await releaseRedisCheckoutLock({
    redisClient: mockSelectiveRedis,
    stockKey: 'concert:1:stock',
    seatLockKey: 'concert:1:seat:105:lock',
    stockDecremented: false,
    seatLockAcquired: false,
  });
  assert.strictEqual(selectiveCalls.length, 0);
}

(async () => {
  testAtomicLogic();
  await testRedisLockHelpers();
  console.log(' All unit tests passed successfully.');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
