const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const Driver = require('../models/Driver');
const Ride = require('../models/Ride');
const { emitDriverAccountStatus } = require('../sockets/rideSocket');
const { buildReadableId } = require('../utils/readableId');

const ADMIN_COMMISSION_RATE = 0.2;

const buildDriverResponse = (driver) => ({
  id: driver._id,
  readableId: driver.readableId || buildReadableId('DRV', driver._id),
  fullName: driver.fullName,
  email: driver.email,
  phoneNumber: driver.phoneNumber,
  emergencyContact: driver.emergencyContact || '',
  profileImageUrl: driver.profileImageUrl || '',
  status: driver.status,
  isOnline: Boolean(driver.isOnline),
  availabilityStatus: driver.availabilityStatus || (driver.isOnline ? 'Available' : 'Offline'),
  currentLocation: driver.currentLocation || null,
  locationUpdatedAt: driver.locationUpdatedAt || null,
  documents: driver.documents || [],
  vehicle: driver.vehicle || null,
  security: driver.security || {},
  totalCashedOut: driver.totalCashedOut || 0,
});

const buildPublicDriverResponse = (driver, stats = {}) => ({
  id: driver._id,
  readableId: driver.readableId || buildReadableId('DRV', driver._id),
  fullName: driver.fullName,
  phoneNumber: driver.phoneNumber,
  profileImageUrl: driver.profileImageUrl || '',
  status: driver.status,
  isOnline: Boolean(driver.isOnline),
  vehicle: driver.vehicle || null,
  ratingAverage: stats.ratingAverage ?? 0,
  ratingCount: stats.ratingCount ?? 0,
  completedRides: stats.completedRides ?? 0,
  recentReviews: stats.recentReviews ?? [],
});

const getTokenFromRequest = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  return authHeader.split(' ')[1];
};

const getSessionDriverId = (req) => {
  if (!req?.session) return null;
  if (req.session.role !== 'driver') return null;
  return req.session.driverId || null;
};

const signDriverToken = (driver) =>
  jwt.sign(
    {
      id: driver._id,
      role: 'driver',
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

const ensureDriverReadableId = async (driver) => {
  if (!driver || driver.readableId) return driver;

  driver.readableId = buildReadableId('DRV', driver._id);
  await driver.save();
  return driver;
};

const getAuthenticatedDriver = async (req) => {
  const token = getTokenFromRequest(req);
  if (token) {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'driver') {
      return null;
    }

    return Driver.findById(decoded.id);
  }

  const sessionDriverId = getSessionDriverId(req);
  if (!sessionDriverId) {
    return null;
  }

  return Driver.findById(sessionDriverId);
};

const normalizeEmail = (email = '') => String(email).trim().toLowerCase();

const registerDriver = async (req, res) => {
  try {
    const fullName = String(req.body.fullName || '').trim();
    const email = normalizeEmail(req.body.email);
    const phoneNumber = String(req.body.phoneNumber || '').trim();
    const password = String(req.body.password || '');
    const emergencyContact = String(req.body.emergencyContact || '').trim();
    const profileImageUrl = String(req.body.profileImageUrl || '').trim();

    if (!fullName || !email || !phoneNumber || !password) {
      return res.status(400).json({
        message: 'fullName, email, phoneNumber, and password are required',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long.' });
    }

    const existingDriver = await Driver.findOne({ email });
    if (existingDriver) {
      return res.status(400).json({ message: 'A driver account with this email already exists.' });
    }

    const driver = await Driver.create({
      fullName,
      email,
      phoneNumber,
      password,
      emergencyContact,
      profileImageUrl,
    });

    const token = signDriverToken(driver);
    if (req.session) {
      req.session.driverId = driver._id.toString();
      req.session.role = 'driver';
    }

    return res.status(201).json({
      message: 'Driver registered successfully',
      token,
      driver: buildDriverResponse(driver),
    });
  } catch (error) {
    console.error('Driver registration error:', error);

    if (error?.code === 11000) {
      return res.status(400).json({ message: 'A driver account with this email already exists.' });
    }

    if (error?.name === 'ValidationError') {
      const validationMessages = Object.values(error.errors || {})
        .map((err) => err.message)
        .filter(Boolean);

      if (validationMessages.length > 0) {
        return res.status(400).json({ message: validationMessages.join(', ') });
      }
    }

    return res.status(500).json({ message: error.message || 'Unable to register driver' });
  }
};

const loginDriver = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');

    if (!email || !password) {
      return res.status(400).json({ message: 'Missing required fields: email and password.' });
    }

    const driver = await Driver.findOne({ email }).select('+password');
    if (!driver) {
      return res.status(401).json({ message: 'No driver account found with this email.' });
    }

    const isMatch = await bcrypt.compare(password, driver.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'The password you entered is incorrect.' });
    }

    const token = signDriverToken(driver);
    if (req.session) {
      req.session.driverId = driver._id.toString();
      req.session.role = 'driver';
    }

    return res.status(200).json({
      message: 'Driver login successful',
      token,
      driver: buildDriverResponse(driver),
    });
  } catch (error) {
    console.error('Driver login error:', error);
    return res.status(500).json({ message: error.message || 'Unable to login driver' });
  }
};

