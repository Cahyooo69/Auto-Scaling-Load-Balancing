const { Pool, Client } = require('pg');
const path = require('path');
const fs = require('fs');

const DB_NAME = process.env.DB_NAME || 'wartiket_db';
const DB_SHARD_COUNT = Math.max(1, parseInt(process.env.DB_SHARD_COUNT || '1', 10));

const DB_HOST = process.env.DB_WRITE_HOST || process.env.DB_HOST || 'localhost';
const DB_PORT = parseInt(process.env.DB_WRITE_PORT || process.env.DB_PORT || '5432', 10);
const DB_USER = process.env.DB_WRITE_USER || process.env.DB_USER || 'wartiket';
const DB_PASSWORD = process.env.DB_WRITE_PASSWORD || process.env.DB_PASSWORD || 'wartiket_secret';
const DB_POOL_MAX = parseInt(process.env.DB_POOL_MAX || '10', 10);

const DB_READ_PORT = parseInt(process.env.DB_READ_PORT || '5432', 10);
const DB_READ_USER = process.env.DB_READ_USER || DB_USER;
const DB_READ_PASSWORD = process.env.DB_READ_PASSWORD || DB_PASSWORD;
const DB_READ_POOL_MAX = parseInt(process.env.DB_READ_POOL_MAX || String(DB_POOL_MAX), 10);

const DB_ADMIN_PORT = parseInt(process.env.DB_ADMIN_PORT || '5432', 10);
const DB_ADMIN_USER = process.env.DB_ADMIN_USER || process.env.DB_USER || 'wartiket';
const DB_ADMIN_PASSWORD = process.env.DB_ADMIN_PASSWORD || process.env.DB_PASSWORD || 'wartiket_secret';

function createPool({ host, port, database, user, password, max }) {
  return new Pool({
    host,
    port,
    database,
    user,
    password,
    max,
    idleTimeoutMillis: 15000,
    connectionTimeoutMillis: 8000,
    query_timeout: 10000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  });
}

function bindPoolErrorHandlers(targetPool, onDown) {
  targetPool.on('error', onDown);
  targetPool.on('connect', (client) => {
    if (!client._wtErrGuarded) {
      client._wtErrGuarded = true;
      client.on('error', onDown);
    }
  });
}

/** Deterministic shard routing: concert_id 1 -> Shard 1, 2 -> Shard 2, 3 -> Shard 3. */
function getShardId(concertId, shardCount = DB_SHARD_COUNT) {
  const num = parseInt(concertId, 10);
  const safeId = Number.isNaN(num) || num < 1 ? 1 : num;
  return ((safeId - 1) % shardCount) + 1;
}

/** Extract shard id embedded in booking codes like HOLD-S2-XXXX or TRX-S3-XXXX. */
function parseShardIdFromCode(code, shardCount = DB_SHARD_COUNT) {
  const m = String(code || '').match(/^[A-Z]+-S(\d+)-/i);
  if (!m) return null;
  const id = parseInt(m[1], 10);
  return id >= 1 && id <= shardCount ? id : null;
}

// Build 1..DB_SHARD_COUNT shard entries (each with Write Primary via PgBouncer + Read Replica)
const shards = {};
for (let id = 1; id <= DB_SHARD_COUNT; id += 1) {
  const writeDbName = process.env[`DB_SHARD${id}_DB`] || DB_NAME;
  const writeHost = process.env[`DB_SHARD${id}_WRITE_HOST`] || DB_HOST;
  const readHost = process.env[`DB_SHARD${id}_READ_HOST`] || (id === 1 ? (process.env.DB_READ_HOST || '') : '');
  const adminHost = process.env[`DB_SHARD${id}_ADMIN_HOST`] || process.env.DB_ADMIN_HOST || writeHost;

  const wPool = createPool({
    host: writeHost,
    port: DB_PORT,
    database: writeDbName,
    user: DB_USER,
    password: DB_PASSWORD,
    max: DB_POOL_MAX,
  });

  const hasReplica = Boolean(readHost && (readHost !== writeHost || DB_READ_PORT !== DB_PORT));
  const rPool = hasReplica
    ? createPool({
        host: readHost,
        port: DB_READ_PORT,
        database: DB_NAME,
        user: DB_READ_USER,
        password: DB_READ_PASSWORD,
        max: DB_READ_POOL_MAX,
      })
    : wPool;

  const shard = {
    id,
    writeHost,
    writeDbName,
    readHost: readHost || writeHost,
    adminHost,
    hasReplica,
    writePool: wPool,
    readPool: rPool,
    writeReady: false,
    readReady: !hasReplica,
  };

  bindPoolErrorHandlers(wPool, () => { shard.writeReady = false; });
  if (hasReplica) {
    bindPoolErrorHandlers(rPool, () => { shard.readReady = false; });
  }
  shards[id] = shard;
}

const shardList = Object.values(shards);
const primaryShard = shards[1];

function getShard(concertId = 1) {
  return shards[getShardId(concertId)] || primaryShard;
}

function getShardWritePool(concertId = 1) {
  return getShard(concertId).writePool;
}

async function checkDbConnection() {
  await Promise.all(
    shardList.map(async (shard) => {
      try {
        const c = await shard.writePool.connect();
        c.release();
        shard.writeReady = true;
      } catch {
        shard.writeReady = false;
      }

      if (shard.hasReplica) {
        try {
          const rc = await shard.readPool.connect();
          rc.release();
          shard.readReady = true;
        } catch {
          shard.readReady = false;
        }
      } else {
        shard.readReady = shard.writeReady;
      }
    })
  );
  return shardList.some((s) => s.writeReady);
}

