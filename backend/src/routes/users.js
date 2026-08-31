const express = require('express');
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/me', requireAuth, async (req, res) => {
  const result = await pool.query(
    'SELECT id, email, role, full_name, phone, created_at FROM users WHERE id = $1',
    [req.user.sub]
  );
  const user = result.rows[0];
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json({ user });
});

module.exports = router;
