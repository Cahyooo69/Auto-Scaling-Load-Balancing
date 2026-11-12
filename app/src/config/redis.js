const Redis = require('ioredis');

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const TICKET_KEY = 'concert:tickets:stock';
const INITIAL_STOCK = parseInt(process.env.INITIAL_STOCK || '1000', 10);

const CONCERTS_CACHE_KEY = 'cache:concerts:list';

// Atomic decrement Lua script: checks stock and decrements atomically
const BUY_LUA_SCRIPT = `
  local current = tonumber(redis.call('GET', KEYS[1]) or '0')
  if current > 0 then
    redis.call('DECR', KEYS[1])
    return current - 1
  else
    return -1
  end
`;

// Atomic seat locking Lua script: atomically claims a specific seat key
const LOCK_SEAT_LUA_SCRIPT = `
  local seatKey = KEYS[1]
  local lockVal = ARGV[1]
  local expireSec = tonumber(ARGV[2] or '300')

  local exists = redis.call('GET', seatKey)
  if exists then
    return 0
  else
    redis.call('SET', seatKey, lockVal, 'EX', expireSec)
    return 1
  end
`;

// Atomic ownership-checked unlock Lua script
const UNLOCK_SEAT_LUA_SCRIPT = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
  end
  return 0
`;

// Distributed anti-stuck queue sync: evicts expired/ghost slots & promotes FIFO waiters
const QUEUE_SYNC_LUA_SCRIPT = `
  local waitKey = KEYS[1]
  local activeKey = KEYS[2]
  local hbKey = KEYS[3]
  local nowMs = tonumber(ARGV[1])
  local maxActive = tonumber(ARGV[2])
  local activeTtlMs = tonumber(ARGV[3])
  local hbTimeoutMs = tonumber(ARGV[4])
  local token = ARGV[5] or ''

  redis.call('ZREMRANGEBYSCORE', activeKey, '-inf', nowMs)

  local staleWaiters = redis.call('ZRANGEBYSCORE', hbKey, '-inf', nowMs - hbTimeoutMs)
  for i = 1, #staleWaiters do
    redis.call('ZREM', waitKey, staleWaiters[i])
    redis.call('ZREM', hbKey, staleWaiters[i])
  end

  local activeCount = redis.call('ZCARD', activeKey)
  local freeSlots = maxActive - activeCount
  if freeSlots > 0 then
    local promoted = redis.call('ZPOPMIN', waitKey, freeSlots)
    for i = 1, #promoted, 2 do
      local tok = promoted[i]
      redis.call('ZREM', hbKey, tok)
      redis.call('ZADD', activeKey, nowMs + activeTtlMs, tok)
    end
  end

  local totalWaiting = redis.call('ZCARD', waitKey)
  activeCount = redis.call('ZCARD', activeKey)

  if token == '' then
    return { 'SYNCED', 0, totalWaiting, activeCount, 0 }
  end

  local activeExp = redis.call('ZSCORE', activeKey, token)
  if activeExp then
    return { 'ADMITTED', 0, totalWaiting, activeCount, math.max(0, tonumber(activeExp) - nowMs) }
  end

  local rank = redis.call('ZRANK', waitKey, token)
  if rank then
    redis.call('ZADD', hbKey, nowMs, token)
    return { 'QUEUED', rank + 1, totalWaiting, activeCount, 0 }
  end

  return { 'EXPIRED', -1, totalWaiting, activeCount, 0 }
`;

let isRedisReady = false;

const redis = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  maxRetriesPerRequest: 2,
  enableOfflineQueue: false,
  connectTimeout: 4000,
  commandTimeout: 5000,
  retryStrategy: (times) => Math.min(times * 100, 2000),
  lazyConnect: true,
});

redis.defineCommand('atomicBuyTicket', { numberOfKeys: 1, lua: BUY_LUA_SCRIPT });
redis.defineCommand('atomicLockSeat', { numberOfKeys: 1, lua: LOCK_SEAT_LUA_SCRIPT });
redis.defineCommand('atomicUnlockSeat', { numberOfKeys: 1, lua: UNLOCK_SEAT_LUA_SCRIPT });
redis.defineCommand('queueSync', { numberOfKeys: 3, lua: QUEUE_SYNC_LUA_SCRIPT });

redis.on('connect', () => {
  console.log(`[Redis] Connecting to ${REDIS_HOST}:${REDIS_PORT}...`);
});

redis.on('ready', async () => {
  isRedisReady = true;
  console.log(`[Redis] Connection ready. Ensuring initial ticket stocks...`);
  try {
    const res = await redis.set(TICKET_KEY, INITIAL_STOCK, 'NX');
    if (res === 'OK') {
      console.log(`[Redis] Initialized total ticket stock to ${INITIAL_STOCK}`);
    }
    for (let cId = 1; cId <= 3; cId++) {
      await redis.set(`concert:${cId}:stock`, 500, 'NX');
    }
  } catch (err) {
    console.warn(`[Redis] Stock sync warning: ${err.message}`);
  }
});

redis.on('close', () => {
  isRedisReady = false;
  console.warn(`[Redis] Connection closed. Auto-reconnecting in background...`);
});

redis.on('error', () => {
  isRedisReady = false;
});

async function scanAndDelete(pattern, redisClient = redis) {
  let cursor = '0';
  let deleted = 0;
  do {
    const [nextCursor, keys] = await redisClient.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
    cursor = nextCursor;
    if (keys.length > 0) {
      await redisClient.del(...keys);
      deleted += keys.length;
    }
  } while (cursor !== '0');
  return deleted;
}

async function mergeRedisSeatLocks(concertId, seats, redisClient = redis, redisAvailable = isRedisReady) {
  if (!redisAvailable || !Array.isArray(seats) || seats.length === 0) return seats;
  try {
    const keys = seats.map((s) => `concert:${concertId}:seat:${s.id}:lock`);
    const lockVals = await redisClient.mget(...keys);
    return seats.map((s, idx) => (s.status === 'Available' && lockVals[idx] ? { ...s, status: 'Locked' } : s));
  } catch (e) {
    return seats;
  }
}

async function releaseRedisCheckoutLock({
  redisClient = redis,
  stockKey,
  seatLockKey,
  seatLockValue,
  stockDecremented,
  seatLockAcquired,
}) {
  if (seatLockAcquired && seatLockKey) {
    if (seatLockValue && typeof redisClient.atomicUnlockSeat === 'function') {
      await redisClient.atomicUnlockSeat(seatLockKey, seatLockValue).catch(() => {});
    } else {
      await redisClient.del(seatLockKey).catch(() => {});
    }
  }
  if (stockDecremented && stockKey) {
    await redisClient.incr(stockKey).catch(() => {});
  }
}

module.exports = {
  redis,
  getIsRedisReady: () => isRedisReady,
  REDIS_HOST,
  REDIS_PORT,
  TICKET_KEY,
  INITIAL_STOCK,
  CONCERTS_CACHE_KEY,
  BUY_LUA_SCRIPT,
  LOCK_SEAT_LUA_SCRIPT,
  UNLOCK_SEAT_LUA_SCRIPT,
  QUEUE_SYNC_LUA_SCRIPT,
  scanAndDelete,
  mergeRedisSeatLocks,
  releaseRedisCheckoutLock,
};

