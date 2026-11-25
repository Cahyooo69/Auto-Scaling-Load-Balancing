const express = require('express');
const os = require('os');
const path = require('path');

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

const {
  pool,
  writePool,
  readPool,
  shardList,
  DB_SHARD_COUNT,
  getShardId,
  parseShardIdFromCode,
  getShardWritePool,
  queryRead,
  queryShardRead,
  queryAllShardsRead,
  hasDedicatedReplica,
  getIsDbReady,
  getIsReadReplicaReady,
  getShardsStatus,
  checkDbConnection,
  initDatabaseSchema,
  DB_HOST,
  DB_NAME,
  DB_USER,
  DB_READ_HOST,
  DB_READ_USER,
} = require('./src/config/db');

const { attachOptionalJwt, requireAdminOrKey } = require('./src/utils/jwt');
const { createApiRouter } = require('./src/routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// Local dev fallback for /cdn/* static paths (served by Nginx Edge Cache -> MinIO in Swarm)
app.use('/cdn', express.static(path.join(__dirname, 'public')));

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
    databaseReplica: getIsReadReplicaReady() ? 'CONNECTED' : 'FALLBACK_PRIMARY',
    shardCount: DB_SHARD_COUNT,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// System info endpoint
app.get('/api/system/info', async (req, res) => {
  const dbOk = await checkDbConnection();
  res.json({
    serverInstance: os.hostname(),
    architecture: 'Defense-in-Depth Swarm (WAF + Honeypot + Nginx LB/CDN + MinIO + PgBouncer + 3-Shard PG Primary/Replica)',
    platform: process.platform,
    nodeVersion: process.version,
    security: {
      waf: 'ENABLED',
      honeypot: 'ENABLED',
      publicPortsOnly: [80, 443],
    },
    cdn: {
      edgeCache: 'Nginx proxy_cache',
      objectStorage: 'MinIO S3 (wartiket-assets)',
    },
    redis: {
      status: getIsRedisReady() ? 'CONNECTED' : 'RECONNECTING',
      role: 'Session Store, Queue & Hot Cache (Non-Financial)',
      host: REDIS_HOST,
      port: REDIS_PORT,
    },
    database: {
      status: dbOk ? 'CONNECTED' : 'RECONNECTING',
      type: `PostgreSQL 16 (${DB_SHARD_COUNT} Master + ${DB_SHARD_COUNT} Slave Sharded via PgBouncer)`,
      shardCount: DB_SHARD_COUNT,
      shardKey: 'concert_id % 3',
      writeHost: DB_HOST,
      writeUser: DB_USER,
      readHost: DB_READ_HOST,
      readUser: DB_READ_USER,
      dedicatedReplica: hasDedicatedReplica,
      replicaStatus: getIsReadReplicaReady() ? 'CONNECTED' : 'FALLBACK_PRIMARY',
      name: DB_NAME,
      shards: getShardsStatus(),
      poolTotal: writePool.totalCount,
      poolIdle: writePool.idleCount,
      poolWaiting: writePool.waitingCount,
      readPoolTotal: readPool.totalCount,
    },
    timestamp: new Date().toISOString(),
  });
});

// Wire modular API router
const { router: apiRouter, ticketController } = createApiRouter({
  pool: writePool,
  shardList,
  DB_SHARD_COUNT,
  getShardId,
  parseShardIdFromCode,
  getShardWritePool,
  queryRead,
  queryShardRead,
  queryAllShardsRead,
  redis,
  port: PORT,
  getDbReady: getIsDbReady,
  checkDbConnection,
  getRedisReady: getIsRedisReady,
});
app.use('/api', apiRouter);

// Backward-compatible root endpoint aliases
app.get('/tickets', ticketController.getTicketStatus);
app.post('/tickets/buy', attachOptionalJwt, ticketController.buyTicket);
app.post('/tickets/reset', requireAdminOrKey, ticketController.resetTickets);

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

  // Periodic background sweeper for expired 5-minute PENDING booking holds
  const expiryTimer = setInterval(() => {
    ticketController.expireStaleBookings().catch(() => {});
  }, 15000);
  expiryTimer.unref();

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
  writePool,
  readPool,
  queryRead,
  redis,
  mergeRedisSeatLocks,
  releaseRedisCheckoutLock,
};
