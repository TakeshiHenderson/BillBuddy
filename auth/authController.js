const { v4: uuidv4 } = require('uuid');
const pool = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
require('dotenv').config();

// Register
exports.register = async (req, res) => {
    const { username, email, password } = req.body;

    try {
        // Validate input
        if (!username || !email || !password) {
            return res.status(400).json({ 
                message: 'Please provide username, email, and password' 
            });
        }

        // Check if email already exists
        const [userExists] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
        if (userExists.length > 0) {
            return res.status(400).json({ message: 'Email already exists' });
        }

        // Check if username already exists
        const [usernameExists] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (usernameExists.length > 0) {
            return res.status(400).json({ message: 'Username already exists' });
        }

        const newUserId = uuidv4();

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert user into database
        await pool.query(
            'INSERT INTO users (user_id, username, email, password) VALUES (?, ?, ?, ?)', 
            [newUserId, username, email, hashedPassword]
        );

        res.status(201).json({ 
            message: 'User registered successfully',
            user: {
                id: newUserId,
                username,
                email
            }
        });

    } catch (err) {
        console.error("Register error:", err);
        res.status(500).json({ 
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
};

// Login
exports.login = async (req, res) => {
    const { username, password } = req.body;

    try {
        // Check if user exists
        const [user] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (user.length === 0) {
            return res.status(401).json({ message: 'Invalid username or password' });
        }

        // If user is an OAuth user (no password set)
        if (!user[0].password) {
            return res.status(401).json({ 
                message: 'This account was created with Google. Please use Google Sign-In to login.'
            });
        }

        // Verify password
        const isMatch = await bcrypt.compare(password, user[0].password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid username or password' });
        }

        // Generate JWT token
        const token = jwt.sign({ 
            user_id: user[0].user_id,
            username: user[0].username,
            email: user[0].email 
        }, process.env.JWT_SECRET, { expiresIn: '1h' });

        res.json({ 
            token,
            user: {
                id: user[0].user_id,
                username: user[0].username,
                email: user[0].email
            }
        });

    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({ message: 'Server error' });
    }
};

// Profile (Protected)
exports.profile = async (req, res) => {
    try {
        const [user] = await pool.query(
            'SELECT user_id, username, email, profile_picture FROM users WHERE user_id = ?', 
            [req.user.user_id]
        );
        if (user.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json(user[0]);

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
};

// Update Profile
exports.updateProfile = async (req, res) => {
    const { username, email } = req.body;
    const userId = req.user.user_id;

    try {
        // Check if new username is taken
        if (username) {
            const [usernameExists] = await pool.query(
                'SELECT * FROM users WHERE username = ? AND user_id != ?',
                [username, userId]
            );
            if (usernameExists.length > 0) {
                return res.status(400).json({ message: 'Username already taken' });
            }
        }

        // Check if new email is taken
        if (email) {
            const [emailExists] = await pool.query(
                'SELECT * FROM users WHERE email = ? AND user_id != ?',
                [email, userId]
            );
            if (emailExists.length > 0) {
                return res.status(400).json({ message: 'Email already taken' });
            }
        }

        // Update user profile
        const updateFields = [];
        const updateValues = [];
        
        if (username) {
            updateFields.push('username = ?');
            updateValues.push(username);
        }
        if (email) {
            updateFields.push('email = ?');
            updateValues.push(email);
        }

        if (updateFields.length === 0) {
            return res.status(400).json({ message: 'No fields to update' });
        }

        updateValues.push(userId);
        await pool.query(
            `UPDATE users SET ${updateFields.join(', ')} WHERE user_id = ?`,
            updateValues
        );

        res.json({ 
            message: 'Profile updated successfully',
            user: {
                id: userId,
                username: username || req.user.username,
                email: email || req.user.email
            }
        });

    } catch (err) {
        console.error('Update profile error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.setPassword = async (req, res) => {
    const { password } = req.body;
    const token = req.headers.authorization?.split(' ')[1] || req.query.token;

    if (!token) {
        return res.status(401).json({ message: 'No token provided' });
    }

    try {
        // Verify the token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        if (!decoded.needsPassword) {
            return res.status(400).json({ message: 'Invalid token' });
        }

        // Check if user exists
        const [user] = await pool.query('SELECT * FROM users WHERE user_id = ?', [decoded.user_id]);
        if (user.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        // If user already has a password, deny request
        if (user[0].password) {
            return res.status(400).json({ message: 'Password already set' });
        }

        // Hash and update password
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query('UPDATE users SET password = ? WHERE user_id = ?', [hashedPassword, decoded.user_id]);

        // Generate new JWT token for regular login
        const newToken = jwt.sign({ user_id: decoded.user_id }, process.env.JWT_SECRET, { expiresIn: '1h' });

        res.status(200).json({ 
            message: 'Password set successfully', 
            token: newToken 
        });

    } catch (err) {
        if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Invalid or expired token' });
        }
        console.error("Set password error:", err);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.requestPasswordReset = async (req, res) => {
    const { email } = req.body;

    try {
        // Check if user exists
        const [user] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
        if (user.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Generate reset token
        const resetToken = crypto.randomBytes(25).toString('hex'); // Generate 50-character token
        const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour from now

        // Store token in database
        await pool.query(
            'UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE email = ?',
            [resetToken, resetTokenExpiry, email]
        );

        // Send email with reset link
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });

        const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Password Reset Request',
            html: `
                <h1>Password Reset Request</h1>
                <p>You requested a password reset. Click the link below to reset your password:</p>
                <a href="${resetUrl}">Reset Password</a>
                <p>This link will expire in 1 hour.</p>
                <p>If you didn't request this, please ignore this email.</p>
            `
        };

        await transporter.sendMail(mailOptions);

        res.json({ message: 'Password reset link sent to your email' });

    } catch (err) {
        console.error('Reset Password error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.resetPassword = async (req, res) => {
    const { token, newPassword } = req.body;
    console.log('Reset password request received:', { 
        token: token ? 'present' : 'missing', 
        hasPassword: !!newPassword,
        tokenLength: token?.length,
        tokenValue: token // Log the actual token value
    });

    try {
        // First, let's check if the token exists in the database
        console.log('Checking token in database...');
        const [tokenCheck] = await pool.query(
            'SELECT user_id, reset_token, reset_token_expiry FROM users WHERE reset_token = ?',
            [token]
        );

        console.log('Token check result:', {
            found: tokenCheck.length > 0,
            token: tokenCheck[0]?.reset_token,
            tokenLength: tokenCheck[0]?.reset_token?.length,
            expiry: tokenCheck[0]?.reset_token_expiry,
            currentTime: new Date()
        });

        // Let's also check all reset tokens in the database
        const [allTokens] = await pool.query(
            'SELECT email, reset_token, reset_token_expiry FROM users WHERE reset_token IS NOT NULL'
        );
        console.log('All reset tokens in database:', allTokens.map(t => ({
            email: t.email,
            token: t.reset_token,
            tokenLength: t.reset_token?.length,
            expiry: t.reset_token_expiry
        })));

        // Find user with valid reset token
        console.log('Searching for user with valid reset token...');
        const [users] = await pool.query(
            'SELECT * FROM users WHERE reset_token = ? AND reset_token_expiry > NOW()',
            [token]
        );

        console.log('Query result:', { 
            foundUsers: users.length,
            hasToken: !!token,
            tokenLength: token?.length,
            tokenValue: token // Log the actual token value
        });

        if (users.length === 0) {
            console.log('No valid token found or token expired');
            return res.status(400).json({ message: 'Invalid or expired reset token' });
        }

        console.log('Valid token found, hashing new password');
        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password and clear reset token
        console.log('Updating password and clearing reset token');
        await pool.query(
            'UPDATE users SET password = ?, reset_token = NULL, reset_token_expiry = NULL WHERE reset_token = ?',
            [hashedPassword, token]
        );

        console.log('Password reset successful');
        res.status(200).json({ message: 'Password has been reset successfully' });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ message: 'Error resetting password' });
    }
};

// New function to get user's groups
exports.getUserGroups = async (req, res) => {
    const userId = req.user.user_id;

    try {
        // Query to join user_groups and groups table and filter by user_id
        const [groups] = await pool.query(
            'SELECT g.group_id, g.group_name, g.profile_picture FROM groups g JOIN user_groups ug ON g.group_id = ug.group_id WHERE ug.user_id = ?',
            [userId]
        );

        res.json(groups);

    } catch (err) {
        console.error('Error fetching user groups:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

// New function to create a group
exports.createGroup = async (req, res) => {
    const { groupName } = req.body;
    const userId = req.user.user_id; // Get user_id from the authenticated user
    const profilePicture = req.file ? req.file.filename : null; // Get the uploaded file name if exists

    // Basic validation
    if (!groupName) {
        return res.status(400).json({ message: 'Group name is required' });
    }

    try {
        // Generate a new UUID for the group
        const groupId = uuidv4();

        // Start a transaction
        await pool.query('START TRANSACTION');

        // Insert into the groups table with profile picture
        await pool.query(
            'INSERT INTO groups (group_id, group_name, profile_picture) VALUES (?, ?, ?)',
            [groupId, groupName, profilePicture]
        );

        // Insert into the user_groups table to link the creator
        await pool.query(
            'INSERT INTO user_groups (group_id, user_id) VALUES (?, ?)',
            [groupId, userId]
        );

        // Commit the transaction
        await pool.query('COMMIT');

        // Respond with the newly created group information
        res.status(201).json({ 
            message: 'Group created successfully',
            group: { 
                group_id: groupId, 
                group_name: groupName,
                profile_picture: profilePicture
            }
        });

    } catch (err) {
        // Rollback the transaction in case of error
        await pool.query('ROLLBACK');
        console.error('Error creating group:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

// New function to get a single group by ID
exports.getGroupById = async (req, res) => {
    const { groupId } = req.params;
    const userId = req.user.user_id; // Get user_id from the authenticated user

    try {
        // Query to get group details and check if the user is a member
        const [groupRows] = await pool.query(
            'SELECT g.group_id, g.group_name, g.profile_picture FROM groups g JOIN user_groups ug ON g.group_id = ug.group_id WHERE g.group_id = ? AND ug.user_id = ?',
            [groupId, userId]
        );

        if (groupRows.length === 0) {
            return res.status(404).json({ message: 'Group not found or you are not a member' });
        }

        const group = groupRows[0];

        // Fetch members of the group
        const [memberRows] = await pool.query(
            'SELECT u.user_id, u.username FROM users u JOIN user_groups ug ON u.user_id = ug.user_id WHERE ug.group_id = ?',
            [groupId]
        );

        // Add members to the group object
        group.members = memberRows.map(member => ({
            id: member.user_id,
            username: member.username
        }));

        res.json(group);

    } catch (err) {
        console.error('Error fetching group by ID:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

// New function for a user to join a group
exports.joinGroup = async (req, res) => {
    const { groupId } = req.params;
    const userId = req.user.user_id; // Get user_id from the authenticated user

    try {
        // Check if the group exists
        const [groupExists] = await pool.query(
            'SELECT group_id FROM groups WHERE group_id = ?',
            [groupId]
        );

        if (groupExists.length === 0) {
            return res.status(404).json({ message: 'Group not found' });
        }

        // Check if the user is already a member of the group
        const [isMember] = await pool.query(
            'SELECT * FROM user_groups WHERE group_id = ? AND user_id = ?',
            [groupId, userId]
        );

        if (isMember.length > 0) {
            return res.status(400).json({ message: 'You are already a member of this group' });
        }

        // Add the user to the user_groups table
        await pool.query(
            'INSERT INTO user_groups (group_id, user_id) VALUES (?, ?)',
            [groupId, userId]
        );

        res.status(200).json({ message: 'Successfully joined the group' });

    } catch (err) {
        console.error('Error joining group:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

// Update user profile picture
const updateProfilePhoto = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
    }

    try {
        const userId = req.user.user_id;
        const profilePicture = req.file.filename;

        // Update user's profile picture in database
        await pool.query(
            'UPDATE users SET profile_picture = ? WHERE user_id = ?',
            [profilePicture, userId]
        );

        res.json({
            message: 'Profile picture updated successfully',
            profile_picture: profilePicture
        });
    } catch (error) {
        console.error('Error updating profile picture:', error);
        res.status(500).json({ message: 'Failed to update profile picture' });
    }
};

// Update group profile picture
const updateGroupPhoto = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
    }

    try {
        const { groupId } = req.params;
        const profilePicture = req.file.filename;

        // Update group's profile picture in database
        await pool.query(
            'UPDATE groups SET profile_picture = ? WHERE group_id = ?',
            [profilePicture, groupId]
        );

        res.json({
            message: 'Group profile picture updated successfully',
            profile_picture: profilePicture
        });
    } catch (error) {
        console.error('Error updating group profile picture:', error);
        res.status(500).json({ message: 'Failed to update group profile picture' });
    }
};

// Forgot Password Controller
const forgotPassword = async (req, res) => {
    const { email } = req.body;

    try {
        console.log('Starting forgot password process for:', email);
        console.log('Environment variables:', {
            smtpHost: process.env.SMTP_HOST,
            smtpPort: process.env.SMTP_PORT,
            smtpUser: process.env.SMTP_USER,
            hasSmtpPass: !!process.env.SMTP_PASS,
            frontendUrl: process.env.FRONTEND_URL
        });

        // Check if user exists
        const [user] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
        
        if (user.length === 0) {
            console.log('User not found:', email);
            // Don't reveal if email exists or not
            return res.status(200).json({ 
                message: 'If your email is registered, you will receive a password reset link.' 
            });
        }

        console.log('User found:', {
            userId: user[0].user_id,
            email: user[0].email
        });

        // Generate reset token
        const resetToken = crypto.randomBytes(25).toString('hex'); // Generate 50-character token
        const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour from now

        console.log('Generated token:', {
            token: resetToken,
            tokenLength: resetToken.length,
            expiry: resetTokenExpiry
        });

        // Store token in database
        console.log('Storing token in database...');
        const [updateResult] = await pool.query(
            'UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE email = ?',
            [resetToken, resetTokenExpiry, email]
        );
        console.log('Token storage result:', {
            affectedRows: updateResult.affectedRows,
            changedRows: updateResult.changedRows
        });

        // Verify token was stored
        const [verifyToken] = await pool.query(
            'SELECT reset_token, reset_token_expiry FROM users WHERE email = ?',
            [email]
        );
        console.log('Token verification:', {
            stored: verifyToken[0]?.reset_token === resetToken,
            storedToken: verifyToken[0]?.reset_token,
            generatedToken: resetToken,
            expiry: verifyToken[0]?.reset_token_expiry
        });

        // Create reset URL
        const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
        console.log('Reset URL generated:', resetUrl);

        // Send email
        console.log('Setting up email transporter with SMTP');
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: process.env.SMTP_PORT,
            secure: process.env.SMTP_PORT === '465', // true for 465, false for other ports
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            },
            debug: true, // Enable debug logging
            logger: true // Enable logger
        });

        const mailOptions = {
            from: process.env.SMTP_USER,
            to: email,
            subject: 'Password Reset Request',
            html: `
                <h1>Password Reset Request</h1>
                <p>You requested a password reset. Click the link below to reset your password:</p>
                <a href="${resetUrl}">Reset Password</a>
                <p>This link will expire in 1 hour.</p>
                <p>If you didn't request this, please ignore this email.</p>
            `
        };

        console.log('Attempting to send email');
        await transporter.sendMail(mailOptions);
        console.log('Email sent successfully');

        res.status(200).json({ 
            message: 'If your email is registered, you will receive a password reset link.' 
        });
    } catch (error) {
        console.error('Forgot password error:', error);
        if (error.code === 'EAUTH') {
            console.error('SMTP authentication failed. Please check your SMTP settings in .env');
            return res.status(500).json({ message: 'Error sending email. Please try again later.' });
        }
        res.status(500).json({ message: 'Error processing password reset request' });
    }
};

module.exports = {
    register: exports.register,
    login: exports.login,
    profile: exports.profile,
    updateProfile: exports.updateProfile,
    setPassword: exports.setPassword,
    requestPasswordReset: exports.requestPasswordReset,
    resetPassword: exports.resetPassword,
    getUserGroups: exports.getUserGroups,
    createGroup: exports.createGroup,
    getGroupById: exports.getGroupById,
    joinGroup: exports.joinGroup,
    updateProfilePhoto,
    updateGroupPhoto,
    forgotPassword
};



