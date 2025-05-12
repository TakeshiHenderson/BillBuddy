// =========================================
// Import Dependencies
// =========================================
const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');

// Local imports
const passport = require('./passport');
const authRoutes = require('./auth/authRoutes');
const authMiddleware = require('./auth/authMiddleware');
const summarize = require('./summarize');

// =========================================
// Environment Configuration
// =========================================
dotenv.config();

// =========================================
// Express App Setup
// =========================================
const app = express();

// =========================================
// Middleware Configuration
// =========================================
// CORS and Body Parser
app.use(cors());
app.use(bodyParser.json());

// Session Configuration
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
}));

// Passport Configuration
app.use(passport.initialize());
app.use(passport.session());

// =========================================
// Route Configuration
// =========================================
// Auth Routes
app.use('/auth', authRoutes);

// OAuth Routes
app.get('/auth/google', 
    passport.authenticate('google', { 
        scope: ['profile', 'email'] 
    })
);

app.get('/auth/google/callback',
    passport.authenticate('google', { 
        failureRedirect: '/' 
    }),
    (req, res) => {
        res.redirect('/dashboard');
    }
);

// Public Routes
app.get('/', (req, res) => {
    res.send('Hello world!');
});

// Protected Routes
app.get('/dashboard', 
    authMiddleware, 
    (req, res) => {
        res.json({ 
            message: "Welcome to the dashboard", 
            user: req.user 
        });
    }
);

// =========================================
// Server Configuration
// =========================================
const PORT = process.env.PORT || 5000;

// Only start the server if we're not in test mode
if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

// Export for testing
module.exports = app;


// const result = summarize(testBills);
