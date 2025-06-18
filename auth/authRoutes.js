const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const authController = require('./authController');
const authMiddleware = require('./authMiddleware');
const pool = require('../db');

// for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const isUserProfile = req.path.includes('/profile/photo');
        const uploadPath = isUserProfile ? 'uploads/profile-photos/' : 'uploads/group-photos/';
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const prefix = req.path.includes('/profile/photo') ? 'user-' : 'group-';
        cb(null, prefix + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 2 * 1024 * 1024 // 2MB limit
    },
    fileFilter: function (req, file, cb) {
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

// Password management routes
router.post('/set-password', authController.setPassword);
router.post('/request-password-reset', authController.requestPasswordReset);
router.post('/reset-password', authController.resetPassword);

// Group routes
router.get('/groups', authMiddleware, authController.getUserGroups);
router.post('/groups', authMiddleware, upload.single('profilePicture'), authController.createGroup);
router.get('/groups/:groupId', authMiddleware, authController.getGroupById);
router.post('/groups/:groupId/join', authMiddleware, authController.joinGroup);
router.put('/groups/:groupId/photo', authMiddleware, upload.single('profilePicture'), authController.updateGroupPhoto);

// User profile picture route
router.put('/profile/photo', authMiddleware, upload.single('profilePicture'), authController.updateProfilePhoto);

router.post('/forgot-password', authController.forgotPassword);

module.exports = router;
