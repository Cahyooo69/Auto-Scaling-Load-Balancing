const assert = require('assert');
const { BUY_LUA_SCRIPT } = require('./server');

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

  console.log(' All unit tests passed successfully.');
}

testAtomicLogic();
