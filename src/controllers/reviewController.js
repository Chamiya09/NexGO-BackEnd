// src/controllers/reviewController.js
// Separate CRUD controllers for ride reviews.

const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const Ride = require('../models/Ride');
const Review = require('../models/Review');
const { toCanonicalStatus } = require('../services/rideLifecycleService');

const getAuthenticatedUser = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.split(' ')[1];
  return jwt.verify(token, process.env.JWT_SECRET);
};

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
    id: review._id?.toString?.() ?? undefined,
    rideId: review.rideId?.toString?.() ?? rideId?.toString?.() ?? '',
    rating: review.rating,
    comment: review.comment ?? '',
    status: review.status ?? 'review',
    submittedAt: review.submittedAt ?? review.reviewedAt ?? null,
    reviewedAt: review.reviewedAt ?? null,
    moderatedAt: review.moderatedAt ?? null,
    updatedAt: review.reviewedAt ?? null,
  };
};

const normalizeRideForReview = (ride, review = ride?.review) => {
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
    status: ride.status,
    requestedAt: ride.createdAt,
    completedAt: ride.completedAt ?? null,
    review: normalizeReview(review, ride._id),
  };
};

const buildRideWithReviewRefs = (review) => {
  if (!review?.rideId) return null;

  return {
    ...review.rideId,
    passengerId: review.passengerId ?? review.rideId.passengerId,
    driverId: review.driverId ?? review.rideId.driverId,
  };
};

const normalizeAdminReview = (review) => {
  const ride = review.rideId;
  const normalizedReview = normalizeReview(review, ride?._id ?? review.rideId);
  if (!normalizedReview) return null;

  return {
    ...normalizedReview,
    rideId: ride?._id?.toString?.() ?? review.rideId?.toString?.() ?? '',
    rideStatus: ride?.status ?? '',
    vehicleType: ride?.vehicleType ?? '',
    price: ride?.price ?? 0,
    requestedAt: ride?.createdAt ?? null,
    completedAt: ride?.completedAt ?? null,
    passenger: normalizePassenger(review.passengerId),
    driver: normalizeDriver(review.driverId),
  };
};

const syncRideReview = async (ride, review) => {
  ride.review = review
    ? {
        rating: review.rating,
        comment: review.comment,
        status: review.status,
        submittedAt: review.submittedAt,
        reviewedAt: review.reviewedAt,
        moderatedAt: review.moderatedAt,
      }
    : null;

  await ride.save();
};

const buildReviewQueryById = (id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return null;
  }

  return {
    $or: [{ _id: id }, { rideId: id }],
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

// CREATE/UPDATE: passenger creates or updates a review for a completed ride.
// PATCH/POST /api/reviews/rides/:id
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
    })
      .populate('driverId', 'fullName phoneNumber profileImageUrl vehicle')
      .populate('passengerId', 'fullName email phoneNumber profileImageUrl');

    if (!ride) {
      return res.status(404).json({ message: 'Ride not found' });
    }

    if (toCanonicalStatus(ride.status) !== 'COMPLETED') {
      return res.status(400).json({ message: 'Only completed rides can be reviewed' });
    }

    const existingReview = await Review.findOne({ rideId: ride._id });

    if (existingReview?.status === 'rejected' || ride.review?.status === 'rejected') {
      return res.status(403).json({ message: 'Rejected reviews cannot be edited' });
    }

    const review = await Review.findOneAndUpdate(
      { rideId: ride._id },
      {
        rideId: ride._id,
        passengerId: ride.passengerId?._id ?? ride.passengerId,
        driverId: ride.driverId?._id ?? ride.driverId,
        rating,
        comment,
        status: 'review',
        submittedAt: new Date(),
        reviewedAt: new Date(),
        moderatedAt: null,
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );

    await syncRideReview(ride, review);

    return res.status(200).json({
      ride: normalizeRideForReview(ride, review),
      review: normalizeReview(review, ride._id),
    });
  } catch (error) {
    if (error?.name === 'JsonWebTokenError' || error?.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }
    console.error('[reviewController] submitRideReview error:', error);
    return res.status(500).json({ message: error.message || 'Unable to submit review' });
  }
};

// READ: approved reviews for the authenticated driver.
// GET /api/reviews/driver-reviews
const listRideReviewsForDriver = async (req, res) => {
  try {
    const decoded = getAuthenticatedUser(req);
    if (!decoded) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const reviews = await Review.find({
      driverId: decoded.id,
      status: 'approved',
    })
      .populate('rideId')
      .populate('driverId', 'fullName phoneNumber profileImageUrl vehicle')
      .populate('passengerId', 'fullName email phoneNumber profileImageUrl')
      .sort({ submittedAt: -1, reviewedAt: -1, createdAt: -1 })
      .limit(100)
      .lean();

    return res.status(200).json({
      reviews: reviews
        .filter((review) => review.rideId)
        .map((review) => normalizeRideForReview(buildRideWithReviewRefs(review), review)),
    });
  } catch (error) {
    if (error?.name === 'JsonWebTokenError' || error?.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }
    console.error('[reviewController] listRideReviewsForDriver error:', error);
    return res.status(500).json({ message: error.message || 'Unable to fetch driver reviews' });
  }
};

