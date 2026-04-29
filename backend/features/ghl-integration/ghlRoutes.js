const express = require('express');
const { handleWebhook } = require('./ghlController');
const { initiateAuth, authCallback } = require('./ghlOAuthController');

const router = express.Router();

router.post('/webhook', handleWebhook);
router.get('/auth', initiateAuth);
router.get('/callback', authCallback);

module.exports = router;
