const express = require('express');
const { getProfile, updateProfile } = require('./userController');
const authMiddleware = require('../login/authMiddleware');

const router = express.Router();

router.use(authMiddleware);

router.get('/profile', getProfile);
router.put('/update', updateProfile);

module.exports = router;
