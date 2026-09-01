const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

const SALT_ROUNDS = 12;
const TOKEN_TTL = '7d';

function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email, orgId: user.org_id },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

// Finds an existing org by exact company name + type (case-insensitive) so a
// second person at the same company joins it instead of creating a
// duplicate. Otherwise creates a new org, landing 'pending' until an admin
// approves it. Proper invite/claim flow is a known follow-up — see
// docs/ARCHITECTURE.md §9 — this is the simplest thing that works for MVP.
async function findOrCreateOrg(client, { type, companyName }) {
  const existing = await client.query(
    `SELECT id, status FROM organizations WHERE type = $1 AND lower(company_name) = lower($2)`,
    [type, companyName]
  );
  if (existing.rows.length > 0) return existing.rows[0];

  const created = await client.query(
    `INSERT INTO organizations (type, company_name, status) VALUES ($1, $2, 'pending') RETURNING id, status`,
    [type, companyName]
  );
  return created.rows[0];
}

async function registerUser({ email, password, role, fullName, phone, profile }) {
  if (!['shipper', 'carrier'].includes(role)) {
    throw Object.assign(new Error('role must be "shipper" or "carrier"'), { status: 400 });
  }

  const companyName = profile?.companyName ?? fullName;

  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    throw Object.assign(new Error('An account with this email already exists'), { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const org = await findOrCreateOrg(client, { type: role, companyName });

    // Only set up the org profile row (shippers/carriers) the first time —
    // an existing org joined by a second user already has one.
    if (role === 'shipper') {
      await client.query(
        `INSERT INTO shippers (org_id, billing_address)
         VALUES ($1, $2) ON CONFLICT (org_id) DO NOTHING`,
        [org.id, profile?.billingAddress ?? null]
      );
    } else {
      await client.query(
        `INSERT INTO carriers (org_id, fleet_size, base_location)
         VALUES ($1, $2, $3) ON CONFLICT (org_id) DO NOTHING`,
        [org.id, profile?.fleetSize ?? 1, profile?.baseLocation ?? '']
      );
    }

    const userResult = await client.query(
      `INSERT INTO users (email, password_hash, role, full_name, phone, org_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, email, role, full_name, org_id`,
      [email, passwordHash, role, fullName, phone ?? null, org.id]
    );
    const user = userResult.rows[0];

    await client.query('COMMIT');
    return { user, org, token: signToken(user) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function loginUser({ email, password }) {
  const result = await pool.query(
    `SELECT u.*, o.status AS org_status, o.company_name AS org_company_name
     FROM users u LEFT JOIN organizations o ON o.id = u.org_id
     WHERE u.email = $1`,
    [email]
  );
  const user = result.rows[0];

  if (!user) {
    throw Object.assign(new Error('Invalid email or password'), { status: 401 });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    throw Object.assign(new Error('Invalid email or password'), { status: 401 });
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      full_name: user.full_name,
      org_id: user.org_id,
      org_status: user.org_status,
      org_company_name: user.org_company_name,
    },
    token: signToken(user),
  };
}

module.exports = { registerUser, loginUser };
