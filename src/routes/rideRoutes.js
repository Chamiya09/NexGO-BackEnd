// src/routes/rideRoutes.js
const express = require('express');
const { getMyRides, getRideById } = require('../controllers/rideController');

const router = express.Router();

// GET /api/rides/my-rides  — passenger's own ride history
router.get('/my-rides', getMyRides);

// GET /api/rides/:id       — single ride detail
router.get('/:id', getRideById);

module.exports = router;
