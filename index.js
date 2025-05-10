const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const passport = require('./passport'); // Import passport config
const authRoutes = require('./auth/authRoutes');
const pool = require('./db');
const authMiddleware = require('./auth/authMiddleware');


dotenv.config();
const app = express();

app.use(cors());
app.use(bodyParser.json());

app.use('/auth', authRoutes);
// Setup session
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

// '/' page
app.get('/', (req, res) => {
    res.send('Hello world!');
});

// OAuth Routes
{
    app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

    app.get('/auth/google/callback',
        passport.authenticate('google', { failureRedirect: '/' }),
        (req, res) => {
            res.redirect('/dashboard'); // Redirect to dashboard after successful login
        }
    );
}

// Dashboard routes
app.get('/dashboard', authMiddleware, (req, res) => {
    res.json({ message: "Welcome to the dashboard", user: req.user });
});

// PORT
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
