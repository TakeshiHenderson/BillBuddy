const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();
console.log(process.env.DB_USER, process.env.DB_HOST, process.env.DB_NAME, process.env.DB_PASS, process.env.DB_PORT);

const pool = mysql.createPool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASS,
  port: process.env.DB_PORT || 3306, // Default MySQL port
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

pool.getConnection()
  .then(() => console.log('Connected to MySQL Database'))
  .catch((err) => {
    console.error('Database connection failed:', err);
    process.exit(1);
  });

module.exports = pool;
