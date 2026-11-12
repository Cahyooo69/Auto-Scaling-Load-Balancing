const express = require('express');
const os = require('os');
const path = require('path');

const {
  pool,
  getIsDbReady,
  checkDbConnection,
  initDatabaseSchema,
  DB_HOST,
  DB_NAME,
} = require('./src/config/db');
const {
  redis,
  getIsRedisReady,
  REDIS_HOST,
  REDIS_PORT,
  BUY_LUA_SCRIPT,
  LOCK_SEAT_LUA_SCRIPT,
  UNLOCK_SEAT_LUA_SCRIPT,
  QUEUE_SYNC_LUA_SCRIPT,
  mergeRedisSeatLocks,
  releaseRedisCheckoutLock,
} = require('./src/config/redis');
const { createApiRouter } = require('./src/routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================================
// 1. MULTI-PAGE SPA ROUTES, HEALTH & SYSTEM TELEMETRY
// ============================================================================

const PAGE_ROUTES = [
  '/',
  '/index.html',
  '/konser',
  '/concerts.html',
  '/riwayat',
  '/kontak',
  '/contact.html',
  '/live-test',
  '/hasil-test',
  '/hasil-war',
];

app.get(PAGE_ROUTES, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/favicon.ico', (req, res) => {
  res.type('image/svg+xml');
  res.sendFile(path.join(__dirname, 'public', 'img', 'concert-fallback.svg'));
});

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

app.get('/api/system/info', async (req, res) => {
  const dbOk = await checkDbConnection();
  res.json({
    serverInstance: os.hostname(),
    architecture: 'Docker Swarm / Compose Multi-Replica Mesh',
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

// ============================================================================
// 2. MODULAR API ROUTER & BACKWARD-COMPATIBLE LOAD-TEST ALIASES
// ============================================================================

const api = createApiRouter({
  pool,
  redis,
  port: PORT,
  getDbReady: getIsDbReady,
  checkDbConnection,
  getRedisReady: getIsRedisReady,
});

app.use('/api', api.router);
app.get('/tickets', api.ticketController.getTicketStatus);
app.post('/tickets/buy', api.ticketController.buyTicket);
app.post('/tickets/reset', api.ticketController.resetTickets);

// Catch-all SPA fallback: direct unknown UI routes render index.html without 404 (API/missing assets return 404 JSON)
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/tickets/') || /\.[a-z0-9]{2,5}$/i.test(req.path)) {
    return res.status(404).json({ success: false, error: 'Not Found' });
  }
  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================================
// 3. SERVER BOOTSTRAP & UNIT-TEST EXPORTS
// ============================================================================

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
