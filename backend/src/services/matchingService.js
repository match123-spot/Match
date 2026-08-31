const { pool } = require('../config/db');
const { lookupCoords, haversineKm } = require('./geo');

function round2(n) {
  return Math.round(n * 100) / 100;
}

function scoreDistance(shipmentOriginRegion, carrierOriginRegion) {
  const a = lookupCoords(shipmentOriginRegion);
  const b = lookupCoords(carrierOriginRegion);
  if (!a || !b) return 50; // unknown region — neutral score
  const km = haversineKm(a, b);
  return round2(Math.max(0, 100 - km / 20));
}

function scoreTiming(shipment, availability) {
  const shipStart = new Date(shipment.pickup_window_start).getTime();
  const shipEnd = new Date(shipment.pickup_window_end).getTime();
  const availStart = new Date(availability.window_start).getTime();
  const availEnd = new Date(availability.window_end).getTime();

  const overlapMs = Math.max(0, Math.min(shipEnd, availEnd) - Math.max(shipStart, availStart));
  const shipDurationMs = shipEnd - shipStart;
  if (shipDurationMs <= 0) return 0;

  return round2(Math.min(100, (overlapMs / shipDurationMs) * 100));
}

function scoreUtilization(ratio) {
  // Rewards near-full trucks; 85%+ capacity utilization scores 100.
  return round2(Math.min(100, (ratio / 0.85) * 100));
}

async function scoreReliability(carrierId) {
  const { rows } = await pool.query(
    `SELECT AVG(star_rating) AS avg_rating, COUNT(*) AS count FROM ratings WHERE rated_carrier_id = $1`,
    [carrierId]
  );
  const count = Number(rows[0]?.count ?? 0);
  if (count === 0) return 70; // neutral default until the carrier has ratings
  return round2((Number(rows[0].avg_rating) / 5) * 100);
}

/**
 * Ranks eligible carrier_availability entries against a shipment using the
 * weighted scoring model: distance 30%, timing 25%, utilization 15%,
 * reliability 20%, historical acceptance rate 10%.
 */
async function rankCandidates(shipment, limit = 5) {
  const { rows } = await pool.query(
    `SELECT ca.*, c.id AS carrier_id, c.company_name, c.base_location, c.historical_acceptance_rate
     FROM carrier_availability ca
     JOIN carriers c ON c.id = ca.carrier_id
     WHERE ca.truck_type = $1 AND ca.is_booked = false AND ca.available_date >= CURRENT_DATE`,
    [shipment.truck_type_required]
  );

  const scored = [];
  for (const row of rows) {
    const utilizationRatio = shipment.weight_kg / row.truck_capacity_kg;
    if (utilizationRatio > 1) continue;

    const timing = scoreTiming(shipment, row);
    if (timing <= 0) continue;

    const distance = scoreDistance(shipment.origin_region, row.origin_region);
    const utilization = scoreUtilization(utilizationRatio);
    const reliability = await scoreReliability(row.carrier_id);
    const acceptanceRate = round2(Number(row.historical_acceptance_rate));

    const total = round2(
      distance * 0.3 + timing * 0.25 + utilization * 0.15 + reliability * 0.2 + acceptanceRate * 0.1
    );

    scored.push({
      availabilityId: row.id,
      carrier: {
        id: row.carrier_id,
        companyName: row.company_name,
        baseLocation: row.base_location,
        historicalAcceptanceRate: acceptanceRate,
      },
      availability: {
        originRegion: row.origin_region,
        truckType: row.truck_type,
        truckCapacityKg: row.truck_capacity_kg,
        windowStart: row.window_start,
        windowEnd: row.window_end,
      },
      scores: { total, distance, timing, utilization, reliability, acceptanceRate },
    });
  }

  scored.sort((a, b) => b.scores.total - a.scores.total);
  return scored.slice(0, limit);
}

module.exports = { rankCandidates, scoreDistance, scoreTiming, scoreUtilization, scoreReliability };
