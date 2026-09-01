const express = require('express');
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/me', requireAuth, async (req, res) => {
  if (req.user.role === 'shipper') {
    const { rows } = await pool.query('SELECT auto_approve_max_cost FROM shippers WHERE org_id = $1', [
      req.user.orgId,
    ]);
    return res.json({ autoApproveMaxCost: rows[0]?.auto_approve_max_cost ?? null });
  }
  const { rows } = await pool.query('SELECT auto_approve_min_income FROM carriers WHERE org_id = $1', [
    req.user.orgId,
  ]);
  res.json({ autoApproveMinIncome: rows[0]?.auto_approve_min_income ?? null });
});

router.patch('/shipper', requireAuth, requireRole('shipper'), async (req, res) => {
  const { autoApproveMaxCost } = req.body;
  if (autoApproveMaxCost != null && (typeof autoApproveMaxCost !== 'number' || autoApproveMaxCost < 0)) {
    return res.status(400).json({ error: 'autoApproveMaxCost must be a non-negative number, or null to disable' });
  }
  await pool.query('UPDATE shippers SET auto_approve_max_cost = $1, updated_at = now() WHERE org_id = $2', [
    autoApproveMaxCost,
    req.user.orgId,
  ]);
  res.json({ autoApproveMaxCost: autoApproveMaxCost ?? null });
});

router.patch('/carrier', requireAuth, requireRole('carrier'), async (req, res) => {
  const { autoApproveMinIncome } = req.body;
  if (autoApproveMinIncome != null && (typeof autoApproveMinIncome !== 'number' || autoApproveMinIncome < 0)) {
    return res.status(400).json({ error: 'autoApproveMinIncome must be a non-negative number, or null to disable' });
  }
  await pool.query('UPDATE carriers SET auto_approve_min_income = $1, updated_at = now() WHERE org_id = $2', [
    autoApproveMinIncome,
    req.user.orgId,
  ]);
  res.json({ autoApproveMinIncome: autoApproveMinIncome ?? null });
});

module.exports = router;
