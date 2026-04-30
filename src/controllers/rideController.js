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

const normalizeRating = (value) => {
  const numericRating = Number(value);
  if (!Number.isFinite(numericRating)) return null;

  return Math.round(numericRating);
};

const normalizeComment = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 220);
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
const submitRideReview = async (req, res) => {
  try {
    const decoded = getAuthenticatedUser(req);
    if (!decoded) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const rating = normalizeRating(req.body?.rating);
    const comment = normalizeComment(req.body?.comment);

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'Rating must be a number from 1 to 5' });
    }

    const ride = await Ride.findOne({
      _id: req.params.id,
      passengerId: decoded.id,
    }).populate('driverId', 'fullName phoneNumber profileImageUrl vehicle');

    if (!ride) {
      return res.status(404).json({ message: 'Ride not found' });
    }

    if (toCanonicalStatus(ride.status) !== 'COMPLETED') {
      return res.status(400).json({ message: 'Only completed rides can be reviewed' });
    }

    if (ride.review?.status === 'rejected') {
      return res.status(403).json({ message: 'Rejected reviews cannot be edited' });
    }

    ride.review = {
      rating,
      comment,
      status: 'review',
      submittedAt: new Date(),
      reviewedAt: new Date(),
      moderatedAt: null,
    };

    await ride.save();

    return res.status(200).json({
      ride: normalizeRide(ride),
      review: normalizeReview(ride.review, ride._id),
    });
  } catch (error) {
    if (error?.name === 'JsonWebTokenError' || error?.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }
    console.error('[rideController] submitRideReview error:', error);
    return res.status(500).json({ message: error.message || 'Unable to submit review' });
  }
};

const deleteRideReview = async (req, res) => {
  try {
    const decoded = getAuthenticatedUser(req);
    if (!decoded) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const ride = await Ride.findOne({
      _id: req.params.id,
      passengerId: decoded.id,
    }).populate('driverId', 'fullName phoneNumber profileImageUrl vehicle');

    if (!ride) {
      return res.status(404).json({ message: 'Ride not found' });
    }

    ride.review = null;
    await ride.save();

    return res.status(200).json({
      ride: normalizeRide(ride),
      review: null,
      message: 'Review deleted',
    });
  } catch (error) {
    if (error?.name === 'JsonWebTokenError' || error?.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }
    console.error('[rideController] deleteRideReview error:', error);
    return res.status(500).json({ message: error.message || 'Unable to delete review' });
  }
};

const normalizeAdminReview = (ride) => {
  const review = normalizeReview(ride.review, ride._id);
  if (!review) return null;

  return {
    ...review,
    rideId: ride._id.toString(),
    rideStatus: ride.status,
    vehicleType: ride.vehicleType,
    price: ride.price,
    requestedAt: ride.createdAt,
    completedAt: ride.completedAt ?? null,
    passenger: ride.passengerId
      ? {
          id: ride.passengerId._id?.toString?.() ?? ride.passengerId.toString?.() ?? '',
          fullName: ride.passengerId.fullName ?? 'Passenger',
          email: ride.passengerId.email ?? '',
          phoneNumber: ride.passengerId.phoneNumber ?? '',
        }
      : null,
    driver: normalizeDriver(ride.driverId),
  };
};

const listRideReviewsForAdmin = async (req, res) => {
  try {
    const status = String(req.query.status || 'review').toLowerCase();
    const allowedStatuses = ['all', 'review', 'approved', 'rejected'];
    const reviewStatus = allowedStatuses.includes(status) ? status : 'review';

    const query = {
      'review.rating': { $exists: true, $ne: null },
    };

    if (reviewStatus === 'review') {
      query.$or = [
        { 'review.status': 'review' },
        { 'review.status': { $exists: false } },
        { 'review.status': null },
      ];
    } else if (reviewStatus !== 'all') {
      query['review.status'] = reviewStatus;
    }

    const rides = await Ride.find(query)
      .populate('driverId', 'fullName phoneNumber profileImageUrl vehicle')
      .populate('passengerId', 'fullName email phoneNumber')
      .sort({ 'review.submittedAt': -1, 'review.reviewedAt': -1, createdAt: -1 })
      .limit(100)
      .lean();

    return res.status(200).json({
      reviews: rides.map(normalizeAdminReview).filter(Boolean),
    });
  } catch (error) {
    console.error('[rideController] listRideReviewsForAdmin error:', error);
    return res.status(500).json({ message: error.message || 'Unable to load ride reviews' });
  }
};

const moderateRideReview = async (req, res) => {
  try {
    const status = String(req.body?.status || '').toLowerCase();
    if (!['approved', 'rejected', 'review'].includes(status)) {
      return res.status(400).json({ message: 'status must be approved, rejected, or review' });
    }

    const ride = await Ride.findById(req.params.id)
      .populate('driverId', 'fullName phoneNumber profileImageUrl vehicle')
      .populate('passengerId', 'fullName email phoneNumber');

    if (!ride?.review?.rating) {
      return res.status(404).json({ message: 'Review not found' });
    }

    ride.review.status = status;
    ride.review.moderatedAt = new Date();
    await ride.save();

    return res.status(200).json({
      review: normalizeAdminReview(ride),
    });
  } catch (error) {
    console.error('[rideController] moderateRideReview error:', error);
    return res.status(500).json({ message: error.message || 'Unable to update review status' });
  }
};

module.exports = {
  getMyRides,
  getDriverRides,
  getRideById,
  getArrivalCode,
  cancelRide,
  submitRideReview,
  deleteRideReview,
  listRideReviewsForAdmin,
  moderateRideReview,
};
