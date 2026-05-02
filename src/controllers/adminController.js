const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const Admin = require('../models/Admin');

const DEFAULT_ADMIN_EMAIL = 'admin@nexgo.lk';
const DEFAULT_ADMIN_PASSWORD = 'admin123';

const normalizeAdmin = (admin) => ({
  id: admin._id.toString(),
  fullName: admin.fullName,
  email: admin.email,
  phoneNumber: admin.phoneNumber || '',
  profileImageUrl: admin.profileImageUrl || '',
  role: admin.role || 'Operations Admin',
  scope: admin.scope || 'NexGO Control Center',
  office: admin.office || 'Colombo HQ',
  shift: admin.shift || 'Full operations coverage',
});

const signAdminToken = (admin) =>
  jwt.sign(
    { id: admin._id.toString(), role: 'admin', email: admin.email },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

const ensureDefaultAdmin = async () => {
  const adminEmail = String(process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
  let admin = await Admin.findOne({ email: adminEmail });

  if (admin) {
    return admin;
  }

  const password = String(process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD);
  const hashedPassword = await bcrypt.hash(password, 10);

  admin = await Admin.create({
    fullName: process.env.ADMIN_FULL_NAME || 'NexGO Operations Admin',
    email: adminEmail,
    phoneNumber: process.env.ADMIN_PHONE_NUMBER || '+94 77 000 0000',
    profileImageUrl: process.env.ADMIN_PROFILE_IMAGE_URL || '',
    password: hashedPassword,
    role: process.env.ADMIN_ROLE || 'Operations Admin',
    scope: process.env.ADMIN_SCOPE || 'NexGO Control Center',
    office: process.env.ADMIN_OFFICE || 'Colombo HQ',
    shift: process.env.ADMIN_SHIFT || 'Full operations coverage',
  });

  return admin;
};

const loginAdmin = async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    await ensureDefaultAdmin();
    const admin = await Admin.findOne({ email });
    if (!admin) {
      return res.status(401).json({ message: 'Invalid admin credentials' });
    }

    const isPasswordValid = await bcrypt.compare(password, admin.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid admin credentials' });
    }

    return res.status(200).json({
      message: 'Admin login successful',
      token: signAdminToken(admin),
      admin: normalizeAdmin(admin),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Unable to login admin' });
  }
};

const getAdminSession = async (req, res) => {
  return res.status(200).json({ admin: normalizeAdmin(req.admin) });
};

const getAdminProfile = async (req, res) => {
  return res.status(200).json({ adminProfile: normalizeAdmin(req.admin) });
};

const updateAdminProfile = async (req, res) => {
  try {
    const fullName = String(req.body.fullName || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const phoneNumber = String(req.body.phoneNumber || '').trim();
    const profileImageUrl = String(req.body.profileImageUrl || '').trim();
    const role = String(req.body.role || req.admin.role || '').trim();
    const scope = String(req.body.scope || req.admin.scope || '').trim();
    const office = String(req.body.office || req.admin.office || '').trim();
    const shift = String(req.body.shift || req.admin.shift || '').trim();

    if (!fullName || !email) {
      return res.status(400).json({ message: 'Full name and email are required' });
    }

    const existingAdmin = await Admin.findOne({ email, _id: { $ne: req.admin._id } });
    if (existingAdmin) {
      return res.status(409).json({ message: 'Email is already used by another admin' });
    }

    req.admin.fullName = fullName;
    req.admin.email = email;
    req.admin.phoneNumber = phoneNumber;
    req.admin.profileImageUrl = profileImageUrl;
    req.admin.role = role || 'Operations Admin';
    req.admin.scope = scope || 'NexGO Control Center';
    req.admin.office = office || 'Colombo HQ';
    req.admin.shift = shift || 'Full operations coverage';
    await req.admin.save();

    return res.status(200).json({ adminProfile: normalizeAdmin(req.admin) });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Unable to update admin profile' });
  }
};

const changeAdminPassword = async (req, res) => {
  try {
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');
    const confirmNewPassword = String(req.body.confirmNewPassword || '');

    if (!currentPassword || !newPassword || !confirmNewPassword) {
      return res.status(400).json({ message: 'All password fields are required' });
    }

    if (newPassword !== confirmNewPassword) {
      return res.status(400).json({ message: 'New passwords do not match' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }

    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, req.admin.password);
    if (!isCurrentPasswordValid) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }

    req.admin.password = await bcrypt.hash(newPassword, 10);
    await req.admin.save();

    return res.status(200).json({ message: 'Admin password updated' });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Unable to update admin password' });
  }
};

module.exports = {
  loginAdmin,
  getAdminSession,
  getAdminProfile,
  updateAdminProfile,
  changeAdminPassword,
};

const Ride = require('../models/Ride');

const getDashboardAnalytics = async (req, res) => {
  try {
    const rides = await Ride.find({});
    
    let totalRevenue = 0;
    let activeRides = 0;
    let cancelledRides = 0;
    let totalWaitTime = 0;
    let waitTimeCount = 0;

    rides.forEach(ride => {
      if (ride.status === 'Completed') {
        totalRevenue += (ride.fare || 0);
      }
      if (['Pending', 'Accepted', 'Arrived', 'InProgress'].includes(ride.status)) {
        activeRides++;
      }
      if (ride.status === 'Cancelled') {
        cancelledRides++;
      }
      if (ride.createdAt && ride.acceptedAt) {
        const waitTime = (new Date(ride.acceptedAt) - new Date(ride.createdAt)) / 60000;
        totalWaitTime += waitTime;
        waitTimeCount++;
      }
    });

    const waitTimeAvg = waitTimeCount > 0 ? (totalWaitTime / waitTimeCount).toFixed(1) : 0;

    res.status(200).json({ totalRevenue, activeRides, cancelledRides, waitTimeAvg });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ message: 'Failed to fetch analytics', error: error.message });
  }
};

module.exports.getDashboardAnalytics = getDashboardAnalytics;
