const { Pool, types } = require('pg');

// Return DATE columns as raw "YYYY-MM-DD" strings instead of JS Date objects
// (node-postgres otherwise parses them at UTC midnight, which shifts a day
// in any timezone behind UTC).
types.setTypeParser(types.builtins.DATE, (val) => val);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

module.exports = { pool };
