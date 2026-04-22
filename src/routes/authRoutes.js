const express = require('express');

const { registerUser, loginUser, getMe } = require('../controllers/authController');

const router = express.Router();

router.post('/register', registerUser);
router.post('/login', loginUser);
router.get('/me', getMe);

module.exports = router;
