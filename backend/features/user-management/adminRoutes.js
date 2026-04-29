const express = require('express');
const { getUsers, deleteUser } = require('./adminController');
const authMiddleware = require('../login/authMiddleware');
const roleMiddleware = require('../../middleware/roleMiddleware');

const router = express.Router();

router.use(authMiddleware);
router.use(roleMiddleware(['admin']));

router.get('/users', getUsers);
router.delete('/user/:id', deleteUser);

module.exports = router;
