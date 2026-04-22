const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const User = require('../models/User');

const registerUser = async (req, res) => {
  try {
    const { fullName, email, phoneNumber, password } = req.body;

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
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        phoneNumber: user.phoneNumber,
      },
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
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        phoneNumber: user.phoneNumber,
      },
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
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.status(200).json({
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        phoneNumber: user.phoneNumber,
      },
    });
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

module.exports = {
  registerUser,
  loginUser,
  getMe,
};
