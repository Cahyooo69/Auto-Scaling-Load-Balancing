const crypto = require('crypto');
const os = require('os');

const QUEUE_MAX_ACTIVE = parseInt(process.env.QUEUE_MAX_ACTIVE || '200', 10);
const QUEUE_ACTIVE_TTL_MS = parseInt(process.env.QUEUE_ACTIVE_TTL_MS || '180000', 10);
const QUEUE_HEARTBEAT_TIMEOUT_MS = parseInt(process.env.QUEUE_HEARTBEAT_TIMEOUT_MS || '25000', 10);

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

function createQueueController({ redis, getRedisReady }) {
  async function joinQueue(req, res) {
    const userId = parseInt(req.body?.userId, 10) || 0;
    const concertId = parseInt(req.body?.concertId, 10) || 1;
    const queueToken = crypto.randomUUID();
    const nowMs = Date.now();

    if (!getRedisReady()) {
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
  }

  async function getQueueStatus(req, res) {
    const queueToken = String(req.query.token || '').trim();
    if (!queueToken) {
      return res.status(400).json({ success: false, message: 'Token antrean wajib disertakan.', servedBy: os.hostname() });
    }
    if (!getRedisReady()) {
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
  }

  async function leaveQueue(req, res) {
    const queueToken = String(req.body?.queueToken || req.query?.token || '').trim();
    if (queueToken && getRedisReady()) {
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
  }

  return { joinQueue, getQueueStatus, leaveQueue };
}

module.exports = {
  createQueueController,
  QUEUE_WAIT_KEY,
  QUEUE_ACTIVE_KEY,
  QUEUE_HB_KEY,
  QUEUE_SEQ_KEY,
};

