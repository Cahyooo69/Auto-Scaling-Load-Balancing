const crypto = require('crypto');
const os = require('os');
const {
  TICKET_KEY,
  INITIAL_STOCK,
  CONCERTS_CACHE_KEY,
  scanAndDelete,
  releaseRedisCheckoutLock,
} = require('../config/redis');
const {
  QUEUE_WAIT_KEY,
  QUEUE_ACTIVE_KEY,
  QUEUE_HB_KEY,
  QUEUE_SEQ_KEY,
} = require('./queueController');

const BOOKING_HOLD_TTL_SEC = Math.max(5, parseInt(process.env.BOOKING_HOLD_TTL_SEC || '300', 10));

function resolveBuyerId(req) {
  const bodyUserId = req.body?.userId !== undefined && req.body?.userId !== null
    ? parseInt(req.body.userId, 10)
    : null;

  if (req.authUser && req.authUser.id) {
    const authId = Number(req.authUser.id);
    const isAdmin = ['admin', 'lecturer'].includes(String(req.authUser.role || '').toLowerCase());
    if (bodyUserId && !Number.isNaN(bodyUserId) && bodyUserId !== authId && !isAdmin) {
      return { error: 'Akses ditolak (IDOR): userId tidak sesuai dengan sesi login aktif.', status: 403 };
    }
    return { userId: authId };
  }
  // shortcut: unauthenticated /tickets/buy stays open for classroom k6/failover demos; switch to requireJwtAuth in production
  return { userId: bodyUserId && !Number.isNaN(bodyUserId) ? bodyUserId : 1 };
}

