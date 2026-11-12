const express = require('express');
const os = require('os');
const path = require('path');

const {
  redis,
  getIsRedisReady,
  REDIS_HOST,
  REDIS_PORT,
  TICKET_KEY,
  INITIAL_STOCK,
  BUY_LUA_SCRIPT,
  LOCK_SEAT_LUA_SCRIPT,
  UNLOCK_SEAT_LUA_SCRIPT,
  QUEUE_SYNC_LUA_SCRIPT,
  mergeRedisSeatLocks,
  releaseRedisCheckoutLock,
} = require('./src/config/redis');

const {
  pool,
  getIsDbReady,
  checkDbConnection,
  initDatabaseSchema,
  DB_HOST,
  DB_NAME,
} = require('./src/config/db');

const { createApiRouter } = require('./src/routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Multi-Page SPA HTML routes
const PAGE_ROUTES = [
  { paths: ['/', '/index.html', '/konser', '/concerts.html', '/riwayat', '/kontak', '/contact.html', '/admin', '/admin.html', '/live-test', '/hasil-test'], file: 'index.html' },
];
PAGE_ROUTES.forEach(({ paths, file }) => {
  app.get(paths, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', file));
  });
});

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
    redis: getIsRedisReady() ? 'CONNECTED' : 'DISCONNECTED',
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
      status: getIsRedisReady() ? 'CONNECTED' : 'RECONNECTING',
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

// Wire modular API router
const { router: apiRouter, ticketController } = createApiRouter({
  pool,
  redis,
  port: PORT,
  getDbReady: getIsDbReady,
  checkDbConnection,
  getRedisReady: getIsRedisReady,
});
app.use('/api', apiRouter);

// Backward-compatible root endpoint aliases
app.get('/tickets', ticketController.getTicketStatus);
app.post('/tickets/buy', ticketController.buyTicket);
app.post('/tickets/reset', ticketController.resetTickets);

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
