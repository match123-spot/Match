const express = require('express');
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth, requireRole('admin'));

router.get('/organizations', async (req, res) => {
  const status = ['pending', 'approved', 'suspended'].includes(req.query.status) ? req.query.status : null;
  const result = await pool.query(
    status
      ? `SELECT * FROM organizations WHERE status = $1 ORDER BY created_at DESC`
      : `SELECT * FROM organizations ORDER BY created_at DESC`,
    status ? [status] : []
  );
  res.json({ organizations: result.rows });
});

router.patch('/organizations/:id', async (req, res) => {
  const { status } = req.body;
  if (!['pending', 'approved', 'suspended'].includes(status)) {
    return res.status(400).json({ error: 'status must be pending, approved, or suspended' });
  }
  const result = await pool.query(
    `UPDATE organizations SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [status, req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Organization not found' });
  res.json({ organization: result.rows[0] });
});

module.exports = router;
