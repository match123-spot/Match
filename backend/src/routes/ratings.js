const express = require('express');
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { getMatchForUser } = require('../services/matchWorkflowService');

const router = express.Router();

router.post('/', requireAuth, async (req, res) => {
  const {
    matchId,
    starRating,
    comment,
    onTime,
    completed,
    hadDamageOrComplaint,
    responseTimeMinutes,
    wasCancelled,
  } = req.body;

  if (!matchId || !starRating) {
    return res.status(400).json({ error: 'matchId and starRating are required' });
  }
  if (starRating < 1 || starRating > 5) {
    return res.status(400).json({ error: 'starRating must be between 1 and 5' });
  }

  const resolved = await getMatchForUser(matchId, req.user.sub);
  if (!resolved) return res.status(404).json({ error: 'Match not found' });
  const { match, role } = resolved;

  if (match.status !== 'booked') {
    return res.status(409).json({ error: 'Match must be booked before it can be rated' });
  }

  const shipmentResult = await pool.query('SELECT status, shipper_id FROM shipments WHERE id = $1', [
    match.shipment_id,
  ]);
  const shipment = shipmentResult.rows[0];
  if (shipment.status !== 'completed') {
    return res.status(409).json({ error: 'Shipment must be marked complete before it can be rated' });
  }

  const existing = await pool.query('SELECT id FROM ratings WHERE match_id = $1 AND rater_role = $2', [
    matchId,
    role,
  ]);
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: 'You already rated this match' });
  }

  let result;
  if (role === 'shipper') {
    result = await pool.query(
      `INSERT INTO ratings
         (match_id, rater_role, rated_carrier_id, star_rating, on_time, completed, had_damage_or_complaint, comment)
       VALUES ($1, 'shipper', $2, $3, $4, $5, $6, $7) RETURNING *`,
      [matchId, match.carrier_id, starRating, onTime ?? null, completed ?? null, hadDamageOrComplaint ?? null, comment ?? null]
    );
  } else {
    result = await pool.query(
      `INSERT INTO ratings
         (match_id, rater_role, rated_shipper_id, star_rating, response_time_minutes, was_cancelled, comment)
       VALUES ($1, 'carrier', $2, $3, $4, $5, $6) RETURNING *`,
      [matchId, shipment.shipper_id, starRating, responseTimeMinutes ?? null, wasCancelled ?? null, comment ?? null]
    );
  }

  res.status(201).json({ rating: result.rows[0] });
});

router.get('/me/summary', requireAuth, async (req, res) => {
  if (req.user.role === 'carrier') {
    const carrier = await pool.query('SELECT id FROM carriers WHERE user_id = $1', [req.user.sub]);
    const carrierId = carrier.rows[0]?.id;
    if (!carrierId) return res.status(404).json({ error: 'Carrier profile not found' });

    const { rows } = await pool.query(
      `SELECT
         COUNT(*) AS count,
         AVG(star_rating) AS avg_star,
         AVG(CASE WHEN on_time THEN 1 ELSE 0 END) AS on_time_rate,
         AVG(CASE WHEN completed THEN 1 ELSE 0 END) AS completion_rate,
         AVG(CASE WHEN had_damage_or_complaint THEN 1 ELSE 0 END) AS damage_complaint_rate
       FROM ratings WHERE rated_carrier_id = $1`,
      [carrierId]
    );
    return res.json({ role: 'carrier', summary: rows[0] });
  }

  const shipper = await pool.query('SELECT id FROM shippers WHERE user_id = $1', [req.user.sub]);
  const shipperId = shipper.rows[0]?.id;
  if (!shipperId) return res.status(404).json({ error: 'Shipper profile not found' });

  const { rows } = await pool.query(
    `SELECT
       COUNT(*) AS count,
       AVG(star_rating) AS avg_star,
       AVG(response_time_minutes) AS avg_response_time_minutes,
       AVG(CASE WHEN was_cancelled THEN 1 ELSE 0 END) AS cancellation_rate
     FROM ratings WHERE rated_shipper_id = $1`,
    [shipperId]
  );
  res.json({ role: 'shipper', summary: rows[0] });
});

router.get('/carrier/:carrierId/summary', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) AS count,
       AVG(star_rating) AS avg_star,
       AVG(CASE WHEN on_time THEN 1 ELSE 0 END) AS on_time_rate,
       AVG(CASE WHEN completed THEN 1 ELSE 0 END) AS completion_rate,
       AVG(CASE WHEN had_damage_or_complaint THEN 1 ELSE 0 END) AS damage_complaint_rate
     FROM ratings WHERE rated_carrier_id = $1`,
    [req.params.carrierId]
  );
  res.json({ summary: rows[0] });
});

router.get('/shipper/:shipperId/summary', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) AS count,
       AVG(star_rating) AS avg_star,
       AVG(response_time_minutes) AS avg_response_time_minutes,
       AVG(CASE WHEN was_cancelled THEN 1 ELSE 0 END) AS cancellation_rate
     FROM ratings WHERE rated_shipper_id = $1`,
    [req.params.shipperId]
  );
  res.json({ summary: rows[0] });
});

module.exports = router;
