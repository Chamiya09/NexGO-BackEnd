const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const User = require('../models/User');
const { isEmailServiceConfigured, sendPasswordResetOtpEmail } = require('../services/emailService');

const PASSWORD_RESET_SUCCESS_MESSAGE = 'If an account exists, a password reset code has been sent.';
const PASSWORD_RESET_OTP_LENGTH = Number(process.env.PASSWORD_RESET_OTP_LENGTH || 6);
const PASSWORD_RESET_OTP_TTL_MINUTES = Number(process.env.PASSWORD_RESET_OTP_TTL_MINUTES || 10);
const PASSWORD_RESET_RESEND_SECONDS = Number(process.env.PASSWORD_RESET_RESEND_SECONDS || 60);
const PASSWORD_RESET_MAX_ATTEMPTS = Number(process.env.PASSWORD_RESET_MAX_ATTEMPTS || 5);
const PASSWORD_RESET_OTP_SECRET = process.env.PASSWORD_RESET_OTP_SECRET || process.env.JWT_SECRET;

const isValidPositiveInteger = (value) => Number.isInteger(value) && value > 0;

const buildUserResponse = (user) => ({
  id: user._id,
  fullName: user.fullName,
  email: user.email,
  phoneNumber: user.phoneNumber,
  profileImageUrl: user.profileImageUrl || '',
});

