const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

const SALT_ROUNDS = 12;
const TOKEN_TTL = '7d';

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, email: user.email }, process.env.JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  });
}

async function registerUser({ email, password, role, fullName, phone, profile }) {
  if (!['shipper', 'carrier'].includes(role)) {
    throw Object.assign(new Error('role must be "shipper" or "carrier"'), { status: 400 });
  }

  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    throw Object.assign(new Error('An account with this email already exists'), { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userResult = await client.query(
      `INSERT INTO users (email, password_hash, role, full_name, phone)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, email, role, full_name`,
      [email, passwordHash, role, fullName, phone ?? null]
    );
    const user = userResult.rows[0];

    if (role === 'shipper') {
      await client.query(
        `INSERT INTO shippers (user_id, company_name, billing_address) VALUES ($1, $2, $3)`,
        [user.id, profile?.companyName ?? fullName, profile?.billingAddress ?? null]
      );
    } else {
      await client.query(
        `INSERT INTO carriers (user_id, company_name, fleet_size, base_location)
         VALUES ($1, $2, $3, $4)`,
        [user.id, profile?.companyName ?? fullName, profile?.fleetSize ?? 1, profile?.baseLocation ?? '']
      );
    }

    await client.query('COMMIT');
    return { user, token: signToken(user) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function loginUser({ email, password }) {
  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  const user = result.rows[0];

  if (!user) {
    throw Object.assign(new Error('Invalid email or password'), { status: 401 });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    throw Object.assign(new Error('Invalid email or password'), { status: 401 });
  }

  return {
    user: { id: user.id, email: user.email, role: user.role, full_name: user.full_name },
    token: signToken(user),
  };
}

module.exports = { registerUser, loginUser };
