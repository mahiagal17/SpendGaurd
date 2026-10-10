const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { requireAuth } = require('../middleware/auth');

// Public authentication routes
router.post('/register', authController.register);
router.post('/login', authController.login);

// Protected user profile routes (Requires Bearer Token)
router.get('/me', requireAuth, authController.getMe);
router.delete('/me', requireAuth, authController.deleteAccount);

module.exports = router;
