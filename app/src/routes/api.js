const express = require('express');
const { requireJwtAuth } = require('../utils/jwt');
const { createBookingController } = require('../controllers/bookingController');
const { createAuthController } = require('../controllers/authController');
const { createQueueController } = require('../controllers/queueController');
const { createConcertController } = require('../controllers/concertController');
const { createTicketController } = require('../controllers/ticketController');

function createApiRouter(deps) {
  const router = express.Router();

  const authController = createAuthController(deps);
  const queueController = createQueueController(deps);
  const concertController = createConcertController(deps);
  const ticketController = createTicketController(deps);
  const bookingController = createBookingController(deps);

  // Authentication
  router.post(['/auth/login', '/login'], authController.login);
  router.get('/auth/session', authController.getSession);
  router.post('/auth/logout', authController.logout);

  // Waiting Room Queue
  router.post('/queue/join', queueController.joinQueue);
  router.get('/queue/status', queueController.getQueueStatus);
  router.post('/queue/leave', queueController.leaveQueue);

  // Concert Catalog & Seats
  router.get('/concerts', concertController.getConcerts);
  router.get('/concerts/:id/seats', concertController.getConcertSeats);

  // Tickets & Transactions
  router.post('/tickets/buy', ticketController.buyTicket);
  router.get('/transactions', ticketController.getTransactions);
  router.post('/tickets/reset', ticketController.resetTickets);

  // Order History (protected by HS256 JWT)
  router.get('/bookings/my-orders', requireJwtAuth, bookingController.getMyOrders);

  // In-cluster Live Stress Test Runner
  router.post('/stress-test/run', bookingController.runLiveStressTest);

  return {
    router,
    ticketController,
  };
}

module.exports = { createApiRouter };
