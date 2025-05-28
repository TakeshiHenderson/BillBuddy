// =========================================
// Import Dependencies
// =========================================
const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');

// Local imports
const passport = require('./passport');
const authRoutes = require('./auth/authRoutes');
const authMiddleware = require('./auth/authMiddleware');
const summarize = require('./summarize');
const llmRoutes = require('./routes/llmRoutes');
const billRoutes = require('./routes/billRoutes');
const invoiceRoutes = require('./routes/invoiceRoutes');
const createUploadDirectories = require('./utils/createUploadDirs');

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
// CORS Configuration
app.use(cors({
    origin: 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'Accept',
        'Origin',
        'Access-Control-Allow-Origin',
        'Access-Control-Allow-Headers',
        'Access-Control-Allow-Methods',
        'Access-Control-Allow-Credentials'
    ],
    exposedHeaders: ['Content-Range', 'X-Content-Range'],
    preflightContinue: false,
    optionsSuccessStatus: 204
}));

// Handle preflight requests
app.options('*', cors({
    origin: 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'Accept',
        'Origin',
        'Access-Control-Allow-Origin',
        'Access-Control-Allow-Headers',
        'Access-Control-Allow-Methods',
        'Access-Control-Allow-Credentials'
    ],
    exposedHeaders: ['Content-Range', 'X-Content-Range'],
    preflightContinue: false,
    optionsSuccessStatus: 204
}));

// Add headers middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', 'http://localhost:5173');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Access-Control-Allow-Origin, Access-Control-Allow-Headers, Access-Control-Allow-Methods, Access-Control-Allow-Credentials');
    res.header('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
});

// Body Parser
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));


// Session Configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Passport Configuration
app.use(passport.initialize());
app.use(passport.session());

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({
        message: 'Something went wrong!',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

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

// Test route for bills
app.get('/api/test', (req, res) => {
    console.log('Test route hit');
    res.json({ message: 'Test route working' });
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

// LLM Routes
app.use('/api/llm', llmRoutes);

// Bill Routes
app.use('/api', billRoutes);

// Invoice Routes
app.use('/api', invoiceRoutes);

// Create upload directories
createUploadDirectories();

// Serve static files from the uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 404 handler - must be after all other routes
app.use((req, res, next) => {
    console.log('404 Not Found:', {
        method: req.method,
        url: req.url,
        path: req.path,
        baseUrl: req.baseUrl,
        originalUrl: req.originalUrl
    });
    res.status(404).json({
        error: 'Not Found',
        message: `Cannot ${req.method} ${req.originalUrl}`,
        path: req.path
    });
});

// =========================================
// Server Configuration
// =========================================
const PORT = process.env.PORT || 5000;

// Only start the server if we're not in test mode

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('CORS enabled for http://localhost:5173');
});


// Export for testing
module.exports = app;


// const result = summarize(testBills);
