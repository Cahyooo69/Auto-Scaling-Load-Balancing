const express = require('express');
const Redis = require('ioredis');
const { Pool } = require('pg');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { signJwt, verifyJwt, extractJwtFromRequest } = require('./src/utils/jwt');
const { createApiRouter } = require('./src/routes/api');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Environment configurations
const PORT = process.env.PORT || 3000;
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = parseInt(process.env.DB_PORT || '5432', 10);
const DB_NAME = process.env.DB_NAME || 'wartiket_db';
const DB_USER = process.env.DB_USER || 'wartiket';
const DB_PASSWORD = process.env.DB_PASSWORD || 'wartiket_secret';
const DB_POOL_MAX = parseInt(process.env.DB_POOL_MAX || '12', 10);

const TICKET_KEY = 'concert:tickets:stock';
const INITIAL_STOCK = parseInt(process.env.INITIAL_STOCK || '1000', 10);

const CONCERTS_CACHE_KEY = 'cache:concerts:list';
const CONCERTS_CACHE_TTL_SEC = 10;
const SEATS_CACHE_TTL_SEC = 5;
const USER_CACHE_TTL_SEC = 60;
const SESSION_TTL_SEC = 3600;

const QUEUE_MAX_ACTIVE = parseInt(process.env.QUEUE_MAX_ACTIVE || '200', 10);
const QUEUE_ACTIVE_TTL_MS = parseInt(process.env.QUEUE_ACTIVE_TTL_MS || '180000', 10);
const QUEUE_HEARTBEAT_TIMEOUT_MS = parseInt(process.env.QUEUE_HEARTBEAT_TIMEOUT_MS || '25000', 10);

// ============================================================================
// 1. REDIS ATOMIC LOCKING, DISTRIBUTED QUEUE & LUA SCRIPTING
// ============================================================================

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
    return 0 -- already locked or booked
  else
    redis.call('SET', seatKey, lockVal, 'EX', expireSec)
    return 1 -- successfully locked
  end
`;

// Atomic ownership-checked unlock Lua script: prevents deleting another user's renewed lock
const UNLOCK_SEAT_LUA_SCRIPT = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
  end
  return 0
`;

// Distributed anti-stuck queue sync: evicts expired/ghost slots & promotes FIFO waiters atomically
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

redis.defineCommand('atomicBuyTicket', {
  numberOfKeys: 1,
  lua: BUY_LUA_SCRIPT,
});

redis.defineCommand('atomicLockSeat', {
  numberOfKeys: 1,
  lua: LOCK_SEAT_LUA_SCRIPT,
});

redis.defineCommand('atomicUnlockSeat', {
  numberOfKeys: 1,
  lua: UNLOCK_SEAT_LUA_SCRIPT,
});

redis.defineCommand('queueSync', {
  numberOfKeys: 3,
  lua: QUEUE_SYNC_LUA_SCRIPT,
});

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
    // Also initialize stocks for each concert if not set
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

// ============================================================================
// 2. RELATIONAL DATABASE (POSTGRESQL CONNECTION POOL & MIGRATION)
// ============================================================================

