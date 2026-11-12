const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || 'wartiket-cloud-jwt-secret-2026';

function toBase64Url(input) {
  return Buffer.from(input).toString('base64url');
}

/** Sign an HS256 JWT token without external dependencies. */
function signJwt(payload, expiresInSec = 3600) {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = toBase64Url(JSON.stringify({ ...payload, iat: nowSec, exp: nowSec + expiresInSec }));
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

/** Verify HS256 signature and expiration; returns decoded payload or null. */
function verifyJwt(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, body, sig] = parts;
  const expected = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

function extractJwtFromRequest(req) {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/(?:^|;\s*)wt_jwt=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function requireJwtAuth(req, res, next) {
  const token = extractJwtFromRequest(req);
  const decoded = verifyJwt(token);
  if (!decoded || !decoded.id) {
    return res.status(401).json({
      success: false,
      message: 'Autentikasi JWT diperlukan. Silakan masuk terlebih dahulu.',
    });
  }
  req.authUser = decoded;
  return next();
}

module.exports = {
  signJwt,
  verifyJwt,
  extractJwtFromRequest,
  requireJwtAuth,
};

