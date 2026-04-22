const express = require('express');

const {
  registerUser,
  loginUser,
  getMe,
  updateMe,
  deleteMe,
  getPaymentMethods,
  addPaymentMethod,
  setDefaultPaymentMethod,
} = require('../controllers/authController');

const router = express.Router();

router.post('/register', registerUser);
router.post('/login', loginUser);
router.get('/me', getMe);
router.patch('/me', updateMe);
router.delete('/me', deleteMe);
router.get('/payment-methods', getPaymentMethods);
router.post('/payment-methods', addPaymentMethod);
router.patch('/payment-methods/:paymentMethodId/default', setDefaultPaymentMethod);

module.exports = router;