const getDriverMe = async (req, res) => {
  try {
    const driver = await getAuthenticatedDriver(req);
    if (!driver) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    return res.status(200).json({ driver: buildDriverResponse(driver) });
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

const getDriverSession = async (req, res) => {
  try {
    const driver = await getAuthenticatedDriver(req);
    if (!driver) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    return res.status(200).json({ driver: buildDriverResponse(driver) });
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired session' });
  }
};

const logoutDriver = async (req, res) => {
  if (!req.session) {
    return res.status(200).json({ message: 'Logged out' });
  }

  req.session.destroy((error) => {
    if (error) {
      return res.status(500).json({ message: 'Unable to log out' });
    }

    return res.status(200).json({ message: 'Logged out' });
  });
};

const listDrivers = async (_req, res) => {
  try {
    const drivers = await Driver.find().sort({ createdAt: -1 });
    await Promise.all(drivers.map(ensureDriverReadableId));

    return res.status(200).json({
      drivers: drivers.map(buildDriverResponse),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Unable to load drivers' });
  }
};

const buildPublicDriverProfilePayload = async (driverId) => {
  if (!mongoose.Types.ObjectId.isValid(driverId)) {
    const error = new Error('Invalid driver profile id');
    error.statusCode = 400;
    throw error;
  }

  const driver = await Driver.findById(driverId);
  if (!driver) {
    const error = new Error('Driver not found');
    error.statusCode = 404;
    throw error;
  }

  const completedStatusMatch = ['Completed', 'completed'];
  const [statsResult] = await Ride.aggregate([
    {
      $match: {
        driverId: driver._id,
        status: { $in: completedStatusMatch },
        'review.status': 'approved',
      },
    },
    {
      $group: {
        _id: '$driverId',
        completedRides: { $sum: 1 },
        ratingCount: {
          $sum: {
            $cond: [{ $ifNull: ['$review.rating', false] }, 1, 0],
          },
        },
        ratingAverage: { $avg: '$review.rating' },
      },
    },
  ]);

  const topReviewedRides = await Ride.find({
    driverId: driver._id,
    status: { $in: completedStatusMatch },
    'review.rating': { $exists: true, $ne: null },
    'review.status': 'approved',
  })
    .sort({ 'review.rating': -1, 'review.reviewedAt': -1 })
    .limit(3)
    .select('review completedAt')
    .lean();

  const stats = {
    completedRides: statsResult?.completedRides ?? 0,
    ratingCount: statsResult?.ratingCount ?? 0,
    ratingAverage: statsResult?.ratingAverage
      ? Number(statsResult.ratingAverage.toFixed(1))
      : 0,
    recentReviews: topReviewedRides.map((ride) => ({
      rating: ride.review?.rating ?? 0,
      comment: ride.review?.comment ?? '',
      reviewedAt: ride.review?.reviewedAt ?? ride.completedAt ?? null,
    })),
  };

  return buildPublicDriverResponse(driver, stats);
};

const getPublicDriverProfile = async (req, res) => {
  try {
    const driver = await buildPublicDriverProfilePayload(req.params.id);

    return res.status(200).json({ driver });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      message: error.message || 'Unable to load driver profile',
    });
  }
};

const getRidePublicDriverProfile = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid ride id' });
    }

    const ride = await Ride.findById(req.params.id).select('driverId');
    if (!ride?.driverId) {
      return res.status(404).json({ message: 'Driver profile not available for this ride' });
    }

    const driver = await buildPublicDriverProfilePayload(ride.driverId);

    return res.status(200).json({ driver });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      message: error.message || 'Unable to load driver profile',
    });
  }
};

