const express = require('express');

const { createRateLimiter } = require('../middleware/rateLimiter');

const {
  registerUser,
  loginUser,
  listUsers,
  forgotPassword,
  requestPasswordResetOtp,
  resetPasswordWithOtp,
  getMe,
  updateMe,
  changePassword,
  deleteMe,
  getSavedAddresses,
  addSavedAddress,
  setDefaultSavedAddress,
  deleteSavedAddress,
  getPaymentMethods,
  addPaymentMethod,
  setDefaultPaymentMethod,
} = require('../controllers/authController');

const router = express.Router();

const passwordResetRequestLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 5,
  message: 'Too many password reset requests. Please try again later.',
});

const passwordResetVerifyLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
  message: 'Too many password reset attempts. Please try again later.',
});

router.post('/register', registerUser);
router.post('/login', loginUser);
router.get('/users', listUsers);
router.post('/forgot-password', forgotPassword);
router.post('/forgot-password/request-otp', passwordResetRequestLimiter, requestPasswordResetOtp);
router.post('/forgot-password/reset', passwordResetVerifyLimiter, resetPasswordWithOtp);
router.get('/me', getMe);
router.patch('/me', updateMe);
router.patch('/me/password', changePassword);
router.delete('/me', deleteMe);
router.get('/saved-addresses', getSavedAddresses);
router.post('/saved-addresses', addSavedAddress);
router.patch('/saved-addresses/:addressId/default', setDefaultSavedAddress);
router.delete('/saved-addresses/:addressId', deleteSavedAddress);
router.get('/payment-methods', getPaymentMethods);
router.post('/payment-methods', addPaymentMethod);
router.patch('/payment-methods/:paymentMethodId/default', setDefaultPaymentMethod);

module.exports = router;
