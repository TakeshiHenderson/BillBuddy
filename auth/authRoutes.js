const express = require('express');
const router = express.Router();
const authController = require('./authController');
const authMiddleware = require('./authMiddleware');
const passport = require('../passport');
const jwt = require('jsonwebtoken');

router.post('/register', authController.register);
router.post('/login', authController.login);
router.get('/profile', authMiddleware, async (req, res) => {
    try {
        const [user] = await pool.query('SELECT id, email FROM users WHERE id = ?', [req.user.id]);
        if (user.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json(user[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});
router.post('/set-password', authController.setPassword);
router.post('/request-password-reset', authController.requestPasswordReset);
router.post('/reset-password', authController.resetPassword);

// Google OAuth routes
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/google/callback', 
    passport.authenticate('google', { session: false }), 
    (req, res) => {
        // Generate JWT token for the user
        const token = jwt.sign({ user_id: req.user.user_id }, process.env.JWT_SECRET, { expiresIn: '1h' });
        // Redirect to frontend with the token
        // res.redirect(`http://localhost:5000/auth-success?token=${token}`);
        res.json({ token: token });
    }
);

module.exports = router;
