const express = require('express');

const {
  registerUser,
  loginUser,
  getMe,
  getPaymentMethods,
  addPaymentMethod,
} = require('../controllers/authController');

const router = express.Router();

router.post('/register', registerUser);
router.post('/login', loginUser);
router.get('/me', getMe);
router.get('/payment-methods', getPaymentMethods);
router.post('/payment-methods', addPaymentMethod);

module.exports = router;
