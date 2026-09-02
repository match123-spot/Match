const express = require('express');
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { getShipperInsights, getCarrierInsights } = require('../services/insightsService');

const router = express.Router();

// "Day ahead" morning-briefing widget: what's worth a shipper's or carrier's
// attention right now, without them having to dig through every open
// shipment/truck themselves.
router.get('/me', requireAuth, async (req, res) => {
  if (req.user.role === 'shipper') {
    const result = await pool.query('SELECT id FROM shippers WHERE org_id = $1', [req.user.orgId]);
    const shipperId = result.rows[0]?.id;
    if (!shipperId) return res.status(404).json({ error: 'Shipper profile not found' });

    const insights = await getShipperInsights(shipperId);
    return res.json({ role: 'shipper', ...insights });
  }

  if (req.user.role === 'carrier') {
    const result = await pool.query('SELECT id FROM carriers WHERE org_id = $1', [req.user.orgId]);
    const carrierId = result.rows[0]?.id;
    if (!carrierId) return res.status(404).json({ error: 'Carrier profile not found' });

    const insights = await getCarrierInsights(carrierId);
    return res.json({ role: 'carrier', ...insights });
  }

  res.json({ role: req.user.role, count: 0, opportunities: [] });
});

module.exports = router;
