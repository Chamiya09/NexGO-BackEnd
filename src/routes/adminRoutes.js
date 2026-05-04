const express = require('express');

const {
  changeAdminPassword,
  createAdmin,
  deleteAdmin,
  getAdminProfile,
  getAdminSession,
  listAdmins,
  loginAdmin,
  updateAdmin,
  updateAdminProfile,
  getDashboardAnalytics,
} = require('../controllers/adminController');
const { requireAdmin } = require('../middleware/adminAuth');

const router = express.Router();

router.post('/login', loginAdmin);
router.get('/dashboard/analytics', requireAdmin, getDashboardAnalytics);
router.get('/session', requireAdmin, getAdminSession);
router.get('/admins', requireAdmin, listAdmins);
router.post('/admins', requireAdmin, createAdmin);
router.patch('/admins/:id', requireAdmin, updateAdmin);
router.delete('/admins/:id', requireAdmin, deleteAdmin);
router.get('/profile', requireAdmin, getAdminProfile);
router.patch('/profile', requireAdmin, updateAdminProfile);
router.patch('/profile/password', requireAdmin, changeAdminPassword);

module.exports = router;
