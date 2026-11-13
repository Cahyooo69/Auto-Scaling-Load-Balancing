const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = parseInt(process.env.DB_PORT || '5432', 10);
const DB_NAME = process.env.DB_NAME || 'wartiket_db';
const DB_USER = process.env.DB_USER || 'wartiket';
const DB_PASSWORD = process.env.DB_PASSWORD || 'wartiket_secret';
const DB_POOL_MAX = parseInt(process.env.DB_POOL_MAX || '12', 10);

const pool = new Pool({
  host: DB_HOST,
  port: DB_PORT,
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASSWORD,
  max: DB_POOL_MAX,
  idleTimeoutMillis: 15000,
  connectionTimeoutMillis: 3000,
  statement_timeout: 10000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

let isDbReady = false;

pool.on('error', () => {
  isDbReady = false;
});
pool.on('connect', (client) => {
  if (!client._wtErrGuarded) {
    client._wtErrGuarded = true;
    client.on('error', () => {
      isDbReady = false;
    });
  }
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

// Single-leader schema migration using PostgreSQL advisory locks across all Swarm replicas
async function initDatabaseSchema(attempt = 1) {
  try {
    const isConnected = await checkDbConnection();
    if (!isConnected) {
      console.warn(`[Database] PostgreSQL not reachable at ${DB_HOST}:${DB_PORT} (attempt ${attempt}). Retrying in 2.5s...`);
      if (attempt < 15) setTimeout(() => initDatabaseSchema(attempt + 1), 2500);
      return;
    }

    const client = await pool.connect();
    try {
      const lockRes = await client.query('SELECT pg_try_advisory_lock(999999) AS acquired');
      if (!lockRes.rows[0].acquired) {
        console.log('[Database] Schema migration locked by another replica, skipping redundant DDL.');
        return;
      }

      try {
        const checkTable = await client.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name = 'users'
          );
        `);

        if (!checkTable.rows[0].exists) {
          console.log(`[Database] Users table not found. Executing schema.sql & seed.sql...`);
          const schemaFile = path.join(__dirname, '..', '..', 'schema.sql');
          const seedFile = path.join(__dirname, '..', '..', 'seed.sql');

          if (fs.existsSync(schemaFile)) {
            await client.query(fs.readFileSync(schemaFile, 'utf8'));
            console.log(`[Database] schema.sql executed successfully.`);
          }
          if (fs.existsSync(seedFile)) {
            await client.query(fs.readFileSync(seedFile, 'utf8'));
            console.log(`[Database] seed.sql executed successfully.`);
          }
        } else {
          await client.query('CREATE INDEX IF NOT EXISTS idx_users_lower_email ON users (LOWER(email))').catch(() => {});
          await client.query("CREATE INDEX IF NOT EXISTS idx_seats_available_id ON seats (concert_id, id) WHERE status = 'Available'").catch(() => {});
          await client.query(`
            INSERT INTO users (name, email, password, phone, id_card, role)
            VALUES
              ('Admin WarTiket', 'admin@wartiket.id', 'password123', '081100000001', '3171000000000001', 'admin'),
              ('User Penonton', 'user@wartiket.id', 'password123', '081100000002', '3171000000000002', 'user')
            ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role
          `).catch(() => {});
          await client.query(`
            CREATE TABLE IF NOT EXISTS bookings (
              id SERIAL PRIMARY KEY,
              booking_code VARCHAR(64) UNIQUE NOT NULL,
              user_id INT REFERENCES users(id) ON DELETE SET NULL,
              concert_id INT REFERENCES concerts(id) ON DELETE SET NULL,
              total_amount NUMERIC(12,2) NOT NULL,
              status VARCHAR(20) NOT NULL DEFAULT 'PAID' CHECK (status IN ('PAID', 'PENDING', 'EXPIRED')),
              server_instance_id VARCHAR(100) NOT NULL,
              created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS booking_details (
              id SERIAL PRIMARY KEY,
              booking_id INT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
              seat_id INT REFERENCES seats(id) ON DELETE SET NULL,
              seat_number VARCHAR(20) NOT NULL,
              category VARCHAR(30) DEFAULT 'CAT 1',
              price NUMERIC(12,2) NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_bookings_user_created ON bookings(user_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_booking_details_booking ON booking_details(booking_id);
          `).catch(() => {});
          console.log(`[Database] Database already initialized and verified.`);
        }
      } finally {
        await client.query('SELECT pg_advisory_unlock(999999)').catch(() => {});
      }
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn(`[Database] Init verification warning: ${err.message}`);
    if (attempt < 15) setTimeout(() => initDatabaseSchema(attempt + 1), 2500);
  }
}

module.exports = {
  pool,
  getIsDbReady: () => isDbReady,
  checkDbConnection,
  initDatabaseSchema,
  DB_HOST,
  DB_PORT,
  DB_NAME,
};

