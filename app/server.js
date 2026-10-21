const express = require('express');
const Redis = require('ioredis');
const os = require('os');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const REDIS_HOST = process.env.REDIS_HOST || 'redis';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const TICKET_KEY = 'concert:tickets:stock';
const INITIAL_STOCK = parseInt(process.env.INITIAL_STOCK || '1000', 10);

// shortcut: single Redis instance without sentinel/cluster, upgrade when Redis high-availability is required
const redis = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 50, 2000),
  lazyConnect: true
});

// Atomic decrement Lua script: checks stock and decrements if > 0 in a single atomic transaction
const BUY_LUA_SCRIPT = `
  local current = tonumber(redis.call('GET', KEYS[1]) or '0')
  if current > 0 then
    redis.call('DECR', KEYS[1])
    return current - 1
  else
    return -1
  end
`;

redis.defineCommand('atomicBuyTicket', {
  numberOfKeys: 1,
  lua: BUY_LUA_SCRIPT
});

redis.on('error', (err) => {
  // Suppress unhandled crash on connection attempts
});

// Connect to Redis and initialize stock atomically if not already set
async function initRedis() {
  try {
    await redis.connect();
    console.log(`Connected to Redis at ${REDIS_HOST}:${REDIS_PORT}`);
    const res = await redis.set(TICKET_KEY, INITIAL_STOCK, 'NX');
    if (res === 'OK') {
      console.log(`Initialized ticket stock to ${INITIAL_STOCK}`);
    }
  } catch (err) {
    console.warn(`Redis connection failed: ${err.message}. Retrying in background...`);
  }
}

// Helper for simulated artificial latency (50-100ms)
const artificialDelay = () => {
  const ms = Math.floor(Math.random() * 51) + 50; // 50 to 100ms
  return new Promise((resolve) => setTimeout(resolve, ms));
};

// Healthcheck endpoint for Docker Swarm & Nginx
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'UP',
    service: 'war-tiket-mock-api',
    container: os.hostname(),
    uptime: Math.floor(process.uptime())
  });
});

// Check current ticket status
app.get('/tickets', async (req, res) => {
  try {
    const stock = await redis.get(TICKET_KEY);
    res.json({
      stock: parseInt(stock || '0', 10),
      servedBy: os.hostname()
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve stock', message: err.message, servedBy: os.hostname() });
  }
});

// Reset ticket stock (for repeatable test runs & live demo)
app.post('/tickets/reset', async (req, res) => {
  try {
    const raw = req.body?.stock ?? req.query?.stock;
    const stock = raw !== undefined ? parseInt(raw, 10) : INITIAL_STOCK;
    await redis.set(TICKET_KEY, stock);
    res.json({
      message: `Stock successfully reset to ${stock}`,
      stock,
      servedBy: os.hostname()
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reset stock', message: err.message });
  }
});

// Atomic checkout / war tiket purchase
app.post('/tickets/buy', async (req, res) => {
  try {
    // Simulate real-world database/validation artificial delay (50-100ms)
    await artificialDelay();

    // Atomic checkout execution via Redis Lua script
    const remaining = await redis.atomicBuyTicket(TICKET_KEY);

    if (remaining >= 0) {
      return res.status(200).json({
        success: true,
        message: 'Tiket berhasil didapatkan!',
        remainingStock: remaining,
        servedBy: os.hostname(),
        timestamp: new Date().toISOString()
      });
    }

    return res.status(409).json({
      success: false,
      message: 'War tiket selesai: Tiket sudah habis terjual!',
      remainingStock: 0,
      servedBy: os.hostname(),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: 'Checkout failure',
      message: err.message,
      servedBy: os.hostname()
    });
  }
});

if (require.main === module) {
  initRedis();
  app.listen(PORT, () => {
    console.log(`War Tiket Mock API listening on port ${PORT} [Container: ${os.hostname()}]`);
  });
}

module.exports = { app, BUY_LUA_SCRIPT };
