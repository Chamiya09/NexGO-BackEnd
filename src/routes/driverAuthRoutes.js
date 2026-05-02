const express = require('express');

const {
  registerDriver,
  loginDriver,
  getDriverMe,
  getDriverSession,
  getPublicDriverProfile,
  listDrivers,
  updateDriverMe,
  updateDriverDocument,
  reviewDriverDocument,
  updateDriverStatus,
  getDriverVehicle,
  createDriverVehicle,
  updateDriverVehicle,
  deleteDriverVehicle,
  updateDriverSecurity,
  changeDriverPassword,
  logoutDriver,
} = require('../controllers/driverAuthController');
const { requireAdmin } = require('../middleware/adminAuth');

const router = express.Router();

router.post('/register', registerDriver);
router.post('/login', loginDriver);
router.get('/session', getDriverSession);
router.post('/logout', logoutDriver);
router.get('/drivers', requireAdmin, listDrivers);
router.patch('/drivers/:id/documents/:documentType', requireAdmin, reviewDriverDocument);
router.patch('/drivers/:id/status', requireAdmin, updateDriverStatus);
router.get('/drivers/:id/public-profile', getPublicDriverProfile);
router.get('/me', getDriverMe);
router.patch('/me', updateDriverMe);
router.patch('/me/password', changeDriverPassword);
router.get('/me/vehicle', getDriverVehicle);
router.post('/me/vehicle', createDriverVehicle);
router.patch('/me/vehicle', updateDriverVehicle);
router.delete('/me/vehicle', deleteDriverVehicle);
router.patch('/me/documents/:documentType', updateDriverDocument);
router.patch('/me/security', updateDriverSecurity);

module.exports = router;
