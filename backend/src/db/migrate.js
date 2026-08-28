require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

async function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  console.log('Running schema.sql against', process.env.DATABASE_URL?.split('@')[1] ?? '(no DATABASE_URL set)');
  await pool.query(schema);
  console.log('Migration complete.');
  await pool.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
