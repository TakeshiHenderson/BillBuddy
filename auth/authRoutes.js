const express = require('express');
const router = express.Router();
const authController = require('./authController');
const authMiddleware = require('./authMiddleware');
const passport = require('../passport');
const jwt = require('jsonwebtoken');
const pool = require('../db');

router.post('/register', authController.register);
router.post('/login', authController.login);
router.get('/profile', authMiddleware, authController.profile);
router.put('/profile', authMiddleware, authController.updateProfile);
// router.delete('/profile', authMiddleware, authController.deleteAccount);

// Password management routes
router.post('/set-password', authController.setPassword);
router.post('/request-password-reset', authController.requestPasswordReset);
router.post('/reset-password', authController.resetPassword);

// Group routes
router.get('/groups', authMiddleware, authController.getUserGroups);
router.post('/groups', authMiddleware, authController.createGroup);
router.get('/groups/:groupId', authMiddleware, authController.getGroupById);

// Google OAuth routes
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/google/callback', 
    passport.authenticate('google', { session: false }), 
    (req, res) => {
        // Generate JWT token for the user
        const token = jwt.sign({ 
            user_id: req.user.user_id,
            username: req.user.username,
            email: req.user.email
        }, process.env.JWT_SECRET, { expiresIn: '1h' });
        
        res.json({ 
            token,
            user: {
                id: req.user.user_id,
                username: req.user.username,
                email: req.user.email
            }
        });
    }
);

module.exports = router;
