const os = require('os');
const { CONCERTS_CACHE_KEY, mergeRedisSeatLocks } = require('../config/redis');

const CONCERTS_CACHE_TTL_SEC = 10;
const SEATS_CACHE_TTL_SEC = 5;

function getFallbackConcerts() {
  return [
    {
      id: 1,
      title: 'Coldplay - Music of the Spheres World Tour',
      artist: 'Coldplay',
      venue: 'Stadion Utama Gelora Bung Karno (GBK), Jakarta',
      concertDate: '15 Desember 2026, 19:30 WIB',
      price: 1500000,
      totalSeats: 500,
      availableSeats: 496,
      imageUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=1200&q=80',
      servedBy: os.hostname(),
    },
    {
      id: 2,
      title: 'Sheila on 7 - Tunggu Aku Di Jakarta',
      artist: 'Sheila on 7',
      venue: 'JIExpo Kemayoran Open Space, Jakarta',
      concertDate: '20 Januari 2027, 20:00 WIB',
      price: 750000,
      totalSeats: 500,
      availableSeats: 497,
      imageUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1200&q=80',
      servedBy: os.hostname(),
    },
    {
      id: 3,
      title: 'Taylor Swift - The Eras Tour Jakarta',
      artist: 'Taylor Swift',
      venue: 'Jakarta International Stadium (JIS), Jakarta',
      concertDate: '28 Februari 2027, 19:00 WIB',
      price: 2250000,
      totalSeats: 500,
      availableSeats: 496,
      imageUrl: 'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=1200&q=80',
      servedBy: os.hostname(),
    },
  ];
}

function buildFallbackSeats(concertId) {
  const rows = ['A', 'B', 'C', 'D', 'E'];
  const fallbackSeats = [];
  let idCounter = 1;
  for (const r of rows) {
    for (let col = 1; col <= 12; col++) {
      const num = `${r}-${String(col).padStart(2, '0')}`;
      const isPreBooked = (r === 'A' && col === 3) || (r === 'B' && col === 7) || (r === 'C' && col === 5);
      fallbackSeats.push({
        id: idCounter++,
        seatNumber: num,
        category: (r === 'A' || r === 'B') ? 'VIP CAT 1' : 'REGULAR CAT 2',
        status: isPreBooked ? 'Booked' : 'Available',
        price: concertId === 1 ? 1500000 : (concertId === 2 ? 750000 : 2250000),
      });
    }
  }
  return fallbackSeats;
}

function createConcertController({ pool, redis, getDbReady, checkDbConnection, getRedisReady }) {
  async function getConcerts(req, res) {
    try {
      if (getRedisReady()) {
        try {
          const cached = await redis.get(CONCERTS_CACHE_KEY);
          if (cached) {
            const list = JSON.parse(cached).map((c) => ({ ...c, servedBy: os.hostname() }));
            res.set('X-Cache', 'HIT');
            return res.json(list);
          }
        } catch (e) {}
      }

      if (!getDbReady()) await checkDbConnection();

      if (getDbReady()) {
        try {
          const q = await pool.query(`
            SELECT id, title, artist, venue, concert_date, price, total_seats, available_seats, image_url
            FROM concerts
            ORDER BY id ASC
          `);
          if (q.rows.length > 0) {
            const rows = q.rows.map((c) => ({
              id: c.id,
              title: c.title,
              artist: c.artist,
              venue: c.venue,
              concertDate: c.concert_date,
              price: parseFloat(c.price),
              totalSeats: c.total_seats,
              availableSeats: c.available_seats,
              imageUrl: c.image_url,
              servedBy: os.hostname(),
            }));
            if (getRedisReady()) {
              redis.set(CONCERTS_CACHE_KEY, JSON.stringify(rows), 'EX', CONCERTS_CACHE_TTL_SEC).catch(() => {});
            }
            res.set('X-Cache', 'MISS');
            return res.json(rows);
          }
        } catch (dbErr) {}
      }

      res.set('X-Cache', 'FALLBACK');
      return res.json(getFallbackConcerts());
    } catch (err) {
      return res.json(getFallbackConcerts());
    }
  }

  async function getConcertSeats(req, res) {
    const concertId = parseInt(req.params.id, 10) || 1;
    const seatsCacheKey = `cache:concert:${concertId}:seats`;
    res.set('Cache-Control', 'no-store');

    try {
      let baseSeats = null;

      if (getRedisReady()) {
        try {
          const cached = await redis.get(seatsCacheKey);
          if (cached) {
            baseSeats = JSON.parse(cached);
            res.set('X-Cache', 'HIT');
          }
        } catch (e) {}
      }

      if (!baseSeats) {
        if (!getDbReady()) await checkDbConnection();

        if (getDbReady()) {
          try {
            const q = await pool.query(`
              SELECT id, concert_id, seat_number, category, status, price
              FROM seats
              WHERE concert_id = $1 AND seat_number NOT LIKE 'FEST-%'
              ORDER BY seat_number ASC
            `, [concertId]);

            if (q.rows.length > 0) {
              baseSeats = q.rows.map((s) => ({
                id: s.id,
                seatNumber: s.seat_number,
                category: s.category,
                status: s.status,
                price: parseFloat(s.price),
              }));
              if (getRedisReady()) {
                redis.set(seatsCacheKey, JSON.stringify(baseSeats), 'EX', SEATS_CACHE_TTL_SEC).catch(() => {});
              }
              res.set('X-Cache', 'MISS');
            }
          } catch (dbErr) {}
        }
      }

      if (baseSeats) {
        const syncedSeats = await mergeRedisSeatLocks(concertId, baseSeats, redis, getRedisReady());
        return res.json({
          concertId,
          seats: syncedSeats,
          servedBy: os.hostname(),
        });
      }

      return res.json({
        concertId,
        seats: await mergeRedisSeatLocks(concertId, buildFallbackSeats(concertId), redis, getRedisReady()),
        servedBy: os.hostname(),
      });
    } catch (err) {
      return res.json({
        concertId,
        seats: await mergeRedisSeatLocks(concertId, buildFallbackSeats(concertId), redis, getRedisReady()),
        servedBy: os.hostname(),
      });
    }
  }

  return { getConcerts, getConcertSeats };
}

module.exports = { createConcertController };

