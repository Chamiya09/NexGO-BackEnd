const express = require('express');

const {
  registerDriver,
  loginDriver,
  getDriverMe,
  updateDriverMe,
  updateDriverDocument,
  updateDriverSecurity,
  changeDriverPassword,
} = require('../controllers/driverAuthController');

const router = express.Router();

router.post('/register', registerDriver);
router.post('/login', loginDriver);
router.get('/me', getDriverMe);
router.patch('/me', updateDriverMe);
router.patch('/me/password', changeDriverPassword);
router.patch('/me/documents/:documentType', updateDriverDocument);
router.patch('/me/security', updateDriverSecurity);

module.exports = router;