const buildUserManagementResponse = (user) => ({
  ...buildUserResponse(user),
  createdAt: user.createdAt,
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

const listUsers = async (_req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });

    return res.status(200).json({
      users: users.map(buildUserManagementResponse),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Unable to load users' });
  }
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

const createPasswordResetOtp = () => {
  const min = 10 ** (PASSWORD_RESET_OTP_LENGTH - 1);
  const max = 10 ** PASSWORD_RESET_OTP_LENGTH - 1;
  return String(crypto.randomInt(min, max + 1));
};

const createPasswordResetOtpHash = (otp) => {
  if (!PASSWORD_RESET_OTP_SECRET) {
    throw new Error('Password reset OTP secret is not configured. Set PASSWORD_RESET_OTP_SECRET or JWT_SECRET.');
  }

  return crypto
    .createHmac('sha256', PASSWORD_RESET_OTP_SECRET)
    .update(otp)
    .digest('hex');
};

const isPasswordResetOtpMatch = (otp, otpHash) => {
  if (!otpHash) {
    return false;
  }

  const nextHash = createPasswordResetOtpHash(otp);
  const nextHashBuffer = Buffer.from(nextHash, 'hex');
  const savedHashBuffer = Buffer.from(otpHash, 'hex');

  if (nextHashBuffer.length !== savedHashBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(nextHashBuffer, savedHashBuffer);
};

const normalizeSavedAddress = (address) => ({
  _id: address._id,
  label: address.label,
  title: address.title,
  addressLine: address.addressLine,
  latitude: address.latitude,
  longitude: address.longitude,
  note: address.note || '',
  isDefault: Boolean(address.isDefault),
});

const normalizeWalletTransaction = (transaction) => ({
  _id: transaction._id,
  type: transaction.type,
  amount: Number(transaction.amount || 0),
  balanceAfter: Number(transaction.balanceAfter || 0),
  paymentMethodId: transaction.paymentMethodId || null,
  description: transaction.description || '',
  createdAt: transaction.createdAt,
});

const normalizeWallet = (wallet = {}) => ({
  balance: Number(wallet.balance || 0),
  transactions: (wallet.transactions || [])
    .slice()
    .sort((first, second) => new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime())
    .map(normalizeWalletTransaction),
});

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

const forgotPassword = async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const phoneNumber = String(req.body.phoneNumber || '').trim();
    const newPassword = String(req.body.newPassword || '');
    const confirmNewPassword = String(req.body.confirmNewPassword || '');

    if (!email || !phoneNumber || !newPassword || !confirmNewPassword) {
      return res.status(400).json({
        message: 'email, phoneNumber, newPassword, and confirmNewPassword are required',
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters long.' });
    }

    if (newPassword !== confirmNewPassword) {
      return res.status(400).json({ message: 'New password and confirmation do not match.' });
    }

    const user = await User.findOne({ email }).select('+password');
    if (!user || user.phoneNumber !== phoneNumber) {
      return res.status(404).json({ message: 'No account found with this email and phone number.' });
    }

    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      return res.status(400).json({ message: 'Choose a new password that is different from the current one.' });
    }

    user.password = newPassword;
    await user.save();

    return res.status(200).json({
      message: 'Password reset successfully. Please sign in with your new password.',
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || 'Unable to reset password',
    });
  }
};

const requestPasswordResetOtp = async (req, res) => {
  try {
    if (!PASSWORD_RESET_OTP_SECRET) {
      return res.status(503).json({
        message: 'Password reset is not configured. Please contact support.',
      });
    }

    if (!isValidPositiveInteger(PASSWORD_RESET_OTP_LENGTH) || PASSWORD_RESET_OTP_LENGTH < 4) {
      return res.status(503).json({
        message: 'Password reset is temporarily unavailable. Please try again later.',
      });
    }

    if (!isValidPositiveInteger(PASSWORD_RESET_OTP_TTL_MINUTES)) {
      return res.status(503).json({
        message: 'Password reset is temporarily unavailable. Please try again later.',
      });
    }

    if (!isValidPositiveInteger(PASSWORD_RESET_RESEND_SECONDS)) {
      return res.status(503).json({
        message: 'Password reset is temporarily unavailable. Please try again later.',
      });
    }

    if (!isValidPositiveInteger(PASSWORD_RESET_MAX_ATTEMPTS)) {
      return res.status(503).json({
        message: 'Password reset is temporarily unavailable. Please try again later.',
      });
    }

    if (!isEmailServiceConfigured()) {
      return res.status(503).json({
        message: 'Email service is not configured. Please contact support.',
      });
    }

    const email = String(req.body.email || '').trim().toLowerCase();

    if (!email) {
      return res.status(400).json({ message: 'Email is required.' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(200).json({ message: PASSWORD_RESET_SUCCESS_MESSAGE });
    }

    const now = new Date();
    const lastSentAt = user.passwordResetLastSentAt;
    const secondsSinceLastSend = lastSentAt
      ? Math.floor((now.getTime() - lastSentAt.getTime()) / 1000)
      : PASSWORD_RESET_RESEND_SECONDS;

    if (secondsSinceLastSend < PASSWORD_RESET_RESEND_SECONDS) {
      return res.status(200).json({ message: PASSWORD_RESET_SUCCESS_MESSAGE });
    }

    const otp = createPasswordResetOtp();
    user.passwordResetOtpHash = createPasswordResetOtpHash(otp);
    user.passwordResetOtpExpiresAt = new Date(now.getTime() + PASSWORD_RESET_OTP_TTL_MINUTES * 60 * 1000);
    user.passwordResetOtpAttempts = 0;
    user.passwordResetLastSentAt = now;

    await user.save();

    try {
      await sendPasswordResetOtpEmail({
        toEmail: user.email,
        toName: user.fullName,
        otp,
        ttlMinutes: PASSWORD_RESET_OTP_TTL_MINUTES,
      });
    } catch (emailError) {
      user.passwordResetOtpHash = null;
      user.passwordResetOtpExpiresAt = null;
      user.passwordResetOtpAttempts = 0;
      user.passwordResetLastSentAt = null;

      await user.save();

      console.error('Password reset OTP email send error:', emailError);
      return res.status(502).json({
        message: 'Unable to deliver reset code email. Please try again later.',
      });
    }

    return res.status(200).json({ message: PASSWORD_RESET_SUCCESS_MESSAGE });
  } catch (error) {
    console.error('Password reset OTP request error:', error);
    return res.status(500).json({ message: 'Unable to request password reset code.' });
  }
};

const resetPasswordWithOtp = async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const otp = String(req.body.otp || '').replace(/\D/g, '');
    const newPassword = String(req.body.newPassword || '');
    const confirmNewPassword = String(req.body.confirmNewPassword || '');

    if (!email || !otp || !newPassword || !confirmNewPassword) {
      return res.status(400).json({
        message: 'email, otp, newPassword, and confirmNewPassword are required',
      });
    }

    if (otp.length !== PASSWORD_RESET_OTP_LENGTH) {
      return res.status(400).json({ message: 'Invalid or expired reset code.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters long.' });
    }

    if (newPassword !== confirmNewPassword) {
      return res.status(400).json({ message: 'New password and confirmation do not match.' });
    }

    const user = await User.findOne({ email }).select('+password +passwordResetOtpHash');
    if (!user || !user.passwordResetOtpHash || !user.passwordResetOtpExpiresAt) {
      return res.status(400).json({ message: 'Invalid or expired reset code.' });
    }

    const now = new Date();
    if (user.passwordResetOtpExpiresAt.getTime() <= now.getTime()) {
      user.passwordResetOtpHash = null;
      user.passwordResetOtpExpiresAt = null;
      user.passwordResetOtpAttempts = 0;
      await user.save();

      return res.status(400).json({ message: 'Invalid or expired reset code.' });
    }

    if (user.passwordResetOtpAttempts >= PASSWORD_RESET_MAX_ATTEMPTS) {
      user.passwordResetOtpHash = null;
      user.passwordResetOtpExpiresAt = null;
      user.passwordResetOtpAttempts = 0;
      await user.save();

      return res.status(429).json({ message: 'Too many attempts. Please request a new code.' });
    }

    const isOtpValid = isPasswordResetOtpMatch(otp, user.passwordResetOtpHash);
    if (!isOtpValid) {
      user.passwordResetOtpAttempts += 1;

      if (user.passwordResetOtpAttempts >= PASSWORD_RESET_MAX_ATTEMPTS) {
        user.passwordResetOtpHash = null;
        user.passwordResetOtpExpiresAt = null;
        user.passwordResetOtpAttempts = 0;
        await user.save();

        return res.status(429).json({ message: 'Too many attempts. Please request a new code.' });
      }

      await user.save();
      return res.status(400).json({ message: 'Invalid or expired reset code.' });
    }

    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      return res.status(400).json({ message: 'Choose a new password that is different from the current one.' });
    }

    user.password = newPassword;
    user.passwordResetOtpHash = null;
    user.passwordResetOtpExpiresAt = null;
    user.passwordResetOtpAttempts = 0;
    user.passwordResetLastSentAt = null;

    await user.save();

    return res.status(200).json({
      message: 'Password reset successfully. Please sign in with your new password.',
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || 'Unable to reset password',
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

const changePassword = async (req, res) => {
  try {
    const token = getTokenFromRequest(req);
    if (!token) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('+password');

    if (!user) {
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

    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      return res.status(401).json({ message: 'Your current password is incorrect.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters long.' });
    }

    if (newPassword !== confirmNewPassword) {
      return res.status(400).json({ message: 'New password and confirmation do not match.' });
    }

    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      return res.status(400).json({ message: 'Choose a new password that is different from the current one.' });
    }

    user.password = newPassword;
    await user.save();

    return res.status(200).json({
      message: 'Password updated successfully',
    });
  } catch (error) {
    if (error?.name === 'JsonWebTokenError' || error?.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }

    return res.status(500).json({
      message: error.message || 'Unable to update password',
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

const getWallet = async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    return res.status(200).json({
      wallet: normalizeWallet(user.wallet),
    });
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

const getSavedAddresses = async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    return res.status(200).json({
      savedAddresses: (user.savedAddresses || []).map(normalizeSavedAddress),
    });
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

const addSavedAddress = async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const label = String(req.body.label || 'Other').trim();
    const title = String(req.body.title || '').trim();
    const addressLine = String(req.body.addressLine || '').trim();
    const note = String(req.body.note || '').trim();
    const latitude = Number(req.body.latitude);
    const longitude = Number(req.body.longitude);
    const isDefault = Boolean(req.body.isDefault);

    if (!title || !addressLine) {
      return res.status(400).json({ message: 'title and addressLine are required' });
    }

    if (!['Home', 'Work', 'Other'].includes(label)) {
      return res.status(400).json({ message: 'label must be Home, Work, or Other' });
    }

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ message: 'latitude and longitude are required' });
    }

    const shouldSetDefault = isDefault || (user.savedAddresses || []).length === 0;

    if (shouldSetDefault) {
      user.savedAddresses = (user.savedAddresses || []).map((address) => ({
        ...address.toObject(),
        isDefault: false,
      }));
    }

    user.savedAddresses.push({
      label,
      title,
      addressLine,
      latitude,
      longitude,
      note,
      isDefault: shouldSetDefault,
    });

    await user.save();

    return res.status(201).json({
      message: 'Saved address added successfully',
      savedAddresses: (user.savedAddresses || []).map(normalizeSavedAddress),
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || 'Unable to add saved address',
    });
  }
};

const setDefaultSavedAddress = async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { addressId } = req.params;
    const savedAddresses = user.savedAddresses || [];
    const hasMatch = savedAddresses.some((address) => String(address._id) === addressId);

    if (!hasMatch) {
      return res.status(404).json({ message: 'Saved address not found' });
    }

    user.savedAddresses = savedAddresses.map((address) => ({
      ...address.toObject(),
      isDefault: String(address._id) === addressId,
    }));

    await user.save();

    return res.status(200).json({
      message: 'Default saved address updated',
      savedAddresses: (user.savedAddresses || []).map(normalizeSavedAddress),
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || 'Unable to update default saved address',
    });
  }
};

const deleteSavedAddress = async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { addressId } = req.params;
    const savedAddresses = user.savedAddresses || [];
    const addressToDelete = savedAddresses.find((address) => String(address._id) === addressId);

    if (!addressToDelete) {
      return res.status(404).json({ message: 'Saved address not found' });
    }

    let nextAddresses = savedAddresses.filter((address) => String(address._id) !== addressId);

    if (nextAddresses.length > 0 && !nextAddresses.some((address) => address.isDefault)) {
      nextAddresses = nextAddresses.map((address, index) => ({
        ...address.toObject(),
        isDefault: index === 0,
      }));
    } else {
      nextAddresses = nextAddresses.map((address) => address.toObject());
    }

    user.savedAddresses = nextAddresses;
    await user.save();

    return res.status(200).json({
      message: 'Saved address deleted successfully',
      savedAddresses: (user.savedAddresses || []).map(normalizeSavedAddress),
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || 'Unable to delete saved address',
    });
  }
};

