// src/controllers/rideController.js
// REST controllers for passenger-facing ride endpoints.

const jwt = require('jsonwebtoken');
const Ride = require('../models/Ride');
const { emitRemoveRideRequest } = require('../sockets/rideSocket');
const {
  toCanonicalStatus,
  RIDE_STATUS,
} = require('../services/rideLifecycleService');

// ── Reusable auth helper (same pattern as authController.js) ──────────────────
const getAuthenticatedUser = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  return jwt.verify(token, process.env.JWT_SECRET); // returns decoded payload { id }
};

// ── Normalise a Ride doc for API responses ─────────────────────────────────────
const normalizeDriver = (driver) => {
  if (!driver || typeof driver !== 'object') return null;

  return {
    id: driver._id?.toString?.() ?? driver.toString?.() ?? null,
    fullName: driver.fullName ?? '',
    phoneNumber: driver.phoneNumber ?? '',
    profileImageUrl: driver.profileImageUrl ?? '',
    vehicle: driver.vehicle
      ? {
          make: driver.vehicle.make ?? '',
          model: driver.vehicle.model ?? '',
          plateNumber: driver.vehicle.plateNumber ?? '',
          color: driver.vehicle.color ?? '',
          category: driver.vehicle.category ?? '',
        }
      : null,
  };
};

const normalizePassenger = (passenger) => {
  if (!passenger || typeof passenger !== 'object') return null;

  return {
    id: passenger._id?.toString?.() ?? passenger.toString?.() ?? null,
    fullName: passenger.fullName ?? '',
    email: passenger.email ?? '',
    phoneNumber: passenger.phoneNumber ?? '',
    profileImageUrl: passenger.profileImageUrl ?? '',
  };
};

const normalizeReview = (review, rideId) => {
  if (!review || !review.rating) return null;

  return {
    rideId: rideId?.toString?.() ?? '',
    rating: review.rating,
    comment: review.comment ?? '',
    status: review.status ?? 'review',
    submittedAt: review.submittedAt ?? review.reviewedAt ?? null,
    reviewedAt: review.reviewedAt ?? null,
    moderatedAt: review.moderatedAt ?? null,
    updatedAt: review.reviewedAt ?? null,
  };
};

const normalizeRide = (ride) => {
  const driver = normalizeDriver(ride.driverId);
  const passenger = normalizePassenger(ride.passengerId);

  return {
    id: ride._id.toString(),
    passengerId: passenger?.id ?? ride.passengerId?.toString?.(),
    passenger,
    driverId: driver?.id ?? ride.driverId?.toString?.() ?? null,
    driver,
    pickup: ride.pickup,
    dropoff: ride.dropoff,
    vehicleType: ride.vehicleType,
    price: ride.price,
    promotion: ride.promotion?.promotionId
      ? {
          id: ride.promotion.promotionId?.toString?.() ?? null,
          code: ride.promotion.code ?? '',
          discountType: ride.promotion.discountType ?? null,
          discountValue: ride.promotion.discountValue ?? 0,
          discountAmount: ride.promotion.discountAmount ?? 0,
          originalPrice: ride.promotion.originalPrice ?? 0,
        }
      : null,
    status: ride.status,
    canonicalStatus: toCanonicalStatus(ride.status),
    requestedAt: ride.createdAt,
    acceptedAt: ride.acceptedAt ?? null,
    completedAt: ride.completedAt ?? null,
    review: normalizeReview(ride.review, ride._id),
  };
};

// ── GET /api/rides/my-rides ───────────────────────────────────────────────────
// Returns the authenticated passenger's rides, newest first.
const getMyRides = async (req, res) => {
  try {
    const decoded = getAuthenticatedUser(req);
    if (!decoded) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const rides = await Ride.find({ passengerId: decoded.id })
      .populate('driverId', 'fullName phoneNumber profileImageUrl vehicle')
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
      .populate('driverId', 'fullName phoneNumber profileImageUrl vehicle')
      .populate('passengerId', 'fullName email phoneNumber profileImageUrl')
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

// ── GET /api/rides/driver-reviews ─────────────────────────────────────────────
// Returns approved passenger reviews for the authenticated driver.
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
    })
      .populate('driverId', 'fullName phoneNumber profileImageUrl vehicle')
      .lean();

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
const getArrivalCode = async (req, res) => {
  try {
    const decoded = getAuthenticatedUser(req);
    if (!decoded) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const ride = await Ride.findOne({
      _id: req.params.id,
      passengerId: decoded.id,
    }).select('arrivalVerificationCode arrivalVerificationExpiresAt status');

    if (!ride) {
      return res.status(404).json({ message: 'Ride not found' });
    }

    const expiresAt = ride.arrivalVerificationExpiresAt?.getTime?.() ?? 0;
    if (!ride.arrivalVerificationCode || expiresAt <= Date.now()) {
      return res.status(200).json({ code: null });
    }

    return res.status(200).json({
      code: ride.arrivalVerificationCode,
      expiresAt: ride.arrivalVerificationExpiresAt,
      status: ride.status,
    });
  } catch (error) {
    if (error?.name === 'JsonWebTokenError' || error?.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }
    console.error('[rideController] getArrivalCode error:', error);
    return res.status(500).json({ message: error.message || 'Unable to fetch arrival code' });
  }
};

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

    if (![RIDE_STATUS.PENDING, RIDE_STATUS.ACCEPTED].includes(ride.status)) {
      return res.status(400).json({
        message: `Cannot cancel a ride with status '${ride.status}'.`,
      });
    }

    ride.status = 'Cancelled';
    ride.cancelledAt = new Date();
    await ride.save();

    const io = req.app.get('io');
    if (io) {
      emitRemoveRideRequest(io, ride._id.toString(), { reason: 'cancelled' });
    }

    return res.status(200).json({ ride: normalizeRide(ride) });
  } catch (error) {
    if (error?.name === 'JsonWebTokenError' || error?.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }
    console.error('[rideController] cancelRide error:', error);
    return res.status(500).json({ message: error.message || 'Unable to cancel ride' });
  }
};

// ── PATCH /api/rides/:id/review ──────────────────────────────────────────────
// Passenger adds or updates their review for a completed ride.
const listTripsForAdmin = async (_req, res) => {
  try {
    const rides = await Ride.find()
      .populate('driverId', 'fullName phoneNumber profileImageUrl vehicle')
      .populate('passengerId', 'fullName email phoneNumber profileImageUrl')
      .sort({ createdAt: -1 })
      .limit(150)
      .lean();

    return res.status(200).json({
      trips: rides.map(normalizeRide),
    });
  } catch (error) {
    console.error('[rideController] listTripsForAdmin error:', error);
    return res.status(500).json({ message: error.message || 'Unable to load trips' });
  }
};

module.exports = {
  getMyRides,
  getDriverRides,
  getRideById,
  getArrivalCode,
  cancelRide,
  listTripsForAdmin,
};
