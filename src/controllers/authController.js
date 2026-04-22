const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const User = require('../models/User');

const buildUserResponse = (user) => ({
  id: user._id,
  fullName: user.fullName,
  email: user.email,
  phoneNumber: user.phoneNumber,
  profileImageUrl: user.profileImageUrl || '',
});

const getTokenFromRequest = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  return authHeader.split(' ')[1];
};

const getAuthenticatedUser = async (req) => {
  const token = getTokenFromRequest(req);
  if (!token) {
    return null;
  }

  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const user = await User.findById(decoded.id);
  return user;
};

const normalizeCardNumber = (cardNumber = '') => cardNumber.replace(/\D/g, '');

const detectCardBrand = (cardNumber) => {
  if (/^4/.test(cardNumber)) {
    return 'Visa';
  }

  if (/^(5[1-5]|2[2-7])/.test(cardNumber)) {
    return 'Mastercard';
  }

  if (/^3[47]/.test(cardNumber)) {
    return 'American Express';
  }

  return 'Card';
};

const createCardFingerprint = (cardNumber) => {
  const secret = process.env.PAYMENT_METHOD_SECRET || process.env.JWT_SECRET;
  return crypto.createHmac('sha256', secret).update(cardNumber).digest('hex');
};

const registerUser = async (req, res) => {
  try {
    const { fullName, email, phoneNumber, password, profileImageUrl } = req.body;

    if (!fullName || !email || !phoneNumber || !password) {
      return res.status(400).json({
        message: 'fullName, email, phoneNumber, and password are required',
      });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });

    if (existingUser) {
      return res.status(400).json({ message: 'Email already exists' });
    }

    const user = await User.create({
      fullName,
      email: email.toLowerCase(),
      phoneNumber,
      profileImageUrl: typeof profileImageUrl === 'string' ? profileImageUrl.trim() : '',
      password,
    });

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      message: 'User registered successfully',
      token,
      user: buildUserResponse(user),
    });
  } catch (error) {
    console.error('🔥 REGISTRATION ERROR DETAILS: ', error);

    if (error?.code === 11000) {
      return res.status(400).json({ message: 'An account with this email already exists.' });
    }

    if (error?.name === 'ValidationError') {
      const validationMessages = Object.values(error.errors || {})
        .map((err) => err.message)
        .filter(Boolean);

      if (validationMessages.length > 0) {
        return res.status(400).json({ message: validationMessages.join(', ') });
      }
    }

    return res
      .status(500)
      .json({ message: error.message || 'Unknown Server Error during registration' });
  }
};

