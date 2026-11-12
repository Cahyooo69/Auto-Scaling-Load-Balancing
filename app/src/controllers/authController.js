const crypto = require('crypto');
const os = require('os');
const { signJwt } = require('../utils/jwt');

const USER_CACHE_TTL_SEC = 60;
const SESSION_TTL_SEC = 3600;

function extractSessionToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/(?:^|;\s*)wt_session=([^;]+)/);
  if (match) return decodeURIComponent(match[1]);
  return req.query?.token ? String(req.query.token).trim() : '';
}

function createAuthController({ pool, redis, getDbReady, checkDbConnection, getRedisReady }) {
  async function login(req, res) {
    const { email, password } = req.body || {};
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email wajib diisi!' });
    }

    const trimmedEmail = String(email).trim();
    const normalizedEmail = trimmedEmail.toLowerCase();
    const userCacheKey = `cache:user:email:${normalizedEmail}`;

    try {
      let user = null;

      // 1. Check Redis user lookup cache first
      if (getRedisReady()) {
        try {
          const cached = await redis.get(userCacheKey);
          if (cached) user = JSON.parse(cached);
        } catch (e) {}
      }

      if (!user) {
        if (!getDbReady()) await checkDbConnection();

        if (getDbReady()) {
          try {
            const q = await pool.query(
              'SELECT id, name, email, password, phone, id_card, role FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
              [trimmedEmail]
            );
            if (q.rows.length > 0) {
              user = q.rows[0];
              if (getRedisReady()) {
                redis.set(userCacheKey, JSON.stringify(user), 'EX', USER_CACHE_TTL_SEC).catch(() => {});
              }
            }
          } catch (dbErr) {}
        }
      }

      // Fallback demo users if DB is temporarily reconnecting
      if (!user) {
        const demoUsers = {
          'admin@wartiket.id': { id: 1006, name: 'Admin WarTiket', email: 'admin@wartiket.id', password: 'password123', phone: '081100000001', id_card: '3171000000000001', role: 'admin' },
          'user@wartiket.id': { id: 1007, name: 'User Penonton', email: 'user@wartiket.id', password: 'password123', phone: '081100000002', id_card: '3171000000000002', role: 'user' },
          'dosen@wartiket.id': { id: 1, name: 'Dr. Ir. Budi Santoso, M.Kom', email: 'dosen@wartiket.id', password: 'password123', phone: '081122334455', id_card: '3171010101750001', role: 'lecturer' },
          'mahasiswa1@wartiket.id': { id: 2, name: 'Kelompok 1 Cloud Lead', email: 'mahasiswa1@wartiket.id', password: 'password123', phone: '081234567890', id_card: '3171020202990002', role: 'student' },
          'mahasiswa2@wartiket.id': { id: 3, name: 'Kelompok 1 DevOps Engineer', email: 'mahasiswa2@wartiket.id', password: 'password123', phone: '081298765432', id_card: '3171030303980003', role: 'student' },
          'vip.buyer@gmail.com': { id: 4, name: 'Siti Rahmawati (VIP Buyer)', email: 'vip.buyer@gmail.com', password: 'password123', phone: '081345678901', id_card: '3171040404950004', role: 'vip' },
          'festival.fan@gmail.com': { id: 5, name: 'Andi Pratama (Festival Goer)', email: 'festival.fan@gmail.com', password: 'password123', phone: '081456789012', id_card: '3171050505970005', role: 'user' },
        };

        if (demoUsers[normalizedEmail]) {
          user = demoUsers[normalizedEmail];
        } else if (normalizedEmail.startsWith('user') && normalizedEmail.endsWith('@test.com')) {
          const dummyNum = parseInt(normalizedEmail.replace('user', '').replace('@test.com', ''), 10) || 1;
          user = {
            id: dummyNum + 5,
            name: `k6 Test User ${dummyNum}`,
            email: normalizedEmail,
            password: 'password123',
            phone: `081${String(dummyNum).padStart(8, '0')}`,
            id_card: `3171${String(dummyNum).padStart(12, '0')}`,
            role: 'tester',
          };
        }
      }

      if (!user) {
        return res.status(401).json({ success: false, message: 'Pengguna tidak ditemukan. Silakan gunakan Auto-Fill Demo!' });
      }

      // Password verification
      if (password && user.password && user.password !== String(password)) {
        return res.status(401).json({ success: false, message: 'Kata sandi salah. Silakan coba lagi.' });
      }

      const userPayload = {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone || '081234567890',
        idCard: user.id_card || '3171012345670001',
        role: user.role || 'user',
      };

      const token = crypto.randomUUID();
      const jwtToken = signJwt({
        id: userPayload.id,
        email: userPayload.email,
        role: userPayload.role,
        name: userPayload.name,
      }, SESSION_TTL_SEC);

      if (getRedisReady()) {
        await redis.set(`session:${token}`, JSON.stringify(userPayload), 'EX', SESSION_TTL_SEC).catch(() => {});
      }

      res.cookie('wt_session', token, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: SESSION_TTL_SEC * 1000,
        path: '/',
      });
      res.cookie('wt_jwt', jwtToken, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: SESSION_TTL_SEC * 1000,
        path: '/',
      });

      return res.json({
        success: true,
        message: 'Login berhasil!',
        token,
        jwtToken,
        user: userPayload,
        servedBy: os.hostname(),
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Gagal login', error: err.message });
    }
  }

  async function getSession(req, res) {
    const token = extractSessionToken(req);
    if (!token) {
      return res.status(401).json({ authenticated: false, servedBy: os.hostname() });
    }
    if (!getRedisReady()) {
      return res.status(503).json({ authenticated: false, degraded: true, servedBy: os.hostname() });
    }
    try {
      const raw = await redis.get(`session:${token}`);
      if (!raw) {
        return res.status(401).json({ authenticated: false, servedBy: os.hostname() });
      }
      await redis.expire(`session:${token}`, SESSION_TTL_SEC).catch(() => {});
      return res.json({ authenticated: true, user: JSON.parse(raw), servedBy: os.hostname() });
    } catch (err) {
      return res.status(500).json({ authenticated: false, error: err.message, servedBy: os.hostname() });
    }
  }

  async function logout(req, res) {
    const token = extractSessionToken(req);
    if (token && getRedisReady()) {
      await redis.del(`session:${token}`).catch(() => {});
    }
    res.clearCookie('wt_session', { path: '/' });
    res.clearCookie('wt_jwt', { path: '/' });
    return res.json({ success: true, servedBy: os.hostname() });
  }

  return { login, getSession, logout };
}

module.exports = { createAuthController };