const updateDriverMe = async (req, res) => {
  try {
    const driver = await getAuthenticatedDriver(req);
    if (!driver) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const fullName = String(req.body.fullName || '').trim();
    const email = normalizeEmail(req.body.email);
    const phoneNumber = String(req.body.phoneNumber || '').trim();
    const emergencyContact = String(req.body.emergencyContact || '').trim();
    const profileImageUrl = String(req.body.profileImageUrl || '').trim();

    if (!fullName || !email || !phoneNumber) {
      return res.status(400).json({
        message: 'fullName, email, and phoneNumber are required',
      });
    }

    const existingDriver = await Driver.findOne({
      email,
      _id: { $ne: driver._id },
    });

    if (existingDriver) {
      return res.status(400).json({ message: 'A driver account with this email already exists.' });
    }

    driver.fullName = fullName;
    driver.email = email;
    driver.phoneNumber = phoneNumber;
    driver.emergencyContact = emergencyContact;
    driver.profileImageUrl = profileImageUrl;

    await driver.save();

    return res.status(200).json({
      message: 'Driver profile updated successfully',
      driver: buildDriverResponse(driver),
    });
  } catch (error) {
    if (error?.name === 'ValidationError') {
      const validationMessages = Object.values(error.errors || {})
        .map((err) => err.message)
        .filter(Boolean);

      if (validationMessages.length > 0) {
        return res.status(400).json({ message: validationMessages.join(', ') });
      }
    }

    return res.status(500).json({ message: error.message || 'Unable to update driver profile' });
  }
};

