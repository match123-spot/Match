// Test database bootstrap. Every test file that touches the DB must require
// this FIRST (before requiring ../src/app or ../src/config/db) — it points
// DATABASE_URL at an isolated freightcopilot_test database on the same
// Postgres server, so tests never run against the shared dev/demo data.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Client, Pool } = require('pg');
const { runMigrations } = require('../src/db/runMigrations');

const TEST_DB_NAME = process.env.TEST_DB_NAME || 'freightcopilot_test';

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) {
  throw new Error('DATABASE_URL must be set (see backend/.env.example) to run the test suite');
}

function withDatabase(connectionString, dbName) {
  const url = new URL(connectionString);
  url.pathname = `/${dbName}`;
  return url.toString();
}

const testUrl = withDatabase(baseUrl, TEST_DB_NAME);
process.env.DATABASE_URL = testUrl;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-not-for-production';

/** Drops and recreates the test database, then applies every migration. Call once per test file, in a top-level `before`. */
async function setupTestDatabase() {
  const admin = new Client({ connectionString: baseUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  } finally {
    await admin.end();
  }

  const pool = new Pool({ connectionString: testUrl });
  await runMigrations(pool, { log: () => {} });
  return pool;
}

module.exports = { setupTestDatabase, TEST_DB_NAME, testUrl };