// READ: admin review queue.
// GET /api/reviews/admin?status=review|approved|rejected|all
const listRideReviewsForAdmin = async (req, res) => {
  try {
    const status = String(req.query.status || 'review').toLowerCase();
    const allowedStatuses = ['all', 'review', 'approved', 'rejected'];
    const reviewStatus = allowedStatuses.includes(status) ? status : 'review';

    const query = {};

    if (reviewStatus === 'review') {
      query.$or = [
        { status: 'review' },
        { status: { $exists: false } },
        { status: null },
      ];
    } else if (reviewStatus !== 'all') {
      query.status = reviewStatus;
    }

    const reviews = await Review.find(query)
      .populate('rideId')
      .populate('driverId', 'fullName phoneNumber profileImageUrl vehicle')
      .populate('passengerId', 'fullName email phoneNumber profileImageUrl')
      .sort({ submittedAt: -1, reviewedAt: -1, createdAt: -1 })
      .limit(100)
      .lean();

    return res.status(200).json({
      reviews: reviews.map(normalizeAdminReview).filter(Boolean),
    });
  } catch (error) {
    console.error('[reviewController] listRideReviewsForAdmin error:', error);
    return res.status(500).json({ message: error.message || 'Unable to load ride reviews' });
  }
};

// UPDATE: admin approves, rejects, or reopens a review.
// PATCH /api/reviews/admin/:id
const moderateRideReview = async (req, res) => {
  try {
    const status = String(req.body?.status || '').toLowerCase();
    if (!['approved', 'rejected', 'review'].includes(status)) {
      return res.status(400).json({ message: 'status must be approved, rejected, or review' });
    }

    const reviewQuery = buildReviewQueryById(req.params.id);
    if (!reviewQuery) {
      return res.status(400).json({ message: 'Invalid review id' });
    }

    let review = await Review.findOne(reviewQuery)
      .populate('rideId')
      .populate('driverId', 'fullName phoneNumber profileImageUrl vehicle')
      .populate('passengerId', 'fullName email phoneNumber profileImageUrl');

    if (!review) {
      const ride = await Ride.findById(req.params.id);
      if (!ride?.review?.rating) {
        return res.status(404).json({ message: 'Review not found' });
      }

      review = await Review.create({
        rideId: ride._id,
        passengerId: ride.passengerId,
        driverId: ride.driverId,
        rating: ride.review.rating,
        comment: ride.review.comment,
        status: ride.review.status ?? 'review',
        submittedAt: ride.review.submittedAt ?? ride.review.reviewedAt ?? new Date(),
        reviewedAt: ride.review.reviewedAt ?? new Date(),
        moderatedAt: ride.review.moderatedAt ?? null,
      });

      review = await Review.findById(review._id)
        .populate('rideId')
        .populate('driverId', 'fullName phoneNumber profileImageUrl vehicle')
        .populate('passengerId', 'fullName email phoneNumber profileImageUrl');
    }

    if (!review?.rating) {
      return res.status(404).json({ message: 'Review not found' });
    }

    review.status = status;
    review.moderatedAt = new Date();
    await review.save();

    const ride = await Ride.findById(review.rideId?._id ?? review.rideId)
      .populate('driverId', 'fullName phoneNumber profileImageUrl vehicle')
      .populate('passengerId', 'fullName email phoneNumber profileImageUrl');

    if (ride) {
      await syncRideReview(ride, review);
      review.rideId = ride;
    }

    return res.status(200).json({
      review: normalizeAdminReview(review),
    });
  } catch (error) {
    console.error('[reviewController] moderateRideReview error:', error);
    return res.status(500).json({ message: error.message || 'Unable to update review status' });
  }
};

// DELETE: passenger removes their ride review.
// DELETE /api/reviews/rides/:id
const deleteRideReview = async (req, res) => {
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
      .populate('passengerId', 'fullName email phoneNumber profileImageUrl');

    if (!ride) {
      return res.status(404).json({ message: 'Ride not found' });
    }

    await Review.deleteOne({ rideId: ride._id });
    await syncRideReview(ride, null);

    return res.status(200).json({
      ride: normalizeRideForReview(ride),
      review: null,
      message: 'Review deleted',
    });
  } catch (error) {
    if (error?.name === 'JsonWebTokenError' || error?.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }
    console.error('[reviewController] deleteRideReview error:', error);
    return res.status(500).json({ message: error.message || 'Unable to delete review' });
  }
};

module.exports = {
  submitRideReview,
  listRideReviewsForDriver,
  listRideReviewsForAdmin,
  moderateRideReview,
  deleteRideReview,
};
