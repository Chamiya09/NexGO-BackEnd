const express = require('express');

const {
  changeAdminPassword,
  getAdminProfile,
  getAdminSession,
  loginAdmin,
  updateAdminProfile,
} = require('../controllers/adminController');
const { requireAdmin } = require('../middleware/adminAuth');

const router = express.Router();

router.post('/login', loginAdmin);
router.get('/session', requireAdmin, getAdminSession);
router.get('/profile', requireAdmin, getAdminProfile);
router.patch('/profile', requireAdmin, updateAdminProfile);
router.patch('/profile/password', requireAdmin, changeAdminPassword);

module.exports = router;
