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
        const userExists = await pool.query('SELECT * FROM users WHERE email = $1', [profile.emails[0].value]);

        if (userExists.rows.length > 0) {
            if (!userExists.rows[0].password) {
                // If user exists but has no password, force them to set one
                return done(null, { ...userExists.rows[0], needsPassword: true });
            }
            return done(null, userExists.rows[0]);
        }

        // If new user, create them with NULL password
        const newUserId = uuidv4();
        const newUser = await pool.query(
            'INSERT INTO users (user_id, email, password) VALUES ($1, $2, $3) RETURNING *',
            [newUserId, profile.emails[0].value, null]
        );

        // Return user data with "needsPassword" flag
        return done(null, { ...newUser.rows[0], needsPassword: true });

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
        const user = await pool.query("SELECT * FROM users WHERE user_id = $1", [id]);
        if (user.rows.length === 0) return done(null, false);
        done(null, user.rows[0]);
    } catch (err) {
        done(err, null);
    }
});

module.exports = passport;
