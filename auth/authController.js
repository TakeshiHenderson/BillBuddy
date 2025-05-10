const { v4: uuidv4 } = require('uuid');
const pool = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
require('dotenv').config();

// Register
exports.register = async (req, res) => {
    const { email, password } = req.body;

    try {
        // Check if email already exists
        const [userExists] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
        if (userExists.length > 0) {
            return res.status(400).json({ message: 'Email already exists' });
        }

        const newUserId = uuidv4();

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert user into database
        await pool.query('INSERT INTO users (user_id, email, password) VALUES (?, ?, ?)', [newUserId, email, hashedPassword]);

        res.status(201).json({ message: 'User registered successfully' });

    } catch (err) {
        console.error("Register error:", err);
        res.status(500).json({ message: 'Server error' });
    }
};

// Login
exports.login = async (req, res) => {
    const { email, password } = req.body;

    try {
        // Check if user exists
        const [user] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
        if (user.length === 0) {
            return res.status(401).json({ message: 'Invalid email or password' });
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
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        // Generate JWT token
        const token = jwt.sign({ user_id: user[0].user_id }, process.env.JWT_SECRET, { expiresIn: '1h' });

        res.json({ token });

    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({ message: 'Server error' });
    }
};

// Profile (Protected)
exports.profile = async (req, res) => {
    try {
        const [user] = await pool.query('SELECT id, username, email FROM users WHERE id = ?', [req.user.id]);
        if (user.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json(user[0]);

    } catch (err) {
        console.error(err);
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
        const resetToken = crypto.randomBytes(32).toString('hex');
        const expiryTime = new Date(Date.now() + 3600000); // Token expires in 1 hour

        // Store token in database
        await pool.query(
            'UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE email = ?',
            [resetToken, expiryTime, email]
        );

        // Send email with reset link
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: process.env.SMTP_PORT,
            secure: false, // true for 465, false for 587
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        }); 

        const resetLink = `http://localhost:3000/reset-password/${resetToken}`;
        const mailOptions = {
            from: process.env.SMTP_USER,
            to: email,
            subject: 'Password Reset Request',
            text: `Click here to reset your password: ${resetLink}`,
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

    try {
        // Find user with the token
        const [user] = await pool.query(
            'SELECT * FROM users WHERE reset_token = ? AND reset_token_expiry > NOW()',
            [token]
        );

        if (user.length === 0) {
            return res.status(400).json({ message: 'Invalid or expired token' });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update user password and remove reset token
        await pool.query(
            'UPDATE users SET password = ?, reset_token = NULL, reset_token_expiry = NULL WHERE reset_token = ?',
            [hashedPassword, token]
        );

        res.json({ message: 'Password has been reset successfully' });
    } catch (err) {
        console.error('Reset Password error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};



