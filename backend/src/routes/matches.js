const express = require('express');
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { rankCandidates } = require('../services/matchingService');
const { explainMatch } = require('../services/claudeService');
const {
  createMatchForShipment,
  approveMatch,
  rejectMatch,
  getMatchForUser,
} = require('../services/matchWorkflowService');

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

// Shipper requests a match for a shipment, opening a 20-minute dual-approval window.
router.post('/', requireAuth, requireRole('shipper'), async (req, res) => {
  const { shipmentId } = req.body;
  if (!shipmentId) return res.status(400).json({ error: 'shipmentId is required' });

  const result = await pool.query(
    `SELECT s.* FROM shipments s
     JOIN shippers sh ON sh.id = s.shipper_id
     WHERE s.id = $1 AND sh.user_id = $2`,
    [shipmentId, req.user.sub]
  );
  const shipment = result.rows[0];
  if (!shipment) return res.status(404).json({ error: 'Shipment not found' });
  if (shipment.status === 'booked') return res.status(409).json({ error: 'Shipment is already booked' });

  const match = await createMatchForShipment(shipment);
  if (!match) return res.status(404).json({ error: 'No eligible carrier availability found' });

  res.status(201).json({ match });
});

const MATCH_SELECT = `
  SELECT m.*, s.origin_region, s.destination_region, s.weight_kg, s.truck_type_required,
         s.pickup_window_start, s.pickup_window_end, s.otm_shipment_ref, s.status AS shipment_status,
         s.distance_km, s.pallet_count, s.lead_time_hours, s.customer_name, s.current_lsp,
         s.expected_delivery_start, s.expected_delivery_end,
         s.contracted_rate, s.ai_recommended_rate, s.ai_rate_reasoning,
         c.company_name AS carrier_company_name, c.base_location AS carrier_base_location,
         ca.origin_region AS availability_origin_region, ca.window_start AS availability_window_start,
         ca.window_end AS availability_window_end,
         cr.avg_star AS carrier_avg_star, cr.rating_count AS carrier_rating_count,
         sr.avg_star AS shipper_avg_star, sr.rating_count AS shipper_rating_count
  FROM matches m
  JOIN shipments s ON s.id = m.shipment_id
  JOIN carriers c ON c.id = m.carrier_id
  LEFT JOIN carrier_availability ca ON ca.id = m.carrier_availability_id
  LEFT JOIN LATERAL (
    SELECT AVG(star_rating) AS avg_star, COUNT(*) AS rating_count FROM ratings WHERE rated_carrier_id = c.id
  ) cr ON true
  LEFT JOIN LATERAL (
    SELECT AVG(star_rating) AS avg_star, COUNT(*) AS rating_count FROM ratings WHERE rated_shipper_id = s.shipper_id
  ) sr ON true
`;

router.get('/me', requireAuth, async (req, res) => {
  let query;
  if (req.user.role === 'shipper') {
    query = pool.query(
      `${MATCH_SELECT} JOIN shippers sh ON sh.id = s.shipper_id WHERE sh.user_id = $1 ORDER BY m.created_at DESC`,
      [req.user.sub]
    );
  } else {
    query = pool.query(
      `${MATCH_SELECT} JOIN carriers cc ON cc.id = m.carrier_id WHERE cc.user_id = $1 ORDER BY m.created_at DESC`,
      [req.user.sub]
    );
  }
  const { rows } = await query;

  const matchIds = rows.map((r) => r.id);
  let ratedMatchIds = new Set();
  if (matchIds.length > 0) {
    const ratings = await pool.query(
      `SELECT match_id FROM ratings WHERE rater_role = $1 AND match_id = ANY($2)`,
      [req.user.role, matchIds]
    );
    ratedMatchIds = new Set(ratings.rows.map((r) => r.match_id));
  }

  res.json({ matches: rows.map((r) => ({ ...r, already_rated: ratedMatchIds.has(r.id) })) });
});

router.post('/:id/complete', requireAuth, async (req, res) => {
  const resolved = await getMatchForUser(req.params.id, req.user.sub);
  if (!resolved) return res.status(404).json({ error: 'Match not found' });
  if (resolved.match.status !== 'booked') {
    return res.status(409).json({ error: 'Only a booked match can be marked complete' });
  }

  await pool.query(`UPDATE shipments SET status = 'completed', updated_at = now() WHERE id = $1`, [
    resolved.match.shipment_id,
  ]);
  res.json({ status: 'completed' });
});

router.post('/:id/approve', requireAuth, async (req, res) => {
  const resolved = await getMatchForUser(req.params.id, req.user.sub);
  if (!resolved) return res.status(404).json({ error: 'Match not found' });

  const match = await approveMatch(req.params.id, resolved.role);
  if (!match) return res.status(409).json({ error: 'Match is no longer open for approval' });

  res.json({ match });
});

router.post('/:id/reject', requireAuth, async (req, res) => {
  const resolved = await getMatchForUser(req.params.id, req.user.sub);
  if (!resolved) return res.status(404).json({ error: 'Match not found' });

  const result = await rejectMatch(req.params.id, resolved.role);
  if (!result) return res.status(409).json({ error: 'Match is no longer open for rejection' });

  res.json(result);
});

module.exports = router;
