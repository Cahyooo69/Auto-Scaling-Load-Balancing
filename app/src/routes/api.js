const express = require('express');
const { requireJwtAuth } = require('../utils/jwt');
const { createBookingController } = require('../controllers/bookingController');

function createApiRouter(deps) {
  const router = express.Router();
  const bookingController = createBookingController(deps);

  // Order History endpoint protected by HS256 JWT
  router.get('/bookings/my-orders', requireJwtAuth, bookingController.getMyOrders);

  // In-cluster concurrency burst runner for Live Stress Test UI
  router.post('/stress-test/run', bookingController.runLiveStressTest);

  return router;
}

module.exports = { createApiRouter };

