// src/routes/reviewRoutes.js
// Separate review CRUD API routes.

const express = require('express');

const { requireAdmin } = require('../middleware/adminAuth');
const {
  submitRideReview,
  listRideReviewsForDriver,
  listRideReviewsForAdmin,
  moderateRideReview,
  deleteRideReview,
} = require('../controllers/reviewController');

const router = express.Router();

// CREATE / UPDATE: passenger creates or updates a completed ride review
router.post('/rides/:id', submitRideReview);
router.patch('/rides/:id', submitRideReview);

// READ: approved reviews for authenticated driver
router.get('/driver-reviews', listRideReviewsForDriver);

// READ: admin moderation queue
router.get('/admin', requireAdmin, listRideReviewsForAdmin);

// UPDATE: admin approves, rejects, or reopens a review
router.patch('/admin/:id', requireAdmin, moderateRideReview);

// DELETE: passenger removes their review
router.delete('/rides/:id', deleteRideReview);

// DELETE fallback for clients/proxies that fail DELETE
router.post('/rides/:id/delete', deleteRideReview);

module.exports = router;
