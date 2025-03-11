const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASS,
  port: process.env.DB_PORT || 5432, // Default PostgreSQL port
});
    
pool.connect()
  .then(() => console.log('Connected to PostgreSQL Database'))
  .catch((err) => console.error('Database connection failed:', err));

module.exports = pool;
