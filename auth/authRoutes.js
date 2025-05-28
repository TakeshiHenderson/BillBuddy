const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const authController = require('./authController');
const authMiddleware = require('./authMiddleware');
const passport = require('../passport');
const jwt = require('jsonwebtoken');
const pool = require('../db');

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/group-photos/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'group-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 2 * 1024 * 1024 // 2MB limit
    },
    fileFilter: function (req, file, cb) {
        // Accept images only
        if (!file.originalname.match(/\.(jpg|jpeg|png)$/)) {
            return cb(new Error('Only image files are allowed!'), false);
        }
        cb(null, true);
    }
});

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
router.post('/groups', authMiddleware, upload.single('profilePicture'), authController.createGroup);
router.get('/groups/:groupId', authMiddleware, authController.getGroupById);
router.post('/groups/:groupId/join', authMiddleware, authController.joinGroup);

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
