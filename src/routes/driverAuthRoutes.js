const express = require('express');

const {
  registerDriver,
  loginDriver,
  getDriverMe,
  listDrivers,
  updateDriverMe,
  updateDriverDocument,
  getDriverVehicle,
  createDriverVehicle,
  updateDriverVehicle,
  deleteDriverVehicle,
  updateDriverSecurity,
  changeDriverPassword,
} = require('../controllers/driverAuthController');

const router = express.Router();

router.post('/register', registerDriver);
router.post('/login', loginDriver);
router.get('/drivers', listDrivers);
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