/** Read-only query routed to the concert's Shard Read Replica, auto-failing over to its Primary. */
async function queryShardRead(concertId, text, params) {
  const shard = getShard(concertId);
  if (shard.hasReplica) {
    try {
      const res = await shard.readPool.query(text, params);
      shard.readReady = true;
      return res;
    } catch (err) {
      shard.readReady = false;
      console.warn(`[Database][Shard ${shard.id}] Read replica fallback to primary: ${err.message}`);
    }
  }
  return shard.writePool.query(text, params);
}

/** Fan-out read query across all shards; tolerates individual shard outages gracefully. */
async function queryAllShardsRead(text, params) {
  const settled = await Promise.allSettled(
    shardList.map(async (shard) => {
      const res = await queryShardRead(shard.id, text, params);
      return { shardId: shard.id, rows: res.rows || [] };
    })
  );
  return settled
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value);
}

async function initSingleShard(shard) {
  const adminClient = new Client({
    host: shard.adminHost,
    port: DB_ADMIN_PORT,
    database: DB_NAME,
    user: DB_ADMIN_USER,
    password: DB_ADMIN_PASSWORD,
    connectionTimeoutMillis: 6000,
    query_timeout: 20000,
  });

  try {
    await adminClient.connect();
    const lockRes = await adminClient.query('SELECT pg_try_advisory_lock(999999) AS acquired');
    if (!lockRes.rows[0].acquired) return true;

    try {
      const checkTable = await adminClient.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'users'
        );
      `);

      if (!checkTable.rows[0].exists) {
        const schemaFile = path.join(__dirname, '..', '..', 'schema.sql');
        const seedFile = path.join(__dirname, '..', '..', 'seed.sql');
        if (fs.existsSync(schemaFile)) {
          await adminClient.query(fs.readFileSync(schemaFile, 'utf8'));
        }
        if (fs.existsSync(seedFile)) {
          await adminClient.query(fs.readFileSync(seedFile, 'utf8'));
        }
        console.log(`[Database][Shard ${shard.id}] Initialized schema.sql & seed.sql on ${shard.adminHost}.`);
      } else {
        await adminClient.query('CREATE INDEX IF NOT EXISTS idx_users_lower_email ON users (LOWER(email))').catch(() => {});
        await adminClient.query("CREATE INDEX IF NOT EXISTS idx_seats_available_id ON seats (concert_id, id) WHERE status = 'Available'").catch(() => {});
        await adminClient.query(`
          ALTER TABLE bookings ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;
          CREATE INDEX IF NOT EXISTS idx_bookings_pending_expires ON bookings(expires_at) WHERE status = 'PENDING';
        `).catch(() => {});
      }

      await adminClient.query(`
        DO $$
        BEGIN
          IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_writer') THEN
            GRANT USAGE ON SCHEMA public TO app_writer;
            GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_writer;
            GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_writer;
          END IF;
          IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_reader') THEN
            GRANT USAGE ON SCHEMA public TO app_reader;
            GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_reader;
          END IF;
        END $$;
      `).catch(() => {});
    } finally {
      await adminClient.query('SELECT pg_advisory_unlock(999999)').catch(() => {});
    }
    return true;
  } catch (err) {
    console.warn(`[Database][Shard ${shard.id}] Init warning: ${err.message}`);
    return false;
  } finally {
    await adminClient.end().catch(() => {});
  }
}

async function initDatabaseSchema(attempt = 1) {
  const results = await Promise.all(shardList.map((s) => initSingleShard(s)));
  await checkDbConnection();
  if (results.some((ok) => !ok) && attempt < 15) {
    setTimeout(() => initDatabaseSchema(attempt + 1), 2500);
  }
}

function getShardsStatus() {
  return shardList.map((s) => ({
    shardId: s.id,
    writePooler: `${s.writeHost}/${s.writeDbName}`,
    primaryHost: s.adminHost,
    primaryStatus: s.writeReady ? 'CONNECTED' : 'RECONNECTING',
    replicaHost: s.readHost,
    replicaStatus: s.readReady ? 'CONNECTED' : 'FALLBACK_PRIMARY',
    writePoolTotal: s.writePool.totalCount,
    readPoolTotal: s.readPool.totalCount,
  }));
}

module.exports = {
  pool: primaryShard.writePool,
  writePool: primaryShard.writePool,
  readPool: primaryShard.readPool,
  shards,
  shardList,
  DB_SHARD_COUNT,
  getShardId,
  parseShardIdFromCode,
  getShard,
  getShardWritePool,
  queryShardRead,
  queryAllShardsRead,
  queryRead: (text, params) => queryShardRead(1, text, params),
  hasDedicatedReplica: shardList.some((s) => s.hasReplica),
  getIsDbReady: () => shardList.some((s) => s.writeReady),
  getIsReadReplicaReady: () => shardList.every((s) => s.readReady),
  getShardsStatus,
  checkDbConnection,
  initDatabaseSchema,
  DB_HOST,
  DB_PORT,
  DB_NAME,
  DB_USER,
  DB_READ_HOST: primaryShard.readHost,
  DB_READ_USER,
};