function createTicketController({
  pool,
  shardList,
  DB_SHARD_COUNT = 1,
  getShardId,
  parseShardIdFromCode,
  getShardWritePool,
  queryRead,
  queryShardRead,
  queryAllShardsRead,
  redis,
  getDbReady,
  checkDbConnection,
  getRedisReady,
}) {
  const execRead = queryRead || ((sql, params) => pool.query(sql, params));
  const execShardRead = queryShardRead || ((_cid, sql, params) => execRead(sql, params));
  const resolveShardId = getShardId || (() => 1);
  const resolveCodeShard = parseShardIdFromCode || (() => null);
  const writePoolFor = getShardWritePool || (() => pool);
  const activeShards = Array.isArray(shardList) && shardList.length > 0
    ? shardList
    : [{ id: 1, writePool: pool }];

  async function getTicketStatus(req, res) {
    try {
      if (!getRedisReady()) {
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
  }

  /**
   * Atomically expires PENDING reservations past their 5-minute TTL across all shards
   * using FOR UPDATE OF b SKIP LOCKED so concurrent Swarm workers never double-restore stock.
   */
  async function expireStaleBookings() {
    if (!getDbReady()) return 0;
    const expireSql = `
      WITH stale AS (
        SELECT b.id AS booking_id, b.concert_id, bd.seat_id
        FROM bookings b
        LEFT JOIN booking_details bd ON bd.booking_id = b.id
        WHERE b.status = 'PENDING'
          AND b.expires_at IS NOT NULL
          AND b.expires_at <= NOW()
        FOR UPDATE OF b SKIP LOCKED
      ),
      mark_expired AS (
        UPDATE bookings
        SET status = 'EXPIRED'
        WHERE id IN (SELECT booking_id FROM stale)
        RETURNING id
      ),
      release_seats AS (
        UPDATE seats
        SET status = 'Available', locked_by = NULL
        WHERE id IN (SELECT seat_id FROM stale WHERE seat_id IS NOT NULL)
          AND status = 'Locked'
        RETURNING id
      )
      SELECT concert_id, seat_id FROM stale
    `;

    const settled = await Promise.allSettled(activeShards.map((s) => s.writePool.query(expireSql)));
    const expiredRows = settled
      .filter((r) => r.status === 'fulfilled')
      .flatMap((r) => r.value.rows || []);

    if (expiredRows.length > 0 && getRedisReady()) {
      const pipeline = redis.pipeline();
      const touchedConcerts = new Set();
      for (const row of expiredRows) {
        if (row.concert_id) {
          pipeline.incr(`concert:${row.concert_id}:stock`);
          touchedConcerts.add(row.concert_id);
        }
        if (row.concert_id && row.seat_id) {
          pipeline.del(`concert:${row.concert_id}:seat:${row.seat_id}:lock`);
        }
      }
      pipeline.del(CONCERTS_CACHE_KEY);
      for (const cId of touchedConcerts) {
        pipeline.del(`cache:concert:${cId}:seats`);
      }
      await pipeline.exec().catch(() => {});
    }
    return expiredRows.length;
  }

  async function acquireSeatAndQuota({ userId, concertId, rawSeatId, requestedSeatNumber, ttlSec, shardId }) {
    const redisConcertKey = `concert:${concertId}:stock`;
    let seatId = rawSeatId ? parseInt(rawSeatId, 10) : null;
    if (!seatId && requestedSeatNumber) {
      const lookupSeat = await execShardRead(
        concertId,
        'SELECT id FROM seats WHERE concert_id = $1 AND seat_number = $2 LIMIT 1',
        [concertId, requestedSeatNumber]
      );
      if (lookupSeat.rows.length > 0) seatId = lookupSeat.rows[0].id;
    }

    const remainingStock = await redis.atomicBuyTicket(redisConcertKey);
    if (remainingStock < 0) {
      return {
        conflict: {
          status: 409,
          body: {
            success: false,
            message: 'War tiket selesai: Tiket konser ini sudah habis terjual!',
            remainingStock: 0,
            shardId,
            servedBy: os.hostname(),
            timestamp: new Date().toISOString(),
          },
        },
      };
    }

    let seatLockKey = null;
    let seatLockValue = null;
    let seatLockAcquired = false;
    if (seatId) {
      seatLockKey = `concert:${concertId}:seat:${seatId}:lock`;
      seatLockValue = `${userId}:${crypto.randomUUID()}`;
      const lockAcquired = await redis.atomicLockSeat(seatLockKey, seatLockValue, ttlSec);
      if (lockAcquired === 0) {
        await releaseRedisCheckoutLock({ redisClient: redis, stockKey: redisConcertKey, stockDecremented: true });
        return {
          conflict: {
            status: 409,
            body: {
              success: false,
              message: 'Kursi ini sedang dalam proses pemesanan atau sudah diamankan penonton lain! Silakan pilih kursi lain.',
              shardId,
              servedBy: os.hostname(),
              timestamp: new Date().toISOString(),
            },
          },
        };
      }
      seatLockAcquired = true;
    }

    return { redisConcertKey, seatId, remainingStock, seatLockKey, seatLockValue, seatLockAcquired, stockDecremented: true };
  }

  /** Step 1 of 2-Step Checkout: Reserves a seat in PENDING state with a 5-minute TTL on its owning shard. */
  async function reserveTicket(req, res) {
    const body = req.body || {};
    const concertId = parseInt(body.concertId, 10) || 1;
    const shardId = resolveShardId(concertId);
    const shardWritePool = writePoolFor(concertId);
    const userId = Number(req.authUser?.id);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Autentikasi JWT diperlukan untuk reservasi kursi.' });
    }

    const requestedTtl = parseInt(body.holdTtlSec, 10);
    const holdTtlSec = !Number.isNaN(requestedTtl) && requestedTtl >= 2
      ? Math.min(requestedTtl, BOOKING_HOLD_TTL_SEC)
      : BOOKING_HOLD_TTL_SEC;

    let lockCtx = { redisConcertKey: `concert:${concertId}:stock`, stockDecremented: false, seatLockAcquired: false };

    try {
      if (!getRedisReady()) {
        return res.status(503).json({
          success: false,
          degraded: true,
          error: 'Redis Failover Active',
          message: 'Redis sedang memulihkan koneksi.',
          servedBy: os.hostname(),
        });
      }
      if (!getDbReady()) await checkDbConnection();
      if (!getDbReady()) {
        return res.status(503).json({
          success: false,
          degraded: true,
          error: 'Database Reconnecting',
          message: `PostgreSQL Shard ${shardId} Primary sedang memulihkan koneksi.`,
          servedBy: os.hostname(),
        });
      }

      await expireStaleBookings();

      lockCtx = await acquireSeatAndQuota({
        userId,
        concertId,
        rawSeatId: body.seatId,
        requestedSeatNumber: body.seatNumber ? String(body.seatNumber).trim() : null,
        ttlSec: holdTtlSec,
        shardId,
      });
      if (lockCtx.conflict) {
        return res.status(lockCtx.conflict.status).json(lockCtx.conflict.body);
      }

      const bookingCode = `HOLD-S${shardId}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const hostInstance = os.hostname();

      const atomicHold = await shardWritePool.query(
        `WITH claimed_seat AS (
           UPDATE seats
           SET status = 'Locked', locked_by = $1::int
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
         ins_booking AS (
           INSERT INTO bookings
             (booking_code, user_id, concert_id, total_amount, status, expires_at, server_instance_id)
           SELECT $4::varchar, $1::int, $3::int, price, 'PENDING', NOW() + ($6::int * INTERVAL '1 second'), $5::varchar
           FROM claimed_seat
           RETURNING id, booking_code, expires_at
         ),
         ins_details AS (
           INSERT INTO booking_details (booking_id, seat_id, seat_number, category, price)
           SELECT b.id, s.id, s.seat_number, COALESCE(s.category, 'CAT 1'), s.price
           FROM ins_booking b CROSS JOIN claimed_seat s
         )
         SELECT s.id, s.seat_number, s.category, s.price, b.booking_code, b.expires_at
         FROM claimed_seat s CROSS JOIN ins_booking b`,
        [userId, lockCtx.seatId, concertId, bookingCode, hostInstance, holdTtlSec]
      );

      if (atomicHold.rows.length === 0) {
        await releaseRedisCheckoutLock({
          redisClient: redis,
          stockKey: lockCtx.redisConcertKey,
          seatLockKey: lockCtx.seatLockKey,
          seatLockValue: lockCtx.seatLockValue,
          stockDecremented: lockCtx.stockDecremented,
          seatLockAcquired: lockCtx.seatLockAcquired,
        });
        return res.status(409).json({
          success: false,
          message: 'Kursi sudah diamankan penonton lain di database.',
          shardId,
          servedBy: hostInstance,
        });
      }

      const held = atomicHold.rows[0];
      if (!lockCtx.seatLockAcquired) {
        await redis.atomicLockSeat(`concert:${concertId}:seat:${held.id}:lock`, `${userId}:${bookingCode}`, holdTtlSec).catch(() => {});
      }
      await redis.del(`cache:concert:${concertId}:seats`).catch(() => {});

      return res.status(201).json({
        success: true,
        status: 'PENDING',
        message: `Kursi ${held.seat_number} dikunci sementara selama ${holdTtlSec} detik (Shard ${shardId}).`,
        bookingCode: held.booking_code,
        concertId,
        shardId,
        seat: {
          id: held.id,
          seatNumber: held.seat_number,
          category: held.category,
          price: parseFloat(held.price),
        },
        holdTtlSec,
        expiresAt: held.expires_at,
        remainingStock: lockCtx.remainingStock,
        servedBy: hostInstance,
      });
    } catch (err) {
      await releaseRedisCheckoutLock({
        redisClient: redis,
        stockKey: lockCtx.redisConcertKey,
        seatLockKey: lockCtx.seatLockKey,
        seatLockValue: lockCtx.seatLockValue,
        stockDecremented: lockCtx.stockDecremented,
        seatLockAcquired: lockCtx.seatLockAcquired,
      });
      return res.status(503).json({
        success: false,
        degraded: true,
        error: 'Reservation Failover',
        message: `Gangguan saat menahan kursi pada Shard ${shardId}: ${err.message}`,
        shardId,
        servedBy: os.hostname(),
      });
    }
  }

  /** Step 2 of 2-Step Checkout: Routes in O(1) to the shard encoded in bookingCode and confirms payment. */
  async function confirmBooking(req, res) {
    const userId = Number(req.authUser?.id);
    const bookingCode = String(req.body?.bookingCode || '').trim();
    const queueToken = req.body?.queueToken ? String(req.body.queueToken).trim() : '';
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Autentikasi JWT diperlukan untuk konfirmasi pembayaran.' });
    }
    if (!bookingCode) {
      return res.status(400).json({ success: false, message: 'bookingCode wajib disertakan.' });
    }

    const parsedShard = resolveCodeShard(bookingCode);
    const shardId = parsedShard || resolveShardId(req.body?.concertId || 1);
    const shardWritePool = writePoolFor(shardId);

    try {
      if (!getDbReady()) await checkDbConnection();
      if (!getDbReady()) {
        return res.status(503).json({ success: false, degraded: true, message: 'PostgreSQL Primary sedang memulihkan koneksi.', servedBy: os.hostname() });
      }

      const hostInstance = os.hostname();
      const confirmed = await shardWritePool.query(
        `WITH target AS (
           SELECT b.id AS booking_id, b.concert_id, b.total_amount, bd.seat_id, bd.seat_number, bd.price
           FROM bookings b
           JOIN booking_details bd ON bd.booking_id = b.id
           WHERE b.booking_code = $1::varchar
             AND b.user_id = $2::int
             AND b.status = 'PENDING'
             AND (b.expires_at IS NULL OR b.expires_at > NOW())
           FOR UPDATE OF b
         ),
         mark_paid AS (
           UPDATE bookings
           SET status = 'PAID', server_instance_id = $3::varchar
           WHERE id IN (SELECT booking_id FROM target)
           RETURNING id
         ),
         mark_seat AS (
           UPDATE seats
           SET status = 'Booked', locked_by = $2::int
           WHERE id IN (SELECT seat_id FROM target WHERE seat_id IS NOT NULL)
           RETURNING id
         ),
         dec_concert AS (
           UPDATE concerts
           SET available_seats = GREATEST(0, available_seats - 1)
           WHERE id IN (SELECT concert_id FROM target)
           RETURNING id
         ),
         ins_trx AS (
           INSERT INTO transactions
             (order_id, user_id, concert_id, seat_id, seat_number, amount, status, server_instance_id)
           SELECT $1::varchar, $2::int, concert_id, seat_id, seat_number, price, 'COMPLETED', $3::varchar
           FROM target
         )
         SELECT concert_id, seat_id, seat_number, price FROM target`,
        [bookingCode, userId, hostInstance]
      );

      if (confirmed.rows.length === 0) {
        await expireStaleBookings();
        const checkState = await shardWritePool.query(
          'SELECT status, expires_at FROM bookings WHERE booking_code = $1 AND user_id = $2 LIMIT 1',
          [bookingCode, userId]
        );
        if (checkState.rows.length === 0) {
          return res.status(404).json({ success: false, message: 'Reservasi tidak ditemukan atau bukan milik akun ini.', shardId, servedBy: hostInstance });
        }
        const st = checkState.rows[0].status;
        if (st === 'PAID') {
          return res.status(409).json({ success: false, message: 'Reservasi ini sudah dibayar sebelumnya.', shardId, servedBy: hostInstance });
        }
        return res.status(410).json({
          success: false,
          status: 'EXPIRED',
          shardId,
          message: 'Batas waktu pembayaran (5 menit) telah habis. Transaksi dibatalkan dan kursi dilepas kembali.',
          servedBy: hostInstance,
        });
      }

      const row = confirmed.rows[0];
      if (getRedisReady()) {
        const pipeline = redis.pipeline();
        pipeline.del(CONCERTS_CACHE_KEY, `cache:concert:${row.concert_id}:seats`);
        if (row.seat_id) pipeline.del(`concert:${row.concert_id}:seat:${row.seat_id}:lock`);
        if (queueToken) {
          pipeline.zrem(QUEUE_ACTIVE_KEY, queueToken);
          pipeline.del(`queue:meta:${queueToken}`);
        }
        await pipeline.exec().catch(() => {});
      }

      const ticketPrice = parseFloat(row.price || 1500000);
      return res.status(200).json({
        success: true,
        status: 'PAID',
        shardId,
        message: 'Pembayaran dikonfirmasi! E-Ticket resmi telah terbit.',
        orderId: bookingCode,
        ticket: {
          orderId: bookingCode,
          user: { id: userId },
          concert: { id: row.concert_id },
          seat: { id: row.seat_id, seatNumber: row.seat_number, price: ticketPrice },
          amount: ticketPrice,
          shardId,
          serverInstanceId: hostInstance,
          timestamp: new Date().toISOString(),
        },
        servedBy: hostInstance,
      });
    } catch (err) {
      return res.status(503).json({
        success: false,
        degraded: true,
        message: `Gagal mengonfirmasi pembayaran pada Shard ${shardId}: ${err.message}`,
        shardId,
        servedBy: os.hostname(),
      });
    }
  }

  async function buyTicket(req, res) {
    const resolved = resolveBuyerId(req);
    if (resolved.error) {
      return res.status(resolved.status).json({
        success: false,
        message: resolved.error,
        servedBy: os.hostname(),
      });
    }

    const body = req.body || {};
    const concertId = parseInt(body.concertId, 10) || 1;
    const shardId = resolveShardId(concertId);
    const shardWritePool = writePoolFor(concertId);
    let lockCtx = { redisConcertKey: `concert:${concertId}:stock`, stockDecremented: false, seatLockAcquired: false };

    try {
      const userId = resolved.userId;
      const requestedSeatNumber = body.seatNumber ? String(body.seatNumber).trim() : null;
      const queueToken = body.queueToken ? String(body.queueToken).trim() : '';

      if (!getRedisReady()) {
        return res.status(503).json({
          success: false,
          degraded: true,
          error: 'Redis Failover Active',
          message: 'Disaster Recovery: Redis sedang memulihkan koneksi.',
          servedBy: os.hostname(),
          timestamp: new Date().toISOString(),
        });
      }

      if (!getDbReady()) await checkDbConnection();
      if (!getDbReady()) {
        return res.status(503).json({
          success: false,
          degraded: true,
          error: 'Database Reconnecting',
          message: `PostgreSQL Shard ${shardId} sedang memulihkan koneksi.`,
          servedBy: os.hostname(),
          timestamp: new Date().toISOString(),
        });
      }

      lockCtx = await acquireSeatAndQuota({
        userId,
        concertId,
        rawSeatId: body.seatId,
        requestedSeatNumber,
        ttlSec: BOOKING_HOLD_TTL_SEC,
        shardId,
      });
      if (lockCtx.conflict) {
        return res.status(lockCtx.conflict.status).json(lockCtx.conflict.body);
      }

      const orderId = `TRX-S${shardId}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const hostInstance = os.hostname();

      const atomicResult = await shardWritePool.query(
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
         dec_concert AS (
           UPDATE concerts
           SET available_seats = GREATEST(0, available_seats - 1)
           WHERE id = $3::int AND EXISTS (SELECT 1 FROM claimed_seat)
           RETURNING id
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
        [userId, lockCtx.seatId, concertId, orderId, hostInstance]
      );

      if (atomicResult.rows.length === 0) {
        await releaseRedisCheckoutLock({
          redisClient: redis,
          stockKey: lockCtx.redisConcertKey,
          seatLockKey: lockCtx.seatLockKey,
          seatLockValue: lockCtx.seatLockValue,
          stockDecremented: lockCtx.stockDecremented,
          seatLockAcquired: lockCtx.seatLockAcquired,
        });
        return res.status(409).json({
          success: false,
          message: 'Maaf, kursi yang dipilih baru saja diamankan oleh orang lain di Database relasional.',
          shardId,
          servedBy: hostInstance,
          timestamp: new Date().toISOString(),
        });
      }

      const seatRecord = atomicResult.rows[0];
      const bookedSeatNumber = seatRecord.seat_number || requestedSeatNumber || 'A-01';
      const ticketPrice = parseFloat(seatRecord.price || 1500000);

      const pipeline = redis.pipeline();
      pipeline.del(CONCERTS_CACHE_KEY, `cache:concert:${concertId}:seats`);
      if (queueToken) {
        pipeline.zrem(QUEUE_ACTIVE_KEY, queueToken);
        pipeline.del(`queue:meta:${queueToken}`);
      }
      const postCommitTasks = [pipeline.exec().catch(() => {})];
      if (lockCtx.seatLockAcquired && lockCtx.seatLockKey) {
        postCommitTasks.push(redis.atomicUnlockSeat(lockCtx.seatLockKey, lockCtx.seatLockValue).catch(() => {}));
      }
      await Promise.all(postCommitTasks);

      return res.status(200).json({
        success: true,
        message: 'Tiket berhasil didapatkan!',
        orderId,
        shardId,
        ticket: {
          orderId,
          user: { id: userId },
          concert: { id: concertId },
          seat: {
            id: seatRecord.id,
            seatNumber: bookedSeatNumber,
            price: ticketPrice,
          },
          amount: ticketPrice,
          shardId,
          serverInstanceId: os.hostname(),
          timestamp: new Date().toISOString(),
        },
        remainingStock: lockCtx.remainingStock,
        servedBy: os.hostname(),
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      await releaseRedisCheckoutLock({
        redisClient: redis,
        stockKey: lockCtx.redisConcertKey,
        seatLockKey: lockCtx.seatLockKey,
        seatLockValue: lockCtx.seatLockValue,
        stockDecremented: lockCtx.stockDecremented,
        seatLockAcquired: lockCtx.seatLockAcquired,
      });
      return res.status(503).json({
        success: false,
        degraded: true,
        error: 'Transaction Failover',
        message: `Gangguan sementara saat memproses transaksi pada Shard ${shardId}: ${err.message}`,
        shardId,
        servedBy: os.hostname(),
        timestamp: new Date().toISOString(),
      });
    }
  }

  async function getTransactions(req, res) {
    try {
      if (!getDbReady()) await checkDbConnection();
      if (getDbReady()) {
        const sql = `
          SELECT
            t.order_id, t.amount, t.status, t.server_instance_id, t.seat_number, t.created_at,
            u.name as user_name, u.email as user_email,
            c.title as concert_title
          FROM transactions t
          LEFT JOIN users u ON t.user_id = u.id
          LEFT JOIN concerts c ON t.concert_id = c.id
          ORDER BY t.created_at DESC
          LIMIT 20
        `;
        if (DB_SHARD_COUNT > 1 && queryAllShardsRead) {
          const shardResults = await queryAllShardsRead(sql);
          const merged = shardResults
            .flatMap(({ shardId, rows }) => rows.map((r) => ({ ...r, shard_id: shardId })))
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 20);
          return res.json({ transactions: merged, servedBy: os.hostname() });
        }
        const q = await execRead(sql);
        return res.json({ transactions: q.rows, servedBy: os.hostname() });
      }
      return res.json({ transactions: [], servedBy: os.hostname() });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  async function resetTickets(req, res) {
    try {
      if (!getDbReady()) await checkDbConnection();

      let syncedStocks = {};
      const quotaMap = new Map();

      if (getDbReady()) {
        await Promise.all(
          activeShards.map(async (shard) => {
            const client = await shard.writePool.connect();
            let txFailed = false;
            try {
              await client.query('BEGIN');
              await client.query("UPDATE bookings SET status = 'EXPIRED' WHERE status = 'PENDING'");
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
              await client.query('COMMIT');

              for (const row of syncRes.rows) {
                if (resolveShardId(row.id) === shard.id || !quotaMap.has(row.id)) {
                  syncedStocks[row.id] = Number(row.available_seats);
                  quotaMap.set(row.id, {
                    id: Number(row.id),
                    totalSeats: Number(row.total_seats || 500),
                    availableSeats: Number(row.available_seats || 0),
                  });
                }
              }
            } catch (dbErr) {
              txFailed = true;
              await client.query('ROLLBACK').catch(() => {});
              throw dbErr;
            } finally {
              client.release(txFailed);
            }
          })
        );
      }

      const concertQuotas = Array.from(quotaMap.values()).sort((a, b) => a.id - b.id);

      const requestedStock = req.body?.stock ?? req.query?.stock;
      const parsedStock = requestedStock !== undefined ? parseInt(requestedStock, 10) : INITIAL_STOCK;
      const targetTotalStock = Number.isNaN(parsedStock) ? INITIAL_STOCK : parsedStock;

      if (getRedisReady()) {
        await redis.set(TICKET_KEY, targetTotalStock);
        for (let cId = 1; cId <= 3; cId++) {
          await redis.set(`concert:${cId}:stock`, syncedStocks[cId] ?? 500);
        }
        await scanAndDelete('concert:*:seat:*:lock', redis);
        await scanAndDelete('cache:*', redis);
        await scanAndDelete('queue:meta:*', redis);
        await redis.del(QUEUE_WAIT_KEY, QUEUE_ACTIVE_KEY, QUEUE_HB_KEY, QUEUE_SEQ_KEY).catch(() => {});
      }

      return res.json({
        success: true,
        message: `Seluruh ${activeShards.length} Shard Database (Primary + Replica), denah kursi, dan Redis Atomic Lock berhasil di-reset.`,
        shardsReset: activeShards.length,
        stock: targetTotalStock,
        concertStocks: syncedStocks,
        concertQuotas,
        servedBy: os.hostname(),
      });
    } catch (err) {
      return res.status(500).json({ error: 'Gagal mereset data', message: err.message, servedBy: os.hostname() });
    }
  }

  return {
    getTicketStatus,
    buyTicket,
    reserveTicket,
    confirmBooking,
    expireStaleBookings,
    getTransactions,
    resetTickets,
  };
}

module.exports = { createTicketController, resolveBuyerId, BOOKING_HOLD_TTL_SEC };
