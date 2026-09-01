const express = require('express');
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/me', requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT u.id, u.email, u.role, u.full_name, u.phone, u.created_at,
            u.org_id, o.status AS org_status, o.company_name AS org_company_name
     FROM users u LEFT JOIN organizations o ON o.id = u.org_id
     WHERE u.id = $1`,
    [req.user.sub]
  );
  const user = result.rows[0];
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json({ user });
});

module.exports = router;
