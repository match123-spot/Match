const express = require('express');
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { lookupCoords } = require('../services/geo');

const router = express.Router();

// Shippers see currently open carrier capacity (not yet booked, window hasn't passed).
router.get('/carriers', requireAuth, requireRole('shipper'), async (req, res) => {
  const result = await pool.query(
    `SELECT ca.id AS availability_id, ca.origin_region, ca.truck_type, ca.truck_capacity_kg,
            ca.window_start, ca.window_end,
            c.id AS carrier_id, o.company_name, c.historical_acceptance_rate,
            r.avg_star, r.rating_count
     FROM carrier_availability ca
     JOIN carriers c ON c.id = ca.carrier_id
     JOIN organizations o ON o.id = c.org_id
     LEFT JOIN LATERAL (
       SELECT AVG(star_rating) AS avg_star, COUNT(*) AS rating_count FROM ratings WHERE rated_carrier_id = c.id
     ) r ON true
     WHERE ca.is_booked = false AND ca.window_end > now() AND o.status = 'approved'
     ORDER BY ca.window_start`
  );

  const carriers = result.rows
    .map((r) => ({ ...r, coords: lookupCoords(r.origin_region) }))
    .filter((r) => r.coords);

  res.json({ carriers });
});

// Carriers see currently open shipments (not yet booked) to gauge demand.
router.get('/shipments', requireAuth, requireRole('carrier'), async (req, res) => {
  const result = await pool.query(
    `SELECT s.id, s.origin_region, s.destination_region, s.distance_km, s.weight_kg, s.pallet_count,
            s.truck_type_required, s.customer_name, s.current_lsp, s.lead_time_hours,
            s.pickup_window_start, s.pickup_window_end, s.expected_delivery_start, s.expected_delivery_end,
            s.contracted_rate, s.ai_recommended_rate, s.ai_rate_reasoning
     FROM shipments s
     JOIN shippers sh ON sh.id = s.shipper_id
     JOIN organizations o ON o.id = sh.org_id
     WHERE s.status IN ('pending', 'matching') AND o.status = 'approved'
     ORDER BY s.pickup_window_start`
  );

  const shipments = result.rows
    .map((r) => ({
      ...r,
      originCoords: lookupCoords(r.origin_region),
      destinationCoords: lookupCoords(r.destination_region),
    }))
    .filter((r) => r.originCoords && r.destinationCoords);

  res.json({ shipments });
});

module.exports = router;
