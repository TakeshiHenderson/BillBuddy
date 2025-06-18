const jwt = require('jsonwebtoken');
const pool = require('../db');

module.exports = async (req, res, next) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({ message: 'No token, authorization denied' });
        }


        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        const [user] = await pool.query(
            'SELECT user_id, username, email FROM users WHERE user_id = ?',
            [decoded.user_id]
        );

        if (user.length === 0) {
            return res.status(401).json({ message: 'User no longer exists' });
        }

        req.user = {
            user_id: decoded.user_id,
            username: decoded.username,
            email: decoded.email
        };

        next();
    } catch (err) {
        if (err.name === 'JsonWebTokenError') {
            return res.status(401).json({ message: 'Token is not valid' });
        }
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Token has expired' });
        }
        console.error('Auth middleware error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};
