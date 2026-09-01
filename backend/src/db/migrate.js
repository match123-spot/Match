require('dotenv').config();
const { pool } = require('../config/db');
const { runMigrations } = require('./runMigrations');

runMigrations(pool)
  .then(() => pool.end())
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
