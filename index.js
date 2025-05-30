// =========================================
// Import Dependencies
// =========================================
const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');
const jwt = require('jsonwebtoken');

// Local imports
// const passport = require('./passport');
const authRoutes = require('./auth/authRoutes');
const authMiddleware = require('./auth/authMiddleware');
const summarize = require('./summarize');
const llmRoutes = require('./routes/llmRoutes');
const billRoutes = require('./routes/billRoutes');
const invoiceRoutes = require('./routes/invoiceRoutes');
const createUploadDirectories = require('./utils/createUploadDirs');
const uploadRoutes = require('./routes/uploadRoutes');

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
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
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
    exposedHeaders: ['Content-Range', 'X-Content-Range', 'Location'],
    preflightContinue: false,
    optionsSuccessStatus: 204
}));

// Handle preflight requests
app.options('*', cors({
    origin: 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
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
    exposedHeaders: ['Content-Range', 'X-Content-Range', 'Location'],
    preflightContinue: false,
    optionsSuccessStatus: 204
}));

// Add headers middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', 'http://localhost:5173');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Access-Control-Allow-Origin, Access-Control-Allow-Headers, Access-Control-Allow-Methods, Access-Control-Allow-Credentials');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Expose-Headers', 'Set-Cookie, Location');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
});

// Body Parser
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// Session Configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: true,
    saveUninitialized: true,
    cookie: {
        secure: false, // Set to false for development
        sameSite: 'lax', // Use lax for development
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        httpOnly: true,
        path: '/' // Ensure cookie is available for all paths
    },
    name: 'billbuddy.sid' // Custom session name
}));

// Passport Configuration
// app.use(passport.initialize());
// app.use(passport.session());

// Debug middleware for session
app.use((req, res, next) => {
    console.log('Session middleware - Session:', {
        id: req.sessionID,
        cookie: req.session.cookie,
        user: req.session.user
    });
    console.log('Session middleware - User:', req.user);
    next();
});

// Add a route to check session status
app.get('/api/auth/session', (req, res) => {
    res.json({
        isAuthenticated: !!req.user,
        user: req.user,
        sessionId: req.sessionID
    });
});

// Favicon handling
app.get('/favicon.ico', (req, res) => {
    res.status(204).end(); // No content response
});

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

// Test route
app.get('/test', (req, res) => {
    console.log('Test route hit');
    res.send('Test route working');
});

// Auth Routes
app.use('/auth', authRoutes);

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

// Upload Routes
app.use('/api', uploadRoutes);

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
