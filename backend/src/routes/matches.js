const express = require('express');
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { rankCandidates } = require('../services/matchingService');
const { explainMatch } = require('../services/claudeService');

const router = express.Router();

router.get('/candidates/:shipmentId', requireAuth, requireRole('shipper'), async (req, res) => {
  const result = await pool.query(
    `SELECT s.* FROM shipments s
     JOIN shippers sh ON sh.id = s.shipper_id
     WHERE s.id = $1 AND sh.user_id = $2`,
    [req.params.shipmentId, req.user.sub]
  );
  const shipment = result.rows[0];
  if (!shipment) return res.status(404).json({ error: 'Shipment not found' });

  const candidates = await rankCandidates(shipment);
  if (candidates.length === 0) {
    return res.json({ candidates: [] });
  }

  const top = candidates[0];
  const explanation = await explainMatch({
    shipment,
    carrier: top.carrier,
    availability: top.availability,
    scores: top.scores,
  });

  res.json({
    candidates: candidates.map((c, idx) => ({ ...c, explanation: idx === 0 ? explanation : null })),
  });
});

module.exports = router;
