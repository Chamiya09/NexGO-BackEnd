const express = require('express');

const {
  registerUser,
  loginUser,
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

router.post('/register', registerUser);
router.post('/login', loginUser);
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
