const express = require('express');
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const TRUCK_TYPES = ['semi', 'B-double', 'rigid', 'refrigerated'];

async function getCarrierIdForOrg(orgId) {
  const result = await pool.query('SELECT id FROM carriers WHERE org_id = $1', [orgId]);
  return result.rows[0]?.id ?? null;
}

router.use(requireAuth, requireRole('carrier'));

router.get('/me', async (req, res) => {
  const carrierId = await getCarrierIdForOrg(req.user.orgId);
  if (!carrierId) return res.status(404).json({ error: 'Carrier profile not found' });

  const result = await pool.query(
    `SELECT * FROM carrier_availability WHERE carrier_id = $1 ORDER BY available_date, window_start`,
    [carrierId]
  );
  res.json({ availability: result.rows });
});

router.post('/', async (req, res) => {
  const { availableDate, truckType, truckCapacityKg, originRegion, windowStart, windowEnd } = req.body;

  if (!availableDate || !truckType || !truckCapacityKg || !originRegion || !windowStart || !windowEnd) {
    return res.status(400).json({
      error: 'availableDate, truckType, truckCapacityKg, originRegion, windowStart, and windowEnd are required',
    });
  }
  if (!TRUCK_TYPES.includes(truckType)) {
    return res.status(400).json({ error: `truckType must be one of: ${TRUCK_TYPES.join(', ')}` });
  }
  if (new Date(windowEnd) <= new Date(windowStart)) {
    return res.status(400).json({ error: 'windowEnd must be after windowStart' });
  }

  const carrierId = await getCarrierIdForOrg(req.user.orgId);
  if (!carrierId) return res.status(404).json({ error: 'Carrier profile not found' });

  try {
    const result = await pool.query(
      `INSERT INTO carrier_availability
         (carrier_id, available_date, truck_type, truck_capacity_kg, origin_region, window_start, window_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [carrierId, availableDate, truckType, truckCapacityKg, originRegion, windowStart, windowEnd]
    );
    res.status(201).json({ availability: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An identical availability entry already exists' });
    }
    throw err;
  }
});

router.delete('/:id', async (req, res) => {
  const carrierId = await getCarrierIdForOrg(req.user.orgId);
  if (!carrierId) return res.status(404).json({ error: 'Carrier profile not found' });

  const result = await pool.query(
    `DELETE FROM carrier_availability WHERE id = $1 AND carrier_id = $2 AND is_booked = false RETURNING id`,
    [req.params.id, carrierId]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Not found, not yours, or already booked' });
  }
  res.status(204).send();
});

module.exports = router;
