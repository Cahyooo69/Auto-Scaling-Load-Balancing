const express = require('express');
const os = require('os');
const { attachOptionalJwt, requireJwtAuth, requireAdminOrKey } = require('../utils/jwt');
const { createBookingController } = require('../controllers/bookingController');
const { createAuthController } = require('../controllers/authController');
const { createQueueController } = require('../controllers/queueController');
const { createConcertController } = require('../controllers/concertController');
const { createTicketController } = require('../controllers/ticketController');

const HONEYPOT_URL = (process.env.HONEYPOT_URL || 'http://honeypot:8081').replace(/\/+$/, '');

function createApiRouter(deps) {
  const router = express.Router();

  const authController = createAuthController(deps);
  const queueController = createQueueController(deps);
  const concertController = createConcertController(deps);
  const ticketController = createTicketController(deps);
  const bookingController = createBookingController(deps);

  // Authentication (Stateless Login via Redis Session Store + HS256 JWT)
  router.post(['/auth/login', '/login'], authController.login);
  router.get('/auth/session', authController.getSession);
  router.post('/auth/logout', authController.logout);

  // Waiting Room Queue
  router.post('/queue/join', queueController.joinQueue);
  router.get('/queue/status', queueController.getQueueStatus);
  router.post('/queue/leave', queueController.leaveQueue);

  // Concert Catalog & Seats (Redis Cache -> PostgreSQL Read Replica)
  router.get('/concerts', concertController.getConcerts);
  router.get('/concerts/:id/seats', concertController.getConcertSeats);

  // Tickets & Transactions (2-Step Reserve/Confirm 5-Min TTL + Fast War Checkout)
  router.post('/tickets/reserve', requireJwtAuth, ticketController.reserveTicket);
  router.post('/tickets/confirm', requireJwtAuth, ticketController.confirmBooking);
  router.post('/tickets/buy', attachOptionalJwt, ticketController.buyTicket);
  router.get('/transactions', ticketController.getTransactions);
  router.post('/tickets/reset', requireAdminOrKey, ticketController.resetTickets);

  // Order History (protected by HS256 JWT, reads from Read Replica)
  router.get('/bookings/my-orders', requireJwtAuth, bookingController.getMyOrders);

  // Admin Security & Honeypot Audit Summary (protected by Admin JWT / Key)
  router.get('/admin/security-summary', requireAdminOrKey, async (_req, res) => {
    let honeypot = { reachable: false, totalHits: 0, recentEvents: [] };
    try {
      const hpRes = await fetch(`${HONEYPOT_URL}/internal/events`, { signal: AbortSignal.timeout(2000) });
      if (hpRes.ok) {
        const hpData = await hpRes.json();
        honeypot = { reachable: true, ...hpData };
      }
    } catch {}
    return res.json({
      success: true,
      waf: { enabled: true, exposedPublicPorts: [80, 443] },
      honeypot,
      databaseRoles: {
        writeRole: process.env.DB_WRITE_USER || 'wartiket',
        readRole: process.env.DB_READ_USER || 'wartiket',
        pooler: process.env.DB_WRITE_HOST || process.env.DB_HOST || 'localhost',
        replica: process.env.DB_READ_HOST || (process.env.DB_SHARD1_READ_HOST ? 'db-shard1..3-replica' : 'same-as-primary'),
      },
      servedBy: os.hostname(),
      timestamp: new Date().toISOString(),
    });
  });

  // In-cluster Live Stress Test Runner (Admin-only to prevent public self-DoS)
  router.post('/stress-test/run', requireAdminOrKey, bookingController.runLiveStressTest);

  return {
    router,
    ticketController,
  };
}

module.exports = { createApiRouter };
