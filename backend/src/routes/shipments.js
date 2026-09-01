const express = require('express');
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { generateMockShipments } = require('../services/otmMockService');
const { recommendPrice } = require('../services/claudeService');

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

  // Ask Claude to recommend the marketplace rate for each shipment, grounded
  // by the formula anchor; fall back to that anchor if Claude fails. This is
  // distinct from contracted_rate, which is what the shipper already pays
  // current_lsp for this lane per the (mocked) OTM pull.
  const priced = await Promise.all(
    mocks.map(async (m) => {
      const ai = await recommendPrice({
        originRegion: m.originRegion,
        destinationRegion: m.destinationRegion,
        weightKg: m.weightKg,
        truckType: m.truckType,
        distanceKm: m.distanceKm ?? 500,
        marketEstimate: m.marketRateAnchor,
      });
      return {
        ...m,
        aiRecommendedRate: ai?.rate ?? m.marketRateAnchor,
        aiRateReasoning: ai?.reasoning ?? null,
      };
    })
  );

  const inserted = [];
  for (const m of priced) {
    const result = await pool.query(
      `INSERT INTO shipments
         (shipper_id, otm_shipment_ref, customer_name, current_lsp, origin_region, destination_region,
          distance_km, weight_kg, pallet_count, truck_type_required, lead_time_hours,
          pickup_window_start, pickup_window_end, expected_delivery_start, expected_delivery_end,
          contracted_rate, ai_recommended_rate, ai_rate_reasoning)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [
        shipperId,
        m.otmRef,
        m.customerName,
        m.currentLsp,
        m.originRegion,
        m.destinationRegion,
        m.distanceKm,
        m.weightKg,
        m.palletCount,
        m.truckType,
        m.leadTimeHours,
        m.pickupStart,
        m.pickupEnd,
        m.expectedDeliveryStart,
        m.expectedDeliveryEnd,
        m.contractedRate,
        m.aiRecommendedRate,
        m.aiRateReasoning,
      ]
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
