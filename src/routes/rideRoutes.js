// src/routes/rideRoutes.js
const express = require('express');
const { requireAdmin } = require('../middleware/adminAuth');
const {
  createRide,
  getMyRides,
  getDriverRides,
  getRideById,
  getArrivalCode,
  cancelRide,
  confirmRidePayment,
  listTripsForAdmin,
} = require('../controllers/rideController');
const {
  listRideReviewsForDriver,
  submitRideReview,
  deleteRideReview,
  listRideReviewsForAdmin,
  moderateRideReview,
} = require('../controllers/reviewController');
const {
  getPublicDriverProfile,
  getRidePublicDriverProfile,
} = require('../controllers/driverAuthController');

const router = express.Router();

// POST /api/rides - passenger creates a ride request through REST
router.post('/', createRide);

// GET /api/rides/my-rides - passenger's own ride history
router.get('/my-rides', getMyRides);

// GET /api/rides/driver-rides - driver's assigned rides
router.get('/driver-rides', getDriverRides);

// GET /api/rides/driver-reviews - approved passenger reviews for current driver
router.get('/driver-reviews', listRideReviewsForDriver);

// GET /api/rides/admin/trips - admin system-wide trips and activities
router.get('/admin/trips', requireAdmin, listTripsForAdmin);

// GET /api/rides/admin/reviews - admin review and rating moderation queue
router.get('/admin/reviews', requireAdmin, listRideReviewsForAdmin);

// PATCH /api/rides/admin/reviews/:id - admin approves, rejects, or reopens a ride review
router.patch('/admin/reviews/:id', requireAdmin, moderateRideReview);

// GET /api/rides/drivers/:id/public-profile - public passenger view of driver profile
router.get('/drivers/:id/public-profile', getPublicDriverProfile);

// GET /api/rides/:id/driver-public-profile - public passenger view using the ride's assigned driver
router.get('/:id/driver-public-profile', getRidePublicDriverProfile);

// DELETE /api/rides/:id - passenger deletes their ride
router.delete('/:id', cancelRide);

// GET /api/rides/:id/arrival-code - passenger reads arrival verification code
router.get('/:id/arrival-code', getArrivalCode);

// POST /api/rides/:id/confirm-payment - passenger confirms trip payment
router.post('/:id/confirm-payment', confirmRidePayment);

// PATCH /api/rides/:id/review - passenger adds or updates a completed ride review
router.patch('/:id/review', submitRideReview);

// DELETE /api/rides/:id/review - passenger removes their ride review
router.delete('/:id/review', deleteRideReview);

// POST /api/rides/:id/review/delete - compatibility fallback for clients/proxies that fail DELETE
router.post('/:id/review/delete', deleteRideReview);

// GET /api/rides/:id - single ride detail (keep last to avoid swallowing /my-rides)
router.get('/:id', getRideById);

module.exports = router;
