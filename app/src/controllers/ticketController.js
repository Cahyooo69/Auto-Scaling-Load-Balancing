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

function createTicketController({ pool, redis, getDbReady, checkDbConnection, getRedisReady }) {
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

  async function buyTicket(req, res) {
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
          message: 'PostgreSQL sedang memulihkan koneksi. Silakan coba beberapa detik lagi.',
          servedBy: os.hostname(),
          timestamp: new Date().toISOString(),
        });
      }

      // Resolusi seatId bila pemanggil hanya mengirim seatNumber
      if (!seatId && requestedSeatNumber) {
        const lookupSeat = await pool.query(
          'SELECT id FROM seats WHERE concert_id = $1 AND seat_number = $2 LIMIT 1',
          [concertId, requestedSeatNumber]
        );
        if (lookupSeat.rows.length > 0) {
          seatId = lookupSeat.rows[0].id;
        }
      }

      // Step 1: Redis Atomic Check & Decrement
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

      // Redis atomic seat lock with ownership token
      if (seatId) {
        seatLockKey = `concert:${concertId}:seat:${seatId}:lock`;
        seatLockValue = `${userId}:${crypto.randomUUID()}`;
        const lockAcquired = await redis.atomicLockSeat(seatLockKey, seatLockValue, 300);
        if (lockAcquired === 0) {
          await releaseRedisCheckoutLock({ redisClient: redis, stockKey: redisConcertKey, stockDecremented });
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

      // Step 2: Single-roundtrip PostgreSQL Atomic ACID Writable CTE
      const orderId = `TRX-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const { userMeta, concertMeta } = await getCheckoutMetadata(userId, concertId);
      const dbUserId = userMeta.id;
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
          redisClient: redis,
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

      // Pipelined Redis cleanup
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
            name: userMeta.name,
            email: userMeta.email,
          },
          concert: {
            id: concertId,
            title: concertMeta.title,
            venue: concertMeta.venue,
            concertDate: concertMeta.concertDate,
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
        redisClient: redis,
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
  }

  async function getTransactions(req, res) {
    try {
      if (!getDbReady()) await checkDbConnection();
      if (getDbReady()) {
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
          servedBy: os.hostname(),
        });
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
      let concertQuotas = [];
      if (getDbReady()) {
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

      if (getRedisReady()) {
        await redis.set(TICKET_KEY, INITIAL_STOCK);
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
        message: 'Katalog tiket, denah kursi di Database, dan Redis Atomic Lock berhasil di-reset ke kondisi awal.',
        stock: INITIAL_STOCK,
        concertStocks: syncedStocks,
        concertQuotas,
        servedBy: os.hostname(),
      });
    } catch (err) {
      return res.status(500).json({ error: 'Gagal mereset data', message: err.message, servedBy: os.hostname() });
    }
  }

  return { getTicketStatus, buyTicket, getTransactions, resetTickets };
}

module.exports = { createTicketController };