const pool = new Pool({
  host: DB_HOST,
  port: DB_PORT,
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASSWORD,
  max: DB_POOL_MAX, // Bounded pool so 8x Swarm replicas stay within PostgreSQL max_connections
  idleTimeoutMillis: 15000,
  connectionTimeoutMillis: 8000,
  statement_timeout: 10000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

let isDbReady = false;

// Guard both idle pool and checked-out clients against TCP ECONNRESET crashes
pool.on('error', () => {
  isDbReady = false;
});
pool.on('connect', (client) => {
  if (!client._wtErrGuarded) {
    client._wtErrGuarded = true;
    client.on('error', () => {
      isDbReady = false;
    });
  }
});

async function checkDbConnection() {
  try {
    const client = await pool.connect();
    client.release();
    isDbReady = true;
    return true;
  } catch (err) {
    isDbReady = false;
    return false;
  }
}

async function initDatabaseSchema(attempt = 1) {
  try {
    const isConnected = await checkDbConnection();
    if (!isConnected) {
      console.warn(`[Database] PostgreSQL not reachable at ${DB_HOST}:${DB_PORT} (attempt ${attempt}). Retrying in 2.5s...`);
      if (attempt < 15) setTimeout(() => initDatabaseSchema(attempt + 1), 2500);
      return;
    }

    const checkTable = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'users'
      );
    `);

    if (!checkTable.rows[0].exists) {
      console.log(`[Database] Users table not found. Executing schema.sql & seed.sql...`);
      const schemaFile = path.join(__dirname, 'schema.sql');
      const seedFile = path.join(__dirname, 'seed.sql');

      if (fs.existsSync(schemaFile)) {
        await pool.query(fs.readFileSync(schemaFile, 'utf8'));
        console.log(`[Database] schema.sql executed successfully.`);
      }
      if (fs.existsSync(seedFile)) {
        await pool.query(fs.readFileSync(seedFile, 'utf8'));
        console.log(`[Database] seed.sql executed successfully.`);
      }
    } else {
      await pool.query('CREATE INDEX IF NOT EXISTS idx_users_lower_email ON users (LOWER(email))').catch(() => {});
      await pool.query("CREATE INDEX IF NOT EXISTS idx_seats_available_id ON seats (concert_id, id) WHERE status = 'Available'").catch(() => {});
      await pool.query(`
        INSERT INTO users (name, email, password, phone, id_card, role)
        VALUES
          ('Admin WarTiket', 'admin@wartiket.id', 'password123', '081100000001', '3171000000000001', 'admin'),
          ('User Penonton', 'user@wartiket.id', 'password123', '081100000002', '3171000000000002', 'user')
        ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role
      `).catch(() => {});
      await pool.query(`
        CREATE TABLE IF NOT EXISTS bookings (
          id SERIAL PRIMARY KEY,
          booking_code VARCHAR(64) UNIQUE NOT NULL,
          user_id INT REFERENCES users(id) ON DELETE SET NULL,
          concert_id INT REFERENCES concerts(id) ON DELETE SET NULL,
          total_amount NUMERIC(12,2) NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'PAID' CHECK (status IN ('PAID', 'PENDING', 'EXPIRED')),
          server_instance_id VARCHAR(100) NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS booking_details (
          id SERIAL PRIMARY KEY,
          booking_id INT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
          seat_id INT REFERENCES seats(id) ON DELETE SET NULL,
          seat_number VARCHAR(20) NOT NULL,
          category VARCHAR(30) DEFAULT 'CAT 1',
          price NUMERIC(12,2) NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_bookings_user_created ON bookings(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_booking_details_booking ON booking_details(booking_id);
      `).catch(() => {});
      console.log(`[Database] Database already initialized and verified.`);
    }
  } catch (err) {
    console.warn(`[Database] Init verification warning: ${err.message}`);
    if (attempt < 15) setTimeout(() => initDatabaseSchema(attempt + 1), 2500);
  }
}

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

async function invalidateConcertCache(concertId, redisClient = redis, redisAvailable = isRedisReady) {
  if (!redisAvailable) return;
  const keys = [CONCERTS_CACHE_KEY];
  if (concertId) keys.push(`cache:concert:${concertId}:seats`);
  await redisClient.del(...keys).catch(() => {});
}

function extractSessionToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/(?:^|;\s*)wt_session=([^;]+)/);
  if (match) return decodeURIComponent(match[1]);
  return req.query?.token ? String(req.query.token).trim() : '';
}

// Simulated real-world validation delay (30-60ms)
const artificialDelay = (min = 30, max = 60) => {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
};

// ============================================================================
// 3. API & MULTI-PAGE ROUTES
// ============================================================================

const PAGE_ROUTES = [
  { paths: ['/', '/index.html', '/konser', '/concerts.html', '/riwayat', '/kontak', '/contact.html', '/live-test', '/hasil-test'], file: 'index.html' },
];

PAGE_ROUTES.forEach(({ paths, file }) => {
  app.get(paths, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', file));
  });
});

// Sajikan ikon tab browser agar tidak memicu HTTP 404 pada /favicon.ico
app.get('/favicon.ico', (req, res) => {
  res.type('image/svg+xml');
  res.sendFile(path.join(__dirname, 'public', 'img', 'concert-fallback.svg'));
});

// Health check endpoint for Docker Swarm, Nginx, & Monitoring
app.get('/health', async (req, res) => {
  const dbOk = await checkDbConnection();
  res.status(200).json({
    status: 'UP',
    service: 'war-tiket-cloud-api',
    container: os.hostname(),
    redis: isRedisReady ? 'CONNECTED' : 'DISCONNECTED',
    database: dbOk ? 'CONNECTED' : 'DISCONNECTED',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// System info endpoint
app.get('/api/system/info', async (req, res) => {
  const dbOk = await checkDbConnection();
  res.json({
    serverInstance: os.hostname(),
    architecture: 'Docker Swarm Multi-Replica Mesh',
    platform: process.platform,
    nodeVersion: process.version,
    redis: {
      status: isRedisReady ? 'CONNECTED' : 'RECONNECTING',
      host: REDIS_HOST,
      port: REDIS_PORT,
    },
    database: {
      status: dbOk ? 'CONNECTED' : 'RECONNECTING',
      type: 'PostgreSQL 16',
      host: DB_HOST,
      name: DB_NAME,
      poolTotal: pool.totalCount,
      poolIdle: pool.idleCount,
      poolWaiting: pool.waitingCount,
    },
    timestamp: new Date().toISOString(),
  });
});

// --- AUTHENTICATION & SHARED SESSION API (TAHAP 2 LOGIN) ---
app.post(['/api/auth/login', '/api/login'], async (req, res) => {
  const { email } = req.body || {};
  if (!email) {
    return res.status(400).json({ success: false, message: 'Email wajib diisi!' });
  }

  const trimmedEmail = String(email).trim();
  const normalizedEmail = trimmedEmail.toLowerCase();
  const userCacheKey = `cache:user:email:${normalizedEmail}`;

  try {
    let user = null;

    // 1. Check Redis user lookup cache first to avoid repeated DB queries under war spikes
    if (isRedisReady) {
      try {
        const cached = await redis.get(userCacheKey);
        if (cached) user = JSON.parse(cached);
      } catch (e) {}
    }

    if (!user) {
      if (!isDbReady) await checkDbConnection();

      if (isDbReady) {
        try {
          const q = await pool.query(
            'SELECT id, name, email, phone, id_card, role FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
            [trimmedEmail]
          );
          if (q.rows.length > 0) {
            user = q.rows[0];
            if (isRedisReady) {
              redis.set(userCacheKey, JSON.stringify(user), 'EX', USER_CACHE_TTL_SEC).catch(() => {});
            }
          }
        } catch (dbErr) {
          isDbReady = false;
        }
      }
    }

    // Fallback demo users if DB is temporarily reconnecting
    if (!user) {
      const demoUsers = {
        'admin@wartiket.id': { id: 1006, name: 'Admin WarTiket', email: 'admin@wartiket.id', phone: '081100000001', id_card: '3171000000000001', role: 'admin' },
        'user@wartiket.id': { id: 1007, name: 'User Penonton', email: 'user@wartiket.id', phone: '081100000002', id_card: '3171000000000002', role: 'user' },
        'dosen@wartiket.id': { id: 1, name: 'Dr. Ir. Budi Santoso, M.Kom', email: 'dosen@wartiket.id', phone: '081122334455', id_card: '3171010101750001', role: 'lecturer' },
        'mahasiswa1@wartiket.id': { id: 2, name: 'Kelompok 1 Cloud Lead', email: 'mahasiswa1@wartiket.id', phone: '081234567890', id_card: '3171020202990002', role: 'student' },
        'mahasiswa2@wartiket.id': { id: 3, name: 'Kelompok 1 DevOps Engineer', email: 'mahasiswa2@wartiket.id', phone: '081298765432', id_card: '3171030303980003', role: 'student' },
        'vip.buyer@gmail.com': { id: 4, name: 'Siti Rahmawati (VIP Buyer)', email: 'vip.buyer@gmail.com', phone: '081345678901', id_card: '3171040404950004', role: 'vip' },
        'festival.fan@gmail.com': { id: 5, name: 'Andi Pratama (Festival Goer)', email: 'festival.fan@gmail.com', phone: '081456789012', id_card: '3171050505970005', role: 'user' },
      };

      if (demoUsers[normalizedEmail]) {
        user = demoUsers[normalizedEmail];
      } else if (normalizedEmail.startsWith('user') && normalizedEmail.endsWith('@test.com')) {
        const dummyNum = parseInt(normalizedEmail.replace('user', '').replace('@test.com', ''), 10) || 1;
        user = {
          id: dummyNum + 5,
          name: `k6 Test User ${dummyNum}`,
          email: normalizedEmail,
          phone: `081${String(dummyNum).padStart(8, '0')}`,
          id_card: `3171${String(dummyNum).padStart(12, '0')}`,
          role: 'tester'
        };
      }
    }

    if (!user) {
      return res.status(401).json({ success: false, message: 'Pengguna tidak ditemukan. Silakan gunakan Auto-Fill Demo!' });
    }

    const userPayload = {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone || '081234567890',
      idCard: user.id_card || '3171012345670001',
      role: user.role || 'user',
    };

    // Persist shared session in Redis + sign HS256 JWT across all Swarm worker nodes
    const token = crypto.randomUUID();
    const jwtToken = signJwt({
      id: userPayload.id,
      email: userPayload.email,
      role: userPayload.role,
      name: userPayload.name,
    }, SESSION_TTL_SEC);
    if (isRedisReady) {
      await redis.set(`session:${token}`, JSON.stringify(userPayload), 'EX', SESSION_TTL_SEC).catch(() => {});
    }
    res.cookie('wt_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: SESSION_TTL_SEC * 1000,
      path: '/',
    });
    res.cookie('wt_jwt', jwtToken, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: SESSION_TTL_SEC * 1000,
      path: '/',
    });

    return res.json({
      success: true,
      message: 'Login berhasil!',
      token,
      jwtToken,
      user: userPayload,
      servedBy: os.hostname(),
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Gagal login', error: err.message });
  }
});

app.get('/api/auth/session', async (req, res) => {
  const token = extractSessionToken(req);
  if (token && isRedisReady) {
    try {
      const raw = await redis.get(`session:${token}`);
      if (raw) {
        await redis.expire(`session:${token}`, SESSION_TTL_SEC).catch(() => {});
        return res.json({ authenticated: true, user: JSON.parse(raw), servedBy: os.hostname() });
      }
    } catch {}
  }

  // Fallback stateless JWT validation across replicas/restarts
  const jwtTok = extractJwtFromRequest(req);
  const decoded = jwtTok ? verifyJwt(jwtTok) : null;
  if (decoded && decoded.id) {
    return res.json({
      authenticated: true,
      user: { id: decoded.id, name: decoded.name, email: decoded.email, role: decoded.role || 'user' },
      servedBy: os.hostname(),
    });
  }

  return res.status(401).json({ authenticated: false, servedBy: os.hostname() });
});

app.post('/api/auth/logout', async (req, res) => {
  const token = extractSessionToken(req);
  if (token && isRedisReady) {
    await redis.del(`session:${token}`).catch(() => {});
  }
  res.clearCookie('wt_session', { path: '/' });
  res.clearCookie('wt_jwt', { path: '/' });
  return res.json({ success: true, servedBy: os.hostname() });
});

// --- DISTRIBUTED ANTI-STUCK QUEUE API (REDIS WAITING ROOM) ---
const QUEUE_WAIT_KEY = 'queue:waiting';
const QUEUE_ACTIVE_KEY = 'queue:active';
const QUEUE_HB_KEY = 'queue:heartbeat';
const QUEUE_SEQ_KEY = 'queue:seq';

function formatQueueState(syncResult, queueToken, ticketNumber) {
  const [status, position, totalWaiting, activeCount, remainingMs] = syncResult;
  const aheadCount = status === 'QUEUED' ? Math.max(0, Number(position) - 1) : 0;
  const estimatedWaitSec = status === 'QUEUED' ? Math.max(1, Math.ceil(aheadCount * 0.25)) : 0;
  return {
    success: status !== 'EXPIRED',
    status,
    queueToken,
    ticketNumber: Number(ticketNumber || 0),
    position: Number(position),
    aheadCount,
    totalWaiting: Number(totalWaiting),
    activeCount: Number(activeCount),
    maxActive: QUEUE_MAX_ACTIVE,
    estimatedWaitSec,
    expiresInSec: Math.ceil(Number(remainingMs || 0) / 1000),
    servedBy: os.hostname(),
  };
}

app.post('/api/queue/join', async (req, res) => {
  const userId = parseInt(req.body?.userId, 10) || 0;
  const concertId = parseInt(req.body?.concertId, 10) || 1;
  const queueToken = crypto.randomUUID();
  const nowMs = Date.now();

  if (!isRedisReady) {
    // Graceful degradation: allow direct admission if Redis queue is temporarily reconnecting
    return res.json({
      success: true,
      degraded: true,
      status: 'ADMITTED',
      queueToken,
      ticketNumber: 1,
      position: 0,
      aheadCount: 0,
      totalWaiting: 0,
      activeCount: 1,
      maxActive: QUEUE_MAX_ACTIVE,
      estimatedWaitSec: 0,
      expiresInSec: 180,
      servedBy: os.hostname(),
    });
  }

  try {
    const ticketNumber = await redis.incr(QUEUE_SEQ_KEY);
    await redis
      .multi()
      .zadd(QUEUE_WAIT_KEY, ticketNumber, queueToken)
      .zadd(QUEUE_HB_KEY, nowMs, queueToken)
      .set(`queue:meta:${queueToken}`, JSON.stringify({ userId, concertId, ticketNumber, joinedAt: nowMs }), 'EX', 600)
      .exec();

    const syncRes = await redis.queueSync(
      QUEUE_WAIT_KEY,
      QUEUE_ACTIVE_KEY,
      QUEUE_HB_KEY,
      nowMs,
      QUEUE_MAX_ACTIVE,
      QUEUE_ACTIVE_TTL_MS,
      QUEUE_HEARTBEAT_TIMEOUT_MS,
      queueToken
    );

    return res.json(formatQueueState(syncRes, queueToken, ticketNumber));
  } catch (err) {
    return res.status(503).json({ success: false, message: `Antrean sibuk: ${err.message}`, servedBy: os.hostname() });
  }
});

app.get('/api/queue/status', async (req, res) => {
  const queueToken = String(req.query.token || '').trim();
  if (!queueToken) {
    return res.status(400).json({ success: false, message: 'Token antrean wajib disertakan.', servedBy: os.hostname() });
  }
  if (!isRedisReady) {
    return res.status(503).json({ success: false, degraded: true, message: 'Redis sedang memulihkan koneksi.', servedBy: os.hostname() });
  }

  try {
    const nowMs = Date.now();
    const [syncRes, metaRaw] = await Promise.all([
      redis.queueSync(
        QUEUE_WAIT_KEY,
        QUEUE_ACTIVE_KEY,
        QUEUE_HB_KEY,
        nowMs,
        QUEUE_MAX_ACTIVE,
        QUEUE_ACTIVE_TTL_MS,
        QUEUE_HEARTBEAT_TIMEOUT_MS,
        queueToken
      ),
      redis.get(`queue:meta:${queueToken}`),
    ]);
    const meta = metaRaw ? JSON.parse(metaRaw) : {};
    const payload = formatQueueState(syncRes, queueToken, meta.ticketNumber);
    if (payload.status === 'EXPIRED') {
      return res.status(410).json({ ...payload, message: 'Sesi antrean berakhir atau kedaluwarsa. Silakan masuk antrean ulang.' });
    }
    return res.json(payload);
  } catch (err) {
    return res.status(503).json({ success: false, message: err.message, servedBy: os.hostname() });
  }
});

app.post('/api/queue/leave', async (req, res) => {
  const queueToken = String(req.body?.queueToken || req.query?.token || '').trim();
  if (queueToken && isRedisReady) {
    await redis
      .multi()
      .zrem(QUEUE_WAIT_KEY, queueToken)
      .zrem(QUEUE_ACTIVE_KEY, queueToken)
      .zrem(QUEUE_HB_KEY, queueToken)
      .del(`queue:meta:${queueToken}`)
      .exec()
      .catch(() => {});
  }
  return res.json({ success: true, servedBy: os.hostname() });
});

function getFallbackConcerts() {
  return [
    {
      id: 1,
      title: 'Coldplay - Music of the Spheres World Tour',
      artist: 'Coldplay',
      venue: 'Stadion Utama Gelora Bung Karno (GBK), Jakarta',
      concertDate: '15 Desember 2026, 19:30 WIB',
      price: 1500000,
      totalSeats: 500,
      availableSeats: 495,
      imageUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=1200&q=80',
      servedBy: os.hostname()
    },
    {
      id: 2,
      title: 'Sheila on 7 - Tunggu Aku Di Jakarta',
      artist: 'Sheila on 7',
      venue: 'JIExpo Kemayoran Open Space, Jakarta',
      concertDate: '20 Januari 2027, 20:00 WIB',
      price: 750000,
      totalSeats: 500,
      availableSeats: 497,
      imageUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1200&q=80',
      servedBy: os.hostname()
    },
    {
      id: 3,
      title: 'Taylor Swift - The Eras Tour Jakarta',
      artist: 'Taylor Swift',
      venue: 'Jakarta International Stadium (JIS), Jakarta',
      concertDate: '28 Februari 2027, 19:00 WIB',
      price: 2250000,
      totalSeats: 500,
      availableSeats: 496,
      imageUrl: 'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=1200&q=80',
      servedBy: os.hostname()
    }
  ];
}

// --- CONCERTS API (TAHAP 3 KATALOG + REDIS CACHE) ---
app.get('/api/concerts', async (req, res) => {
  try {
    if (isRedisReady) {
      try {
        const cached = await redis.get(CONCERTS_CACHE_KEY);
        if (cached) {
          const list = JSON.parse(cached).map((c) => ({ ...c, servedBy: os.hostname() }));
          res.set('X-Cache', 'HIT');
          return res.json(list);
        }
      } catch (e) {}
    }

    if (!isDbReady) await checkDbConnection();

    if (isDbReady) {
      try {
        const q = await pool.query(`
          SELECT id, title, artist, venue, concert_date, price, total_seats, available_seats, image_url
          FROM concerts
          ORDER BY id ASC
        `);
        if (q.rows.length > 0) {
          const rows = q.rows.map((c) => ({
            id: c.id,
            title: c.title,
            artist: c.artist,
            venue: c.venue,
            concertDate: c.concert_date,
            price: parseFloat(c.price),
            totalSeats: c.total_seats,
            availableSeats: c.available_seats,
            imageUrl: c.image_url,
            servedBy: os.hostname(),
          }));
          if (isRedisReady) {
            redis.set(CONCERTS_CACHE_KEY, JSON.stringify(rows), 'EX', CONCERTS_CACHE_TTL_SEC).catch(() => {});
          }
          res.set('X-Cache', 'MISS');
          return res.json(rows);
        }
      } catch (dbErr) {
        isDbReady = false;
      }
    }

    res.set('X-Cache', 'FALLBACK');
    return res.json(getFallbackConcerts());
  } catch (err) {
    return res.json(getFallbackConcerts());
  }
});

// Sinkronkan status kursi PostgreSQL dengan lock aktif di Redis agar tidak stale
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

function buildFallbackSeats(concertId) {
  const rows = ['A', 'B', 'C', 'D', 'E'];
  const fallbackSeats = [];
  let idCounter = 1;
  for (const r of rows) {
    for (let col = 1; col <= 12; col++) {
      const num = `${r}-${String(col).padStart(2, '0')}`;
      const isPreBooked = (r === 'A' && col === 3) || (r === 'B' && col === 7) || (r === 'C' && col === 5);
      fallbackSeats.push({
        id: idCounter++,
        seatNumber: num,
        category: (r === 'A' || r === 'B') ? 'VIP CAT 1' : 'REGULAR CAT 2',
        status: isPreBooked ? 'Booked' : 'Available',
        price: concertId === 1 ? 1500000 : (concertId === 2 ? 750000 : 2250000)
      });
    }
  }
  return fallbackSeats;
}

// --- SEATS API (TAHAP 4 DENAH KURSI + CACHE + LIVE LOCK MERGE) ---
app.get('/api/concerts/:id/seats', async (req, res) => {
  const concertId = parseInt(req.params.id, 10) || 1;
  const seatsCacheKey = `cache:concert:${concertId}:seats`;
  res.set('Cache-Control', 'no-store');

  try {
    let baseSeats = null;

    if (isRedisReady) {
      try {
        const cached = await redis.get(seatsCacheKey);
        if (cached) {
          baseSeats = JSON.parse(cached);
          res.set('X-Cache', 'HIT');
        }
      } catch (e) {}
    }

    if (!baseSeats) {
      if (!isDbReady) await checkDbConnection();

      if (isDbReady) {
        try {
          const q = await pool.query(`
            SELECT id, concert_id, seat_number, category, status, price
            FROM seats
            WHERE concert_id = $1 AND seat_number NOT LIKE 'FEST-%'
            ORDER BY seat_number ASC
          `, [concertId]);

          if (q.rows.length > 0) {
            baseSeats = q.rows.map((s) => ({
              id: s.id,
              seatNumber: s.seat_number,
              category: s.category,
              status: s.status,
              price: parseFloat(s.price),
            }));
            if (isRedisReady) {
              redis.set(seatsCacheKey, JSON.stringify(baseSeats), 'EX', SEATS_CACHE_TTL_SEC).catch(() => {});
            }
            res.set('X-Cache', 'MISS');
          }
        } catch (dbErr) {
          isDbReady = false;
        }
      }
    }

    if (baseSeats) {
      const syncedSeats = await mergeRedisSeatLocks(concertId, baseSeats);
      return res.json({
        concertId,
        seats: syncedSeats,
        servedBy: os.hostname(),
      });
    }

    return res.json({
      concertId,
      seats: await mergeRedisSeatLocks(concertId, buildFallbackSeats(concertId)),
      servedBy: os.hostname(),
    });
  } catch (err) {
    return res.json({
      concertId,
      seats: await mergeRedisSeatLocks(concertId, buildFallbackSeats(concertId)),
      servedBy: os.hostname(),
    });
  }
});

// Backward-compatible ticket status endpoint
app.get('/tickets', async (req, res) => {
  try {
    if (!isRedisReady) {
      return res.status(200).json({
        stock: 'Memulihkan...',
        status: 'REDIS_RECONNECTING',
        servedBy: os.hostname(),
      });
    }
    const stock = await redis.get(TICKET_KEY);
    res.json({
      stock: parseInt(stock || '0', 10),
      status: 'ONLINE',
      servedBy: os.hostname(),
    });
  } catch (err) {
    res.status(200).json({
      stock: 'Memulihkan...',
      status: 'REDIS_RECONNECTING',
      error: err.message,
      servedBy: os.hostname(),
    });
  }
});

// Bersihkan Redis stock & lock kursi secara konsisten saat transaksi gagal/rollback
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

// --- TRANSAKSI CHECKOUT / WAR TIKET (TAHAP 6 CHECKOUT) ---
// Short-lived local caches for static concert & user metadata during high-concurrency checkouts
const concertMetaCache = new Map();
const userMetaCache = new Map();

async function getCheckoutMetadata(userId, concertId) {
  const now = Date.now();
  const cachedUser = userMetaCache.get(userId);
  const hasFreshUser = cachedUser && (now - cachedUser.at) < 60000;
  const cachedConcert = concertMetaCache.get(concertId);
  const hasFreshConcert = cachedConcert && (now - cachedConcert.at) < 15000;

  const [userRes, concertRes] = await Promise.all([
    hasFreshUser
      ? Promise.resolve(null)
      : pool.query('SELECT id, name, email FROM users WHERE id = $1', [userId]),
    hasFreshConcert
      ? Promise.resolve(null)
      : pool.query('SELECT title, venue, concert_date, price FROM concerts WHERE id = $1', [concertId]),
  ]);

  let userMeta;
  if (hasFreshUser) {
    userMeta = cachedUser.data;
  } else {
    userMeta = userRes && userRes.rows.length > 0
      ? { id: userRes.rows[0].id, name: userRes.rows[0].name, email: userRes.rows[0].email }
      : { id: null, name: 'Penonton Terdaftar', email: 'user@wartiket.id' };
    if (userMetaCache.size > 2000) userMetaCache.clear();
    userMetaCache.set(userId, { at: now, data: userMeta });
  }

  let concertMeta;
  if (hasFreshConcert) {
    concertMeta = cachedConcert.data;
  } else if (concertRes && concertRes.rows.length > 0) {
    const cRow = concertRes.rows[0];
    concertMeta = {
      title: cRow.title,
      venue: cRow.venue,
      concertDate: cRow.concert_date,
      price: parseFloat(cRow.price),
    };
    concertMetaCache.set(concertId, { at: now, data: concertMeta });
  } else {
    concertMeta = { title: 'Konser Musik', venue: 'Jakarta', concertDate: '2026', price: 1500000 };
  }

  return { userMeta, concertMeta };
}

// Atomic locking via Redis Lua + Permanent ACID write to PostgreSQL
app.post(['/api/tickets/buy', '/tickets/buy'], async (req, res) => {
  const redisConcertKey = `concert:${parseInt(req.body?.concertId, 10) || 1}:stock`;
  let stockDecremented = false;
  let seatLockKey = null;
  let seatLockValue = null;
  let seatLockAcquired = false;

  try {

    const body = req.body || {};
    const userId = parseInt(body.userId, 10) || 1;
    const concertId = parseInt(body.concertId, 10) || 1;
    let seatId = body.seatId ? parseInt(body.seatId, 10) : null;
    const requestedSeatNumber = body.seatNumber ? String(body.seatNumber).trim() : null;
    const queueToken = body.queueToken ? String(body.queueToken).trim() : '';

    // Check Redis & Database resilience before locking inventory
    if (!isRedisReady) {
      return res.status(503).json({
        success: false,
        degraded: true,
        error: 'Redis Failover Active',
        message: 'Disaster Recovery: Redis sedang memulihkan koneksi.',
        servedBy: os.hostname(),
        timestamp: new Date().toISOString(),
      });
    }

    if (!isDbReady) await checkDbConnection();
    if (!isDbReady) {
      return res.status(503).json({
        success: false,
        degraded: true,
        error: 'Database Reconnecting',
        message: 'PostgreSQL sedang memulihkan koneksi. Silakan coba beberapa detik lagi.',
        servedBy: os.hostname(),
        timestamp: new Date().toISOString(),
      });
    }

    // Resolusi seatId bila pemanggil hanya mengirim seatNumber (mis. uji konkurensi E-05)
    if (!seatId && requestedSeatNumber) {
      const lookupSeat = await pool.query(
        'SELECT id FROM seats WHERE concert_id = $1 AND seat_number = $2 LIMIT 1',
        [concertId, requestedSeatNumber]
      );
      if (lookupSeat.rows.length > 0) {
        seatId = lookupSeat.rows[0].id;
      }
    }

    // Step 1: Redis Atomic Check & Lock
    const remainingStock = await redis.atomicBuyTicket(redisConcertKey);
    if (remainingStock < 0) {
      return res.status(409).json({
        success: false,
        message: 'War tiket selesai: Tiket konser ini sudah habis terjual!',
        remainingStock: 0,
        servedBy: os.hostname(),
        timestamp: new Date().toISOString(),
      });
    }
    stockDecremented = true;

    // If a specific seat is targeted, atomically lock its key in Redis with ownership token
    if (seatId) {
      seatLockKey = `concert:${concertId}:seat:${seatId}:lock`;
      seatLockValue = `${userId}:${crypto.randomUUID()}`;
      const lockAcquired = await redis.atomicLockSeat(seatLockKey, seatLockValue, 300);
      if (lockAcquired === 0) {
        await releaseRedisCheckoutLock({ stockKey: redisConcertKey, stockDecremented });
        stockDecremented = false;
        return res.status(409).json({
          success: false,
          message: 'Kursi ini sedang dalam proses pemesanan atau sudah diamankan penonton lain! Silakan pilih kursi lain.',
          servedBy: os.hostname(),
          timestamp: new Date().toISOString(),
        });
      }
      seatLockAcquired = true;
    }

    // Step 2: Single-roundtrip PostgreSQL Atomic ACID Writable CTE (locks seat + writes trx/bookings/details atomically)
    const orderId = `TRX-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const { userMeta, concertMeta } = await getCheckoutMetadata(userId, concertId);
    const dbUserId = userMeta.id;
    const buyerName = userMeta.name;
    const buyerEmail = userMeta.email;
    const concertTitle = concertMeta.title;
    const concertVenue = concertMeta.venue;
    const concertDate = concertMeta.concertDate;
    const hostInstance = os.hostname();

    const atomicResult = await pool.query(
      `WITH claimed_seat AS (
         UPDATE seats
         SET status = 'Booked', locked_by = $1::int
         WHERE id = COALESCE(
           $2::int,
           (
             SELECT id FROM seats
             WHERE concert_id = $3::int AND status = 'Available'
             ORDER BY id ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED
           )
         )
         AND concert_id = $3::int
         AND status = 'Available'
         RETURNING id, seat_number, category, price
       ),
       ins_trx AS (
         INSERT INTO transactions
           (order_id, user_id, concert_id, seat_id, seat_number, amount, status, server_instance_id)
         SELECT $4::varchar, $1::int, $3::int, id, seat_number, price, 'COMPLETED', $5::varchar
         FROM claimed_seat
       ),
       ins_booking AS (
         INSERT INTO bookings
           (booking_code, user_id, concert_id, total_amount, status, server_instance_id)
         SELECT $4::varchar, $1::int, $3::int, price, 'PAID', $5::varchar
         FROM claimed_seat
         RETURNING id
       ),
       ins_details AS (
         INSERT INTO booking_details (booking_id, seat_id, seat_number, category, price)
         SELECT b.id, s.id, s.seat_number, COALESCE(s.category, 'CAT 1'), s.price
         FROM ins_booking b CROSS JOIN claimed_seat s
       )
       SELECT id, seat_number, category, price FROM claimed_seat`,
      [dbUserId, seatId, concertId, orderId, hostInstance]
    );

    if (atomicResult.rows.length === 0) {
      await releaseRedisCheckoutLock({
        stockKey: redisConcertKey,
        seatLockKey,
        seatLockValue,
        stockDecremented,
        seatLockAcquired,
      });
      stockDecremented = false;
      seatLockAcquired = false;
      return res.status(409).json({
        success: false,
        message: 'Maaf, kursi yang dipilih baru saja diamankan oleh orang lain di Database relasional.',
        servedBy: hostInstance,
        timestamp: new Date().toISOString(),
      });
    }

    const seatRecord = atomicResult.rows[0];
    seatId = seatRecord.id;
    const bookedSeatNumber = seatRecord.seat_number || requestedSeatNumber || 'A-01';
    const ticketPrice = parseFloat(seatRecord.price || concertMeta.price);

    // Update display counter outside the critical row claim so concurrent buyers never serialize on concerts.id
    pool.query(
      'UPDATE concerts SET available_seats = GREATEST(0, LEAST(available_seats, $1)) WHERE id = $2',
      [remainingStock, concertId]
    ).catch(() => {});

    // Single pipelined Redis cleanup after ACID commit
    const pipeline = redis.pipeline();
    pipeline.del(CONCERTS_CACHE_KEY, `cache:concert:${concertId}:seats`);
    if (queueToken) {
      pipeline.zrem(QUEUE_ACTIVE_KEY, queueToken);
      pipeline.del(`queue:meta:${queueToken}`);
    }
    const postCommitTasks = [pipeline.exec().catch(() => {})];
    if (seatLockAcquired && seatLockKey) {
      postCommitTasks.push(redis.atomicUnlockSeat(seatLockKey, seatLockValue).catch(() => {}));
    }
    await Promise.all(postCommitTasks);

    // Step 3: Success Return E-Ticket
    return res.status(200).json({
      success: true,
      message: 'Tiket berhasil didapatkan!',
      orderId: orderId,
      ticket: {
        orderId: orderId,
        user: {
          id: userId,
          name: buyerName,
          email: buyerEmail,
        },
        concert: {
          id: concertId,
          title: concertTitle,
          venue: concertVenue,
          concertDate: concertDate,
        },
        seat: {
          id: seatId,
          seatNumber: bookedSeatNumber,
          price: ticketPrice,
        },
        amount: ticketPrice,
        serverInstanceId: os.hostname(),
        timestamp: new Date().toISOString(),
      },
      remainingStock: remainingStock,
      servedBy: os.hostname(),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    await releaseRedisCheckoutLock({
      stockKey: redisConcertKey,
      seatLockKey,
      seatLockValue,
      stockDecremented,
      seatLockAcquired,
    });
    return res.status(503).json({
      success: false,
      degraded: true,
      error: 'Transaction Failover',
      message: `Gangguan sementara saat memproses transaksi: ${err.message}`,
      servedBy: os.hostname(),
      timestamp: new Date().toISOString(),
    });
  }
});

// --- TRANSACTIONS LOG API ---
app.get('/api/transactions', async (req, res) => {
  try {
    if (!isDbReady) await checkDbConnection();
    if (isDbReady) {
      const q = await pool.query(`
        SELECT 
          t.order_id, t.amount, t.status, t.server_instance_id, t.seat_number, t.created_at,
          u.name as user_name, u.email as user_email,
          c.title as concert_title
        FROM transactions t
        LEFT JOIN users u ON t.user_id = u.id
        LEFT JOIN concerts c ON t.concert_id = c.id
        ORDER BY t.created_at DESC
        LIMIT 20
      `);
      return res.json({
        transactions: q.rows,
        servedBy: os.hostname()
      });
    }

    res.json({ transactions: [], servedBy: os.hostname() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- RESET STOCK & REINITIALIZE (FOR LIVE DEMO & REPEATED LOAD TEST) ---
app.post(['/api/tickets/reset', '/tickets/reset'], async (req, res) => {
  try {
    if (!isDbReady) await checkDbConnection();

    let syncedStocks = {};
    let concertQuotas = [];
    if (isDbReady) {
      const client = await pool.connect();
      let txFailed = false;
      try {
        await client.query('BEGIN');
        await client.query("UPDATE seats SET status = 'Available', locked_by = NULL");
        await client.query(`
          UPDATE seats
          SET status = 'Booked',
              locked_by = CASE concert_id WHEN 1 THEN 4 WHEN 2 THEN 5 WHEN 3 THEN 4 END
          WHERE (concert_id = 1 AND seat_number IN ('A-03', 'A-04', 'B-07', 'C-05'))
             OR (concert_id = 2 AND seat_number IN ('A-01', 'B-05', 'C-08'))
             OR (concert_id = 3 AND seat_number IN ('A-02', 'A-05', 'B-09'))
        `);
        const syncRes = await client.query(`
          UPDATE concerts c
          SET available_seats = (
            SELECT COUNT(*) FROM seats s WHERE s.concert_id = c.id AND s.status = 'Available'
          )
          RETURNING id, total_seats, available_seats
        `);
        for (const row of syncRes.rows) {
          syncedStocks[row.id] = Number(row.available_seats);
          concertQuotas.push({
            id: Number(row.id),
            totalSeats: Number(row.total_seats || 500),
            availableSeats: Number(row.available_seats || 0),
          });
        }
        concertQuotas.sort((a, b) => a.id - b.id);
        await client.query('COMMIT');
      } catch (dbErr) {
        txFailed = true;
        await client.query('ROLLBACK').catch(() => {});
        throw dbErr;
      } finally {
        client.release(txFailed);
      }
    }

    if (isRedisReady) {
      await redis.set(TICKET_KEY, INITIAL_STOCK);
      for (let cId = 1; cId <= 3; cId++) {
        await redis.set(`concert:${cId}:stock`, syncedStocks[cId] ?? 500);
      }
      await scanAndDelete('concert:*:seat:*:lock');
      await scanAndDelete('cache:*');
      await scanAndDelete('queue:meta:*');
      await redis.del(QUEUE_WAIT_KEY, QUEUE_ACTIVE_KEY, QUEUE_HB_KEY, QUEUE_SEQ_KEY).catch(() => {});
    }

    res.json({
      success: true,
      message: `Katalog tiket, denah kursi di Database, dan Redis Atomic Lock berhasil di-reset ke kondisi awal.`,
      stock: INITIAL_STOCK,
      concertStocks: syncedStocks,
      concertQuotas,
      servedBy: os.hostname(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Gagal mereset data', message: err.message, servedBy: os.hostname() });
  }
});

app.use('/api', createApiRouter({ pool, port: PORT, getDbReady: () => isDbReady, checkDbConnection }));

// Catch-all SPA fallback: direct unknown UI routes render index.html without 404 (API/missing assets return 404 JSON)
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/tickets/') || /\.[a-z0-9]{2,5}$/i.test(req.path)) {
    return res.status(404).json({ success: false, error: 'Not Found' });
  }
  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Boot server
if (require.main === module) {
  redis.connect().catch((e) => {
    console.warn(`[Redis] Connect warning: ${e.message}`);
  });

  initDatabaseSchema().catch((e) => {
    console.warn(`[Database] Boot init warning: ${e.message}`);
  });

  const httpServer = app.listen(PORT, () => {
    console.log(`War Tiket Cloud API listening on port ${PORT} [Container: ${os.hostname()}]`);
  });
  httpServer.keepAliveTimeout = 65000;
  httpServer.headersTimeout = 66000;
}

module.exports = {
  app,
  BUY_LUA_SCRIPT,
  LOCK_SEAT_LUA_SCRIPT,
  UNLOCK_SEAT_LUA_SCRIPT,
  QUEUE_SYNC_LUA_SCRIPT,
  pool,
  redis,
  mergeRedisSeatLocks,
  releaseRedisCheckoutLock,
};
