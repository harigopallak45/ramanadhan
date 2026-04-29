const express = require('express');
const { check } = require('express-validator');
const { signup, login, logout } = require('./authController');
const validateMiddleware = require('../../middleware/validateMiddleware');

const router = express.Router();

router.post(
  '/signup',
  [
    check('email', 'Please include a valid email').isEmail(),
    check('password', 'Please enter a password with 6 or more characters').isLength({ min: 6 })
  ],
  validateMiddleware,
  signup
);

router.post(
  '/login',
  [
    check('email', 'Please include a valid email').isEmail(),
    check('password', 'Password is required').exists()
  ],
  validateMiddleware,
  login
);

router.post('/logout', logout);

module.exports = router;
