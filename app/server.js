const express = require('express');
const Redis = require('ioredis');
const { Pool } = require('pg');
const os = require('os');
const path = require('path');
const fs = require('fs');

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

const TICKET_KEY = 'concert:tickets:stock';
const INITIAL_STOCK = parseInt(process.env.INITIAL_STOCK || '1000', 10);

// ============================================================================
// 1. REDIS ATOMIC LOCKING & LUA SCRIPTING
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

let isRedisReady = false;

const redis = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  connectTimeout: 3000,
  commandTimeout: 2000,
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
  max: 30, // Optimized connection pool limit for high-concurrency Swarm nodes
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 3000,
  statement_timeout: 5000,
});

let isDbReady = false;

// Reset status DB bila koneksi idle pool ditutup tiba-tiba oleh PostgreSQL
pool.on('error', () => {
  isDbReady = false;
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

async function initDatabaseSchema() {
  try {
    const isConnected = await checkDbConnection();
    if (!isConnected) {
      console.warn(`[Database] PostgreSQL not immediately reachable at ${DB_HOST}:${DB_PORT}. Will auto-retry.`);
      return;
    }

    // Verify if users table exists
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
        const schemaSql = fs.readFileSync(schemaFile, 'utf8');
        await pool.query(schemaSql);
        console.log(`[Database] schema.sql executed successfully.`);
      }
      if (fs.existsSync(seedFile)) {
        const seedSql = fs.readFileSync(seedFile, 'utf8');
        await pool.query(seedSql);
        console.log(`[Database] seed.sql executed successfully.`);
      }
    } else {
      console.log(`[Database] Database already initialized and verified.`);
    }
  } catch (err) {
    console.warn(`[Database] Init verification warning: ${err.message}`);
  }
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
  { paths: ['/', '/index.html'], file: 'index.html' },
  { paths: ['/konser', '/concerts.html'], file: 'concerts.html' },
  { paths: ['/cara-war', '/guide.html'], file: 'guide.html' },
  { paths: ['/kontak', '/contact.html'], file: 'contact.html' },
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

// --- AUTHENTICATION API (TAHAP 2 LOGIN) ---
app.post(['/api/auth/login', '/api/login'], async (req, res) => {
  const { email } = req.body || {};
  if (!email) {
    return res.status(400).json({ success: false, message: 'Email wajib diisi!' });
  }

  try {
    if (!isDbReady) {
      await checkDbConnection();
    }

    let user;
    if (isDbReady) {
      try {
        const q = await pool.query(
          'SELECT id, name, email, phone, id_card, role FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
          [String(email).trim()]
        );
        if (q.rows.length > 0) {
          user = q.rows[0];
        }
      } catch (dbErr) {
        // Koneksi idle pool mungkin baru terputus; jatuh ke fallback demo users
        isDbReady = false;
      }
    }

    // Fallback demo users if DB is temporarily reconnecting
    if (!user) {
      const normalizedEmail = String(email).trim().toLowerCase();
      const demoUsers = {
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

    return res.json({
      success: true,
      message: 'Login berhasil!',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone || '081234567890',
        idCard: user.id_card || '3171012345670001',
        role: user.role || 'user'
      },
      servedBy: os.hostname(),
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Gagal login', error: err.message });
  }
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

// --- CONCERTS API (TAHAP 3 KATALOG) ---
app.get('/api/concerts', async (req, res) => {
  try {
    if (!isDbReady) await checkDbConnection();

    if (isDbReady) {
      try {
        const q = await pool.query(`
          SELECT id, title, artist, venue, concert_date, price, total_seats, available_seats, image_url
          FROM concerts
          ORDER BY id ASC
        `);
        if (q.rows.length > 0) {
          return res.json(q.rows.map(c => ({
            id: c.id,
            title: c.title,
            artist: c.artist,
            venue: c.venue,
            concertDate: c.concert_date,
            price: parseFloat(c.price),
            totalSeats: c.total_seats,
            availableSeats: c.available_seats,
            imageUrl: c.image_url,
            servedBy: os.hostname()
          })));
        }
      } catch (dbErr) {
        isDbReady = false;
      }
    }

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

// --- SEATS API (TAHAP 4 DENAH KURSI) ---
app.get('/api/concerts/:id/seats', async (req, res) => {
  const concertId = parseInt(req.params.id, 10) || 1;
  res.set('Cache-Control', 'no-store');

  try {
    if (!isDbReady) await checkDbConnection();

    if (isDbReady) {
      try {
        // Fetch the 60 visual grid seats (baris A-E)
        const q = await pool.query(`
          SELECT id, concert_id, seat_number, category, status, price
          FROM seats
          WHERE concert_id = $1 AND seat_number NOT LIKE 'FEST-%'
          ORDER BY seat_number ASC
        `, [concertId]);

        if (q.rows.length > 0) {
          const dbSeats = q.rows.map(s => ({
            id: s.id,
            seatNumber: s.seat_number,
            category: s.category,
            status: s.status,
            price: parseFloat(s.price)
          }));
          const syncedSeats = await mergeRedisSeatLocks(concertId, dbSeats);
          return res.json({
            concertId,
            seats: syncedSeats,
            servedBy: os.hostname()
          });
        }
      } catch (dbErr) {
        isDbReady = false;
      }
    }

    return res.json({
      concertId,
      seats: await mergeRedisSeatLocks(concertId, buildFallbackSeats(concertId)),
      servedBy: os.hostname()
    });
  } catch (err) {
    return res.json({
      concertId,
      seats: await mergeRedisSeatLocks(concertId, buildFallbackSeats(concertId)),
      servedBy: os.hostname()
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
  stockDecremented,
  seatLockAcquired,
}) {
  if (seatLockAcquired && seatLockKey) {
    await redisClient.del(seatLockKey).catch(() => {});
  }
  if (stockDecremented && stockKey) {
    await redisClient.incr(stockKey).catch(() => {});
  }
}

// --- TRANSAKSI CHECKOUT / WAR TIKET (TAHAP 6 CHECKOUT) ---
// Atomic locking via Redis Lua + Permanent ACID write to PostgreSQL
app.post(['/api/tickets/buy', '/tickets/buy'], async (req, res) => {
  const redisConcertKey = `concert:${parseInt(req.body?.concertId, 10) || 1}:stock`;
  let stockDecremented = false;
  let seatLockKey = null;
  let seatLockAcquired = false;

  try {
    await artificialDelay(20, 50);

    const body = req.body || {};
    const userId = parseInt(body.userId, 10) || 1;
    const concertId = parseInt(body.concertId, 10) || 1;
    let seatId = body.seatId ? parseInt(body.seatId, 10) : null;
    const requestedSeatNumber = body.seatNumber ? String(body.seatNumber).trim() : null;

    // Check Redis resilience
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

    // Resolusi seatId bila pemanggil hanya mengirim seatNumber (mis. uji konkurensi E-05)
    if (!seatId && requestedSeatNumber && isDbReady) {
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

    // If a specific seat is targeted, atomically lock its key in Redis
    if (seatId) {
      seatLockKey = `concert:${concertId}:seat:${seatId}:lock`;
      const lockAcquired = await redis.atomicLockSeat(seatLockKey, String(userId), 300);
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

    // Step 2: PostgreSQL Permanent ACID Transaction
    const orderId = `TRX-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    let bookedSeatNumber = requestedSeatNumber || 'A-01';
    let ticketPrice = 1500000;
    let concertTitle = 'Konser Musik';
    let concertVenue = 'Jakarta';
    let concertDate = '2026';
    let buyerName = 'Penonton Terdaftar';
    let buyerEmail = 'user@wartiket.id';

    if (isDbReady) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const userRes = await client.query('SELECT id, name, email, phone, id_card FROM users WHERE id = $1', [userId]);
        const dbUserId = userRes.rows.length > 0 ? userRes.rows[0].id : null;
        if (userRes.rows.length > 0) {
          buyerName = userRes.rows[0].name;
          buyerEmail = userRes.rows[0].email;
        }

        const concertRes = await client.query('SELECT title, venue, concert_date, price FROM concerts WHERE id = $1', [concertId]);
        if (concertRes.rows.length > 0) {
          concertTitle = concertRes.rows[0].title;
          concertVenue = concertRes.rows[0].venue;
          concertDate = concertRes.rows[0].concert_date;
          ticketPrice = parseFloat(concertRes.rows[0].price);
        }

        // Seat selection & locking
        let seatRecord;
        if (seatId) {
          const seatRes = await client.query(
            `UPDATE seats 
             SET status = 'Booked', locked_by = $1 
             WHERE id = $2 AND concert_id = $3 AND status = 'Available' 
             RETURNING id, seat_number, price`,
            [dbUserId, seatId, concertId]
          );
          if (seatRes.rows.length > 0) {
            seatRecord = seatRes.rows[0];
          }
        } else {
          // Auto-assign next available seat (for k6 load testing or quick checkout)
          const findSeatRes = await client.query(
            `UPDATE seats 
             SET status = 'Booked', locked_by = $1 
             WHERE id = (
               SELECT id FROM seats 
               WHERE concert_id = $2 AND status = 'Available' 
               ORDER BY id ASC 
               LIMIT 1 
               FOR UPDATE SKIP LOCKED
             )
             RETURNING id, seat_number, price`,
            [dbUserId, concertId]
          );
          if (findSeatRes.rows.length > 0) {
            seatRecord = findSeatRes.rows[0];
            seatId = seatRecord.id;
          }
        }

        if (!seatRecord) {
          await client.query('ROLLBACK').catch(() => {});
          await releaseRedisCheckoutLock({
            stockKey: redisConcertKey,
            seatLockKey,
            stockDecremented,
            seatLockAcquired,
          });
          stockDecremented = false;
          seatLockAcquired = false;
          return res.status(409).json({
            success: false,
            message: 'Maaf, kursi yang dipilih baru saja diamankan oleh orang lain di Database relasional.',
            servedBy: os.hostname(),
            timestamp: new Date().toISOString(),
          });
        }

        bookedSeatNumber = seatRecord.seat_number;
        ticketPrice = parseFloat(seatRecord.price);

        await client.query(
          `INSERT INTO transactions 
           (order_id, user_id, concert_id, seat_id, seat_number, amount, status, server_instance_id) 
           VALUES ($1, $2, $3, $4, $5, $6, 'COMPLETED', $7)`,
          [orderId, dbUserId, concertId, seatId, bookedSeatNumber, ticketPrice, os.hostname()]
        );

        await client.query(
          `UPDATE concerts 
           SET available_seats = GREATEST(0, available_seats - 1) 
           WHERE id = $1`,
          [concertId]
        );

        await client.query('COMMIT');
      } catch (dbErr) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(`[DB Error during checkout]:`, dbErr.message);
        throw dbErr;
      } finally {
        client.release();
      }
    }

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
    if (isRedisReady) {
      await redis.set(TICKET_KEY, INITIAL_STOCK);
      for (let cId = 1; cId <= 3; cId++) {
        await redis.set(`concert:${cId}:stock`, 500);
      }
      // Flush Redis keys for seat locks
      const keys = await redis.keys('concert:*:seat:*:lock');
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    }

    if (isDbReady) {
      // Reset seats status to 'Available' except demo pre-booked seats
      await pool.query(`
        UPDATE seats 
        SET status = 'Available', locked_by = NULL;
      `);

      // Pre-book demo seats
      await pool.query(`
        UPDATE seats SET status = 'Booked', locked_by = 4 WHERE concert_id = 1 AND seat_number IN ('A-03', 'A-04', 'B-07', 'C-05');
        UPDATE seats SET status = 'Booked', locked_by = 5 WHERE concert_id = 2 AND seat_number IN ('A-01', 'B-05', 'C-08');
        UPDATE seats SET status = 'Booked', locked_by = 4 WHERE concert_id = 3 AND seat_number IN ('A-02', 'A-05', 'B-09');
      `);

      // Sync concert available seats
      await pool.query(`
        UPDATE concerts c
        SET available_seats = (
            SELECT COUNT(*) 
            FROM seats s 
            WHERE s.concert_id = c.id AND s.status = 'Available'
        );
      `);
    }

    res.json({
      success: true,
      message: `Katalog tiket, denah kursi di Database, dan Redis Atomic Lock berhasil di-reset ke kondisi awal.`,
      stock: INITIAL_STOCK,
      servedBy: os.hostname(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Gagal mereset data', message: err.message, servedBy: os.hostname() });
  }
});

// Boot server
if (require.main === module) {
  redis.connect().catch((e) => {
    console.warn(`[Redis] Connect warning: ${e.message}`);
  });

  initDatabaseSchema().catch((e) => {
    console.warn(`[Database] Boot init warning: ${e.message}`);
  });

  app.listen(PORT, () => {
    console.log(`War Tiket Cloud API listening on port ${PORT} [Container: ${os.hostname()}]`);
  });
}

module.exports = {
  app,
  BUY_LUA_SCRIPT,
  LOCK_SEAT_LUA_SCRIPT,
  pool,
  redis,
  mergeRedisSeatLocks,
  releaseRedisCheckoutLock,
};
