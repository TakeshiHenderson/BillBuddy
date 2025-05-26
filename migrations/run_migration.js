const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

async function runMigration() {
    let connection;
    try {
        // Create connection
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            multipleStatements: true // Allow multiple statements
        });

        console.log('Connected to database');

        // Read migration file
        const migrationPath = path.join(__dirname, 'add_username_column.sql');
        const migrationSQL = await fs.readFile(migrationPath, 'utf8');

        // Run migration
        await connection.query(migrationSQL);
        console.log('Migration completed successfully');

    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

runMigration(); 