const topUpWallet = async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const amount = Number(req.body.amount);
    const paymentMethodId = String(req.body.paymentMethodId || '').trim();
    const cardNumber = normalizeCardNumber(req.body.cardNumber);
    const expiryMonth = String(req.body.expiryMonth || '').trim();
    const expiryYear = String(req.body.expiryYear || '').trim();
    const cardholderName = String(req.body.cardholderName || '').trim();

    if (!Number.isFinite(amount) || amount < 100) {
      return res.status(400).json({ message: 'Top up amount must be at least LKR 100.' });
    }

    if (amount > 100000) {
      return res.status(400).json({ message: 'Top up amount cannot exceed LKR 100,000.' });
    }

    let paymentMethod = null;
    let paymentDescription = '';

    if (paymentMethodId) {
      paymentMethod = (user.paymentMethods || []).find(
        (method) => String(method._id) === paymentMethodId
      );

      if (!paymentMethod) {
        return res.status(404).json({ message: 'Payment method not found' });
      }

      paymentDescription = `Top up from ${paymentMethod.brand} ending ${paymentMethod.last4}`;
    } else {
      if (!cardholderName || !cardNumber || !expiryMonth || !expiryYear) {
        return res.status(400).json({
          message: 'cardholderName, cardNumber, expiryMonth, and expiryYear are required',
        });
      }

      if (cardNumber.length < 12 || cardNumber.length > 19) {
        return res.status(400).json({ message: 'Card number must be between 12 and 19 digits' });
      }

      if (!/^(0?[1-9]|1[0-2])$/.test(expiryMonth)) {
        return res.status(400).json({ message: 'Expiry month must be between 1 and 12' });
      }

      if (!/^\d{2,4}$/.test(expiryYear)) {
        return res.status(400).json({ message: 'Expiry year must be 2 or 4 digits' });
      }

      paymentDescription = `Top up from ${detectCardBrand(cardNumber)} ending ${cardNumber.slice(-4)}`;
    }

    if (!user.wallet) {
      user.wallet = { balance: 0, transactions: [] };
    }

    user.wallet.transactions = user.wallet.transactions || [];

    const currentBalance = Number(user.wallet.balance || 0);
    const nextBalance = currentBalance + amount;

    user.wallet.balance = nextBalance;
    user.wallet.transactions.push({
      type: 'topup',
      amount,
      balanceAfter: nextBalance,
      paymentMethodId: paymentMethod?._id || null,
      description: paymentDescription,
      createdAt: new Date(),
    });

    if (user.wallet.transactions.length > 50) {
      user.wallet.transactions = user.wallet.transactions.slice(-50);
    }

    await user.save();

    return res.status(200).json({
      message: 'Wallet topped up successfully',
      wallet: normalizeWallet(user.wallet),
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || 'Unable to top up wallet',
    });
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
  listUsers,
  forgotPassword,
  requestPasswordResetOtp,
  resetPasswordWithOtp,
  getMe,
  updateMe,
  changePassword,
  deleteMe,
  getSavedAddresses,
  addSavedAddress,
  setDefaultSavedAddress,
  deleteSavedAddress,
  getPaymentMethods,
  getWallet,
  addPaymentMethod,
  topUpWallet,
  setDefaultPaymentMethod,
};
