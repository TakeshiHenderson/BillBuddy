const { v4: uuidv4 } = require('uuid');
const pool = require('./db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

// Register
exports.register = async (req, res) => {
    const { email, password } = req.body;

    try {
        // Check if email already exists
        const userExists = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userExists.rows.length > 0) {
            return res.status(400).json({ message: 'Email already exists' });
        }

        const newUserId = uuidv4();


        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert user into database
        await pool.query('INSERT INTO users (user_id, email, password) VALUES ($1, $2, $3)', [newUserId, email, hashedPassword]);

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
        const user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (user.rows.length === 0) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }


        // Verify password
        const isMatch = await bcrypt.compare(password, user.rows[0].password);
        if (!isMatch || password == null) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        // Generate JWT token
        const token = jwt.sign({ user_id: user.rows[0].user_id }, process.env.JWT_SECRET, { expiresIn: '1h' });

        res.json({ token });

    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({ message: 'Server error' });
    }
};




// Profile (Protected)
exports.profile = async (req, res) => {
    try {
        const user = await pool.query('SELECT id, username, email FROM users WHERE id = $1', [req.user.id]);
        if (user.rows.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json(user.rows[0]);

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.setPassword = async (req, res) => {
    const { email, password } = req.body;

    try {
        // Check if user exists
        const user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (user.rows.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        // If user already has a password, deny request
        if (user.rows[0].password) {
            return res.status(400).json({ message: 'Password already set' });
        }

        // Hash and update password
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query('UPDATE users SET password = $1 WHERE email = $2', [hashedPassword, email]);

        // Generate JWT token
        const token = jwt.sign({ user_id: user.rows[0].user_id }, process.env.JWT_SECRET, { expiresIn: '1h' });

        res.status(200).json({ message: 'Password set successfully', token });

    } catch (err) {
        console.error("Set password error:", err);
        res.status(500).json({ message: 'Server error' });
    }
};




const crypto = require('crypto');
const nodemailer = require('nodemailer');

exports.requestPasswordReset = async (req, res) => {
    const { email } = req.body;

    try {
        // Check if user exists
        const user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (user.rows.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Generate reset token (random 32-byte string)
        const resetToken = crypto.randomBytes(32).toString('hex');
        const tokenExpiry = new Date(Date.now() + 3600000); // Token valid for 1 hour

        // Store token in DB
        await pool.query('UPDATE users SET reset_token = $1, reset_token_expiry = $2 WHERE email = $3', 
            [resetToken, tokenExpiry, email]);

        // Send reset email
        const transporter = nodemailer.createTransport({
            service: 'Gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });

        const resetUrl = `http://localhost:3000/auth/reset-password/${resetToken}`;
        await transporter.sendMail({
            to: email,
            subject: "Password Reset Request",
            text: `Click the link to reset your password: ${resetUrl}`
        });

        res.json({ message: 'Reset email sent. Check your inbox!' });

    } catch (err) {
        console.error("Reset Password error:", err);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.resetPassword = async (req, res) => {
    const { token, newPassword } = req.body;

    try {
        // Find user by token and check if token is still valid
        const user = await pool.query('SELECT * FROM users WHERE reset_token = $1 AND reset_token_expiry > NOW()', [token]);
        if (user.rows.length === 0) {
            return res.status(400).json({ message: 'Invalid or expired token' });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password and remove reset token
        await pool.query('UPDATE users SET password = $1, reset_token = NULL, reset_token_expiry = NULL WHERE reset_token = $2', 
            [hashedPassword, token]);

        res.json({ message: 'Password has been reset successfully!' });

    } catch (err) {
        console.error("Reset Password error:", err);
        res.status(500).json({ message: 'Server error' });
    }
};