const updateDriverDocument = async (req, res) => {
  try {
    const driver = await getAuthenticatedDriver(req);
    if (!driver) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { documentType } = req.params;
    const allowedTypes = ['license', 'insurance', 'registration'];

    if (!allowedTypes.includes(documentType)) {
      return res.status(400).json({ message: 'documentType must be license, insurance, or registration' });
    }

    const fileUrl = String(req.body.fileUrl || '').trim();
    if (!fileUrl) {
      return res.status(400).json({ message: 'fileUrl is required' });
    }

    const documents = driver.documents || [];
    const existingDocument = documents.find((document) => document.documentType === documentType);

    if (existingDocument) {
      existingDocument.fileUrl = fileUrl;
      existingDocument.status = 'review';
      existingDocument.submittedAt = new Date();
      existingDocument.reviewedAt = null;
      existingDocument.rejectionReason = '';
    } else {
      documents.push({
        documentType,
        fileUrl,
        status: 'review',
        submittedAt: new Date(),
      });
    }

    driver.documents = documents;
    await driver.save();

    return res.status(200).json({
      message: 'Driver document submitted successfully',
      driver: buildDriverResponse(driver),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Unable to update driver document' });
  }
};

const updateDriverStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const nextStatus = String(req.body.status || '').trim().toLowerCase();
    const allowedStatuses = ['pending', 'active', 'suspended'];

    if (!allowedStatuses.includes(nextStatus)) {
      return res.status(400).json({ message: 'status must be pending, active, or suspended' });
    }

    const driver = await Driver.findById(id);
    if (!driver) {
      return res.status(404).json({ message: 'Driver not found' });
    }

    driver.status = nextStatus;
    if (nextStatus === 'suspended') {
      driver.isOnline = false;
      driver.availabilityStatus = 'Offline';
    }

    await driver.save();

    const io = req.app?.get?.('io');
    if (io) {
      emitDriverAccountStatus(io, driver._id, driver.status);
    }

    return res.status(200).json({
      message: 'Driver status updated',
      driver: buildDriverResponse(driver),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Unable to update driver status' });
  }
};

const reviewDriverDocument = async (req, res) => {
  try {
    const { id, documentType } = req.params;
    const { status, rejectionReason } = req.body;

    const allowedTypes = ['license', 'insurance', 'registration'];
    if (!allowedTypes.includes(documentType)) {
      return res.status(400).json({ message: 'documentType must be license, insurance, or registration' });
    }

    const validStatuses = ['approved', 'rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'status must be approved or rejected' });
    }

    const driver = await Driver.findById(id);
    if (!driver) {
      return res.status(404).json({ message: 'Driver not found' });
    }

    const documents = driver.documents || [];
    let documentIndex = documents.findIndex((doc) => doc.documentType === documentType);

    if (documentIndex === -1) {
      return res.status(404).json({ message: 'Document not found on this driver' });
    }

    documents[documentIndex].status = status;
    documents[documentIndex].reviewedAt = new Date();
    documents[documentIndex].rejectionReason = status === 'rejected' ? (rejectionReason || 'Rejected by Admin') : '';
    
    // Auto-approve driver if all documents are approved
    const allApproved = allowedTypes.every(type => {
      const doc = documents.find(d => d.documentType === type);
      return doc && doc.status === 'approved';
    });

    if (allApproved && driver.status === 'pending') {
      driver.status = 'active';
    } else if (!allApproved && driver.status === 'active') {
      driver.status = 'pending';
    }

    driver.documents = documents;
    await driver.save();

    return res.status(200).json({
      message: `Document ${status} successfully`,
      driver: buildDriverResponse(driver),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Unable to review driver document' });
  }
};

const getDriverVehicle = async (req, res) => {
  try {
    const driver = await getAuthenticatedDriver(req);
    if (!driver) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    return res.status(200).json({
      vehicle: driver.vehicle || null,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Unable to load driver vehicle' });
  }
};

const buildVehiclePayload = (body) => {
  const category = String(body.category || '').trim();
  const make = String(body.make || '').trim();
  const model = String(body.model || '').trim();
  const year = Number(body.year);
  const plateNumber = String(body.plateNumber || '').trim().toUpperCase();
  const color = String(body.color || '').trim();
  const seats = Number(body.seats);
  const allowedCategories = ['Bike', 'Tuk', 'Mini', 'Car', 'Van'];

  if (!category || !make || !model || !year || !plateNumber || !color || !seats) {
    return {
      error: 'category, make, model, year, plateNumber, color, and seats are required',
    };
  }

  if (!allowedCategories.includes(category)) {
    return { error: 'category must be Bike, Tuk, Mini, Car, or Van' };
  }

  if (!Number.isInteger(year) || year <= 1980 || year > 2100) {
    return { error: 'Vehicle manufacture year must be after 1980.' };
  }

  if (!Number.isInteger(seats) || seats < 1 || seats > 60) {
    return { error: 'Enter a valid passenger seat count.' };
  }

  return {
    vehicle: {
      category,
      make,
      model,
      year,
      plateNumber,
      color,
      seats,
    },
  };
};

const createDriverVehicle = async (req, res) => {
  try {
    const driver = await getAuthenticatedDriver(req);
    if (!driver) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    if (driver.vehicle) {
      return res.status(400).json({ message: 'A vehicle is already added. Use the update vehicle step to change it.' });
    }

    const { vehicle, error } = buildVehiclePayload(req.body);
    if (error) {
      return res.status(400).json({ message: error });
    }

    driver.vehicle = vehicle;

    await driver.save();

    return res.status(201).json({
      message: 'Driver vehicle added successfully',
      driver: buildDriverResponse(driver),
    });
  } catch (error) {
    if (error?.name === 'ValidationError') {
      const validationMessages = Object.values(error.errors || {})
        .map((err) => err.message)
        .filter(Boolean);

      if (validationMessages.length > 0) {
        return res.status(400).json({ message: validationMessages.join(', ') });
      }
    }

    return res.status(500).json({ message: error.message || 'Unable to add driver vehicle' });
  }
};

const updateDriverVehicle = async (req, res) => {
  try {
    const driver = await getAuthenticatedDriver(req);
    if (!driver) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    if (!driver.vehicle) {
      return res.status(404).json({ message: 'No vehicle found. Add a vehicle before updating it.' });
    }

    const { vehicle, error } = buildVehiclePayload(req.body);
    if (error) {
      return res.status(400).json({ message: error });
    }

    driver.vehicle = vehicle;
    await driver.save();

    return res.status(200).json({
      message: 'Driver vehicle updated successfully',
      driver: buildDriverResponse(driver),
    });
  } catch (error) {
    if (error?.name === 'ValidationError') {
      const validationMessages = Object.values(error.errors || {})
        .map((err) => err.message)
        .filter(Boolean);

      if (validationMessages.length > 0) {
        return res.status(400).json({ message: validationMessages.join(', ') });
      }
    }

    return res.status(500).json({ message: error.message || 'Unable to update driver vehicle' });
  }
};

const deleteDriverVehicle = async (req, res) => {
  try {
    const driver = await getAuthenticatedDriver(req);
    if (!driver) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    if (!driver.vehicle) {
      return res.status(404).json({ message: 'No vehicle found to delete.' });
    }

    driver.vehicle = null;
    await driver.save();

    return res.status(200).json({
      message: 'Driver vehicle deleted successfully',
      driver: buildDriverResponse(driver),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Unable to delete driver vehicle' });
  }
};

const updateDriverSecurity = async (req, res) => {
  try {
    const driver = await getAuthenticatedDriver(req);
    if (!driver) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    driver.security = {
      ...(driver.security || {}),
      twoStepVerificationEnabled: Boolean(req.body.twoStepVerificationEnabled),
    };

    await driver.save();

    return res.status(200).json({
      message: 'Driver security settings updated successfully',
      driver: buildDriverResponse(driver),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Unable to update driver security settings' });
  }
};

const changeDriverPassword = async (req, res) => {
  try {
    const token = getTokenFromRequest(req);
    if (!token) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'driver') {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const driver = await Driver.findById(decoded.id).select('+password');

    if (!driver) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');
    const confirmNewPassword = String(req.body.confirmNewPassword || '');

    if (!currentPassword || !newPassword || !confirmNewPassword) {
      return res.status(400).json({
        message: 'currentPassword, newPassword, and confirmNewPassword are required',
      });
    }

    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, driver.password);
    if (!isCurrentPasswordValid) {
      return res.status(401).json({ message: 'Your current password is incorrect.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters long.' });
    }

    if (newPassword !== confirmNewPassword) {
      return res.status(400).json({ message: 'New password and confirmation do not match.' });
    }

    const isSamePassword = await bcrypt.compare(newPassword, driver.password);
    if (isSamePassword) {
      return res.status(400).json({ message: 'Choose a new password that is different from the current one.' });
    }

    driver.password = newPassword;
    await driver.save();

    return res.status(200).json({ message: 'Driver password updated successfully' });
  } catch (error) {
    if (error?.name === 'JsonWebTokenError' || error?.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }

    return res.status(500).json({ message: error.message || 'Unable to update driver password' });
  }
};

const processDriverCheckout = async (req, res) => {
  try {
    const driver = await getAuthenticatedDriver(req);
    if (!driver) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: 'Invalid cashout amount' });
    }

    const [statsResult] = await Ride.aggregate([
      {
        $match: {
          driverId: driver._id,
          status: { $in: ['Completed', 'completed'] },
        },
      },
      {
        $group: {
          _id: '$driverId',
          totalEarned: {
            $sum: {
              $cond: [
                { $gt: ['$driverEarnings', 0] },
                '$driverEarnings',
                { $subtract: ['$price', { $multiply: ['$price', ADMIN_COMMISSION_RATE] }] }
              ]
            }
          },
        },
      },
    ]);

    const totalEarned = statsResult?.totalEarned || 0;
    const availableBalance = Math.max(0, totalEarned - (driver.totalCashedOut || 0));

    if (amount > availableBalance) {
      return res.status(400).json({ message: 'Insufficient available balance' });
    }

    driver.totalCashedOut = (driver.totalCashedOut || 0) + amount;
    await driver.save();

    return res.status(200).json({
      message: 'Checkout successful',
      driver: buildDriverResponse(driver),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Unable to process checkout' });
  }
};

module.exports = {
  registerDriver,
  loginDriver,
  getDriverMe,
  getDriverSession,
  getPublicDriverProfile,
  getRidePublicDriverProfile,
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
  processDriverCheckout,
};
