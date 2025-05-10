const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const pool = require('./db'); // Import database connection
const { v4: uuidv4 } = require('uuid');

require('dotenv').config();

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "/auth/google/callback"
}, async (accessToken, refreshToken, profile, done) => {
    try {
        // Check if user already exists
        const [userExists] = await pool.query('SELECT * FROM users WHERE email = ?', [profile.emails[0].value]);

        if (userExists.length > 0) {
            // If user exists, return the user
            return done(null, userExists[0]);
        }

        // If new user, create them
        const newUserId = uuidv4();
        const [newUser] = await pool.query(
            'INSERT INTO users (user_id, email) VALUES (?, ?)',
            [newUserId, profile.emails[0].value, profile.displayName]
        );

        // Return the new user
        return done(null, { ...newUser, user_id: newUserId, email: profile.emails[0].value, username: profile.displayName });

    } catch (err) {
        console.error("OAuth Error:", err);
        return done(err, null);
    }
}));

passport.serializeUser((user, done) => {
    done(null, user.user_id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const [user] = await pool.query("SELECT * FROM users WHERE user_id = ?", [id]);
        if (user.length === 0) return done(null, false);
        done(null, user[0]);
    } catch (err) {
        done(err, null);
    }
});

module.exports = passport;
