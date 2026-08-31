const express = require('express');
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { generateMockShipments } = require('../services/otmMockService');

const router = express.Router();

async function getShipperIdForUser(userId) {
  const result = await pool.query('SELECT id FROM shippers WHERE user_id = $1', [userId]);
  return result.rows[0]?.id ?? null;
}

router.use(requireAuth, requireRole('shipper'));

router.post('/mock-pull', async (req, res) => {
  const shipperId = await getShipperIdForUser(req.user.sub);
  if (!shipperId) return res.status(404).json({ error: 'Shipper profile not found' });

  const count = Math.min(Number(req.body?.count) || 3, 10);
  const mocks = generateMockShipments(count);

  const inserted = [];
  for (const m of mocks) {
    const result = await pool.query(
      `INSERT INTO shipments
         (shipper_id, otm_shipment_ref, origin_region, destination_region, weight_kg, truck_type_required, pickup_window_start, pickup_window_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [shipperId, m.otmRef, m.originRegion, m.destinationRegion, m.weightKg, m.truckType, m.pickupStart, m.pickupEnd]
    );
    inserted.push(result.rows[0]);
  }
  res.status(201).json({ shipments: inserted });
});

router.get('/me', async (req, res) => {
  const shipperId = await getShipperIdForUser(req.user.sub);
  if (!shipperId) return res.status(404).json({ error: 'Shipper profile not found' });

  const result = await pool.query('SELECT * FROM shipments WHERE shipper_id = $1 ORDER BY created_at DESC', [
    shipperId,
  ]);
  res.json({ shipments: result.rows });
});

module.exports = router;