const loginUser = async (req, res) => {
  try {
    console.log('🔥 LOGIN ATTEMPT FOR EMAIL: ', req.body.email);
    // If login keeps failing, register a brand new account first to validate password hashing in the current DB setup.

    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Missing required fields: email and password.' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await User.findOne({ email: normalizedEmail }).select('+password');
    console.log('👤 USER FOUND IN DB:', user ? 'YES' : 'NO');

    if (!user) {
      return res.status(401).json({ message: 'No account found with this email.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    console.log('🔑 PASSWORD MATCH:', isMatch);

    if (!isMatch) {
      return res.status(401).json({ message: 'The password you entered is incorrect.' });
    }

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(200).json({
      message: 'Login successful',
      token,
      user: buildUserResponse(user),
    });
  } catch (error) {
    console.error('🔥 LOGIN SERVER ERROR: ', error);
    return res.status(500).json({
      message: error.message || 'Internal server error during login',
    });
  }
};

const getMe = async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    return res.status(200).json({
      user: buildUserResponse(user),
    });
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

const updateMe = async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const fullName = String(req.body.fullName || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const phoneNumber = String(req.body.phoneNumber || '').trim();
    const profileImageUrl = String(req.body.profileImageUrl || '').trim();

    if (!fullName || !email || !phoneNumber) {
      return res.status(400).json({
        message: 'fullName, email, and phoneNumber are required',
      });
    }

    const existingUser = await User.findOne({
      email,
      _id: { $ne: user._id },
    });

    if (existingUser) {
      return res.status(400).json({ message: 'Email already exists' });
    }

    user.fullName = fullName;
    user.email = email;
    user.phoneNumber = phoneNumber;
    user.profileImageUrl = profileImageUrl;

    await user.save();

    return res.status(200).json({
      message: 'Profile updated successfully',
      user: buildUserResponse(user),
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

    return res.status(500).json({
      message: error.message || 'Unable to update profile',
    });
  }
};

const deleteMe = async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    await User.findByIdAndDelete(user._id);

    return res.status(200).json({
      message: 'Account deleted successfully',
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || 'Unable to delete account',
    });
  }
};

const getPaymentMethods = async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    return res.status(200).json({
      paymentMethods: user.paymentMethods || [],
    });
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

const addPaymentMethod = async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { cardholderName, cardNumber, expiryMonth, expiryYear, isDefault } = req.body;

    if (!cardholderName || !cardNumber || !expiryMonth || !expiryYear) {
      return res.status(400).json({
        message: 'cardholderName, cardNumber, expiryMonth, and expiryYear are required',
      });
    }

    const normalizedCardNumber = normalizeCardNumber(cardNumber);
    if (normalizedCardNumber.length < 12 || normalizedCardNumber.length > 19) {
      return res.status(400).json({ message: 'Card number must be between 12 and 19 digits' });
    }

    const month = String(expiryMonth).trim();
    const year = String(expiryYear).trim();

    if (!/^(0?[1-9]|1[0-2])$/.test(month)) {
      return res.status(400).json({ message: 'Expiry month must be between 1 and 12' });
    }

    if (!/^\d{2,4}$/.test(year)) {
      return res.status(400).json({ message: 'Expiry year must be 2 or 4 digits' });
    }

    const fingerprintHash = createCardFingerprint(normalizedCardNumber);
    const existingMethod = (user.paymentMethods || []).find(
      (method) => method.fingerprintHash === fingerprintHash
    );

    if (existingMethod) {
      return res.status(400).json({ message: 'This payment method has already been added' });
    }

    const shouldSetDefault = Boolean(isDefault) || (user.paymentMethods || []).length === 0;

    if (shouldSetDefault) {
      user.paymentMethods = (user.paymentMethods || []).map((method) => ({
        ...method.toObject(),
        isDefault: false,
      }));
    }

    user.paymentMethods.push({
      cardholderName: cardholderName.trim(),
      brand: detectCardBrand(normalizedCardNumber),
      last4: normalizedCardNumber.slice(-4),
      fingerprintHash,
      expiryMonth: month.padStart(2, '0'),
      expiryYear: year.length === 2 ? `20${year}` : year,
      isDefault: shouldSetDefault,
    });

    await user.save();

    return res.status(201).json({
      message: 'Payment method added successfully',
      paymentMethods: user.paymentMethods || [],
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || 'Unable to add payment method',
    });
  }
};

const setDefaultPaymentMethod = async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { paymentMethodId } = req.params;
    const paymentMethods = user.paymentMethods || [];
    const hasMatch = paymentMethods.some((method) => String(method._id) === paymentMethodId);

    if (!hasMatch) {
      return res.status(404).json({ message: 'Payment method not found' });
    }

    user.paymentMethods = paymentMethods.map((method) => ({
      ...method.toObject(),
      isDefault: String(method._id) === paymentMethodId,
    }));

    await user.save();

    return res.status(200).json({
      message: 'Default payment method updated',
      paymentMethods: user.paymentMethods || [],
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || 'Unable to update default payment method',
    });
  }
};

module.exports = {
  registerUser,
  loginUser,
  getMe,
  updateMe,
  deleteMe,
  getPaymentMethods,
  addPaymentMethod,
  setDefaultPaymentMethod,
};
