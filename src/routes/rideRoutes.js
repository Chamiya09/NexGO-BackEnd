// src/routes/rideRoutes.js
const express = require('express');
const { getMyRides, getDriverRides, getRideById, cancelRide } = require('../controllers/rideController');

const router = express.Router();

// GET  /api/rides/my-rides  — passenger's own ride history
router.get('/my-rides', getMyRides);

// GET  /api/rides/driver-rides — driver's assigned rides
router.get('/driver-rides', getDriverRides);

// PATCH /api/rides/:id/cancel — passenger cancels their ride
router.patch('/:id/cancel', cancelRide);

// GET  /api/rides/:id       — single ride detail (keep last to avoid swallowing /my-rides)
router.get('/:id', getRideById);

module.exports = router;

