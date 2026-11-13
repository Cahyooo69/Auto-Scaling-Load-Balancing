const http = require('http');
const os = require('os');

function sendSingleHttpPost(targetUrl, payloadStr, agent, attempt = 0) {
  return new Promise((resolve) => {
    const url = new URL(targetUrl);
    const t0 = process.hrtime.bigint();
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: 'POST',
        agent,
        timeout: 15000,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payloadStr),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          const ms = Number(process.hrtime.bigint() - t0) / 1e6;
          let parsed = {};
          try {
            parsed = JSON.parse(raw);
          } catch {}
          resolve({
            status: res.statusCode || 500,
            ms,
            servedBy: parsed.servedBy || 'unknown',
          });
        });
      }
    );

    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (err) => {
      if (err.code === 'ECONNRESET' && attempt < 1) {
        return resolve(sendSingleHttpPost(targetUrl, payloadStr, agent, attempt + 1));
      }
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      resolve({ status: 0, ms, servedBy: 'error', error: err.message });
    });

    req.write(payloadStr);
    req.end();
  });
}

function createBookingController({ pool, redis, getRedisReady, port, getDbReady, checkDbConnection }) {
  async function getMyOrders(req, res) {
    const userId = parseInt(req.authUser?.id, 10);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'User JWT tidak valid.' });
    }

    try {
      if (!getDbReady()) await checkDbConnection();
      if (!getDbReady()) {
        return res.status(503).json({
          success: false,
          message: 'Database sedang memulihkan koneksi.',
          servedBy: os.hostname(),
        });
      }

      const q = await pool.query(
        `
        SELECT
          b.id,
          b.booking_code,
          b.total_amount,
          b.status,
          b.server_instance_id,
          b.created_at,
          c.title AS concert_title,
          c.venue AS concert_venue,
          c.concert_date,
          COALESCE(bd.seat_number, s.seat_number, '-') AS seat_number,
          COALESCE(bd.category, s.category, 'CAT 1') AS seat_category,
          COALESCE(bd.price, b.total_amount) AS seat_price
        FROM bookings b
        LEFT JOIN booking_details bd ON bd.booking_id = b.id
        LEFT JOIN seats s ON s.id = bd.seat_id
        LEFT JOIN concerts c ON c.id = b.concert_id
        WHERE b.user_id = $1
        ORDER BY b.created_at DESC
        LIMIT 50
        `,
        [userId]
      );

      return res.json({
        success: true,
        orders: q.rows.map((r) => ({
          id: r.id,
          bookingCode: r.booking_code,
          concertTitle: r.concert_title || 'Konser Musik',
          concertVenue: r.concert_venue || '-',
          concertDate: r.concert_date || '-',
          seatCategory: r.seat_category || 'CAT 1',
          seatNumber: r.seat_number || '-',
          totalAmount: parseFloat(r.total_amount || 0),
          status: r.status || 'PAID',
          serverInstanceId: r.server_instance_id,
          createdAt: r.created_at,
        })),
        servedBy: os.hostname(),
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: `Gagal memuat riwayat pemesanan: ${err.message}`,
        servedBy: os.hostname(),
      });
    }
  }

  /**
   * In-cluster Live Stress Test runner: sends concurrent POST /api/tickets/buy
   * through the Nginx Load Balancer so Swarm container distribution & true latency
   * can be visualized without browser HTTP/1.1 6-socket caps.
   */
  async function runLiveStressTest(req, res) {
    const rawCount = parseInt(req.body?.count, 10) || 100;
    const count = Math.max(1, Math.min(rawCount, 1000));
    const concertId = parseInt(req.body?.concertId, 10) || 1;
    const userId = parseInt(req.body?.userId, 10) || 1;

    // Notify auto-scaler of active cluster burst so fast spikes trigger scale-up before CPU averages lag
    if (count >= 100 && redis && getRedisReady?.()) {
      redis.set('autoscaler:demand', String(count), 'EX', count >= 500 ? 8 : 5).catch(() => {});
    }

    const primaryTarget =
      process.env.STRESS_TARGET_URL ||
      (process.env.NODE_ENV === 'production'
        ? 'http://nginx/api/tickets/buy'
        : `http://127.0.0.1:${port}/api/tickets/buy`);

    // Match concurrency to 0.25 vCPU event loop + 3x Swarm worker throughput without Linux CFS throttling spikes
    const workerConcurrency = Math.min(count, 6);
    const agent = new http.Agent({ keepAlive: true, keepAliveMsecs: 1000, maxSockets: 10 });
    const startedAt = Date.now();
    const results = new Array(count);
    let cursor = 0;

    try {
      // Probe primary target once so local non-Swarm dev falls back cleanly to localhost
      let targetUrl = primaryTarget;
      const probe = await sendSingleHttpPost(
        targetUrl,
        JSON.stringify({ userId, concertId }),
        agent
      );
      if (probe.status === 0 && targetUrl.includes('http://nginx')) {
        targetUrl = `http://127.0.0.1:${port}/api/tickets/buy`;
        results[0] = await sendSingleHttpPost(targetUrl, JSON.stringify({ userId, concertId }), agent);
      } else {
        results[0] = probe;
      }
      cursor = 1;

      async function pump() {
        while (true) {
          const idx = cursor++;
          if (idx >= count) return;
          const uid = ((idx % 1000) + 6);
          results[idx] = await sendSingleHttpPost(
            targetUrl,
            JSON.stringify({ userId: uid, concertId }),
            agent
          );
        }
      }

      await Promise.all(Array.from({ length: workerConcurrency }, () => pump()));
    } finally {
      agent.destroy();
    }

    const totalDurationMs = Date.now() - startedAt;
    const latencies = results.map((r) => r.ms).sort((a, b) => a - b);
    const avgLatencyMs = latencies.reduce((acc, v) => acc + v, 0) / latencies.length;
    const p95LatencyMs = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))];

    let ok200 = 0;
    let conflict409 = 0;
    let error5xx = 0;
    const workerNodes = {};

    for (const r of results) {
      if (r.status === 200) ok200 += 1;
      else if (r.status === 409) conflict409 += 1;
      else error5xx += 1;

      if (r.servedBy && r.servedBy !== 'error') {
        workerNodes[r.servedBy] = (workerNodes[r.servedBy] || 0) + 1;
      }
    }

    const errorRatePct = Number(((error5xx / count) * 100).toFixed(2));
    const avgRounded = Number(avgLatencyMs.toFixed(1));
    const p95Rounded = Number(p95LatencyMs.toFixed(1));

    let concertQuotas = [];
    if (getDbReady()) {
      try {
        const qQuota = await pool.query(`
          SELECT c.id, c.total_seats,
                 (SELECT COUNT(*)::int FROM seats s WHERE s.concert_id = c.id AND s.status = 'Available') AS available_seats
          FROM concerts c
          WHERE c.id <= 3
          ORDER BY c.id ASC
        `);
        concertQuotas = qQuota.rows.map((r) => ({
          id: Number(r.id),
          totalSeats: Number(r.total_seats || 500),
          availableSeats: Number(r.available_seats || 0),
        }));
      } catch {}
    }

    return res.json({
      success: true,
      totalRequests: count,
      totalDurationMs,
      avgLatencyMs: avgRounded,
      p95LatencyMs: p95Rounded,
      slaPassed: avgRounded < 200 && errorRatePct < 1,
      ok200,
      conflict409,
      error5xx,
      errorRatePct,
      workerNodes,
      concertQuotas,
      servedBy: os.hostname(),
    });
  }

  return { getMyOrders, runLiveStressTest };
}

module.exports = { createBookingController };

