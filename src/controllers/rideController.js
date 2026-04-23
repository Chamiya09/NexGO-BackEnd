// src/controllers/rideController.js
// REST controllers for passenger-facing ride endpoints.

const jwt = require('jsonwebtoken');
const Ride = require('../models/Ride');

// ── Reusable auth helper (same pattern as authController.js) ──────────────────
const getAuthenticatedUser = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  return jwt.verify(token, process.env.JWT_SECRET); // returns decoded payload { id }
};

// ── Normalise a Ride doc for API responses ─────────────────────────────────────
const normalizeRide = (ride) => ({
  id: ride._id.toString(),
  passengerId: ride.passengerId?.toString(),
  driverId: ride.driverId?.toString() ?? null,
  pickup: ride.pickup,
  dropoff: ride.dropoff,
  vehicleType: ride.vehicleType,
  price: ride.price,
  status: ride.status,
  requestedAt: ride.createdAt,
  acceptedAt: ride.acceptedAt ?? null,
  completedAt: ride.completedAt ?? null,
});

// ── GET /api/rides/my-rides ───────────────────────────────────────────────────
// Returns the authenticated passenger's rides, newest first.
const getMyRides = async (req, res) => {
  try {
    const decoded = getAuthenticatedUser(req);
    if (!decoded) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const rides = await Ride.find({ passengerId: decoded.id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return res.status(200).json({
      rides: rides.map(normalizeRide),
    });
  } catch (error) {
    if (error?.name === 'JsonWebTokenError' || error?.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }
    console.error('[rideController] getMyRides error:', error);
    return res.status(500).json({ message: error.message || 'Unable to fetch rides' });
  }
};

// ── GET /api/rides/driver-rides ───────────────────────────────────────────────
// Returns the authenticated driver's assigned rides, newest first.
const getDriverRides = async (req, res) => {
  try {
    const decoded = getAuthenticatedUser(req);
    if (!decoded) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const rides = await Ride.find({ driverId: decoded.id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return res.status(200).json({
      rides: rides.map(normalizeRide),
    });
  } catch (error) {
    if (error?.name === 'JsonWebTokenError' || error?.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }
    console.error('[rideController] getDriverRides error:', error);
    return res.status(500).json({ message: error.message || 'Unable to fetch rides' });
  }
};

// ── GET /api/rides/:id ────────────────────────────────────────────────────────
// Returns a single ride (passenger must own it).
const getRideById = async (req, res) => {
  try {
    const decoded = getAuthenticatedUser(req);
    if (!decoded) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const ride = await Ride.findOne({
      _id: req.params.id,
      passengerId: decoded.id,
    }).lean();

    if (!ride) {
      return res.status(404).json({ message: 'Ride not found' });
    }

    return res.status(200).json({ ride: normalizeRide(ride) });
  } catch (error) {
    if (error?.name === 'JsonWebTokenError' || error?.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }
    console.error('[rideController] getRideById error:', error);
    return res.status(500).json({ message: error.message || 'Unable to fetch ride' });
  }
};

// ── PATCH /api/rides/:id/cancel ───────────────────────────────────
// Passenger cancels their own Pending or Accepted ride.
const cancelRide = async (req, res) => {
  try {
    const decoded = getAuthenticatedUser(req);
    if (!decoded) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const ride = await Ride.findOne({
      _id: req.params.id,
      passengerId: decoded.id,
    });

    if (!ride) {
      return res.status(404).json({ message: 'Ride not found' });
    }

    if (!['Pending', 'Accepted'].includes(ride.status)) {
      return res.status(400).json({
        message: `Cannot cancel a ride with status '${ride.status}'.`,
      });
    }

    ride.status = 'Cancelled';
    ride.cancelledAt = new Date();
    await ride.save();

    return res.status(200).json({ ride: normalizeRide(ride) });
  } catch (error) {
    if (error?.name === 'JsonWebTokenError' || error?.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }
    console.error('[rideController] cancelRide error:', error);
    return res.status(500).json({ message: error.message || 'Unable to cancel ride' });
  }
};

module.exports = { getMyRides, getDriverRides, getRideById, cancelRide };
