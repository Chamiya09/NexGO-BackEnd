const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const Driver = require('../models/Driver');

const buildDriverResponse = (driver) => ({
  id: driver._id,
  fullName: driver.fullName,
  email: driver.email,
  phoneNumber: driver.phoneNumber,
  emergencyContact: driver.emergencyContact || '',
  profileImageUrl: driver.profileImageUrl || '',
  status: driver.status,
  documents: driver.documents || [],
  vehicle: driver.vehicle || null,
  security: driver.security || {},
});

const getTokenFromRequest = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  return authHeader.split(' ')[1];
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

const getAuthenticatedDriver = async (req) => {
  const token = getTokenFromRequest(req);
  if (!token) {
    return null;
  }

  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  if (decoded.role !== 'driver') {
    return null;
  }

  return Driver.findById(decoded.id);
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

const createDriverVehicle = async (req, res) => {
  try {
    const driver = await getAuthenticatedDriver(req);
    if (!driver) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    if (driver.vehicle) {
      return res.status(400).json({ message: 'A vehicle is already added. Use the update vehicle step to change it.' });
    }

    const category = String(req.body.category || '').trim();
    const make = String(req.body.make || '').trim();
    const model = String(req.body.model || '').trim();
    const year = Number(req.body.year);
    const plateNumber = String(req.body.plateNumber || '').trim().toUpperCase();
    const color = String(req.body.color || '').trim();
    const seats = Number(req.body.seats);
    const allowedCategories = ['Bike', 'Tuk', 'Mini', 'Car', 'Van'];

    if (!category || !make || !model || !year || !plateNumber || !color || !seats) {
      return res.status(400).json({
        message: 'category, make, model, year, plateNumber, color, and seats are required',
      });
    }

    if (!allowedCategories.includes(category)) {
      return res.status(400).json({ message: 'category must be Bike, Tuk, Mini, Car, or Van' });
    }

    if (!Number.isInteger(year) || year < 1980 || year > 2100) {
      return res.status(400).json({ message: 'Enter a valid manufacture year.' });
    }

    if (!Number.isInteger(seats) || seats < 1 || seats > 60) {
      return res.status(400).json({ message: 'Enter a valid passenger seat count.' });
    }

    driver.vehicle = {
      category,
      make,
      model,
      year,
      plateNumber,
      color,
      seats,
    };

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

module.exports = {
  registerDriver,
  loginDriver,
  getDriverMe,
  updateDriverMe,
  updateDriverDocument,
  getDriverVehicle,
  createDriverVehicle,
  updateDriverSecurity,
  changeDriverPassword,
};
