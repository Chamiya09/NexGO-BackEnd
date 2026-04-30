// src/routes/rideRoutes.js
const express = require('express');
const {
  getMyRides,
  getDriverRides,
  getRideById,
  getArrivalCode,
  cancelRide,
  submitRideReview,
  deleteRideReview,
  listRideReviewsForAdmin,
  moderateRideReview,
} = require('../controllers/rideController');
const {
  getPublicDriverProfile,
  getRidePublicDriverProfile,
} = require('../controllers/driverAuthController');

const router = express.Router();

// GET /api/rides/my-rides - passenger's own ride history
router.get('/my-rides', getMyRides);

// GET /api/rides/driver-rides - driver's assigned rides
router.get('/driver-rides', getDriverRides);

// GET /api/rides/admin/reviews - admin review and rating moderation queue
router.get('/admin/reviews', listRideReviewsForAdmin);

// PATCH /api/rides/admin/reviews/:id - admin approves, rejects, or reopens a ride review
router.patch('/admin/reviews/:id', moderateRideReview);

// GET /api/rides/drivers/:id/public-profile - public passenger view of driver profile
router.get('/drivers/:id/public-profile', getPublicDriverProfile);

// GET /api/rides/:id/driver-public-profile - public passenger view using the ride's assigned driver
router.get('/:id/driver-public-profile', getRidePublicDriverProfile);

// PATCH /api/rides/:id/cancel - passenger cancels their ride
router.patch('/:id/cancel', cancelRide);

// GET /api/rides/:id/arrival-code - passenger reads arrival verification code
router.get('/:id/arrival-code', getArrivalCode);

// PATCH /api/rides/:id/review - passenger adds or updates a completed ride review
router.patch('/:id/review', submitRideReview);

// DELETE /api/rides/:id/review - passenger removes their ride review
router.delete('/:id/review', deleteRideReview);

// GET /api/rides/:id - single ride detail (keep last to avoid swallowing /my-rides)
router.get('/:id', getRideById);

module.exports = router;
