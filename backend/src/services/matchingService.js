const { pool } = require('../config/db');
const { lookupCoords, haversineKm } = require('./geo');

// Hard geographic eligibility cutoff: a truck this far from the shipment
// origin is not a candidate at all, regardless of how well it scores on
// everything else — a carrier in Auckland cannot pick up a load out of
// Wellington. Within this radius, distance is still 30% of the weighted
// score, favouring the closest truck.
const MAX_PICKUP_DISTANCE_KM = 150;

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Returns both the raw distance and the 0-100 score, so callers can enforce
// the hard cutoff and display the actual km, not just the derived score.
function distanceKmAndScore(shipmentOriginRegion, carrierOriginRegion) {
  const a = lookupCoords(shipmentOriginRegion);
  const b = lookupCoords(carrierOriginRegion);
  if (!a || !b) return { km: null, score: 50 }; // unknown region — neutral score, can't compute eligibility
  const km = haversineKm(a, b);
  const score = round2(Math.max(0, 100 - (km / MAX_PICKUP_DISTANCE_KM) * 100));
  return { km: round2(km), score };
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

async function getReliabilityStats(carrierId) {
  const { rows } = await pool.query(
    `SELECT AVG(star_rating) AS avg_rating, COUNT(*) AS count FROM ratings WHERE rated_carrier_id = $1`,
    [carrierId]
  );
  const count = Number(rows[0]?.count ?? 0);
  if (count === 0) {
    return { score: 70, avgRating: null, ratingCount: 0 }; // neutral default until the carrier has ratings
  }
  const avgRating = round2(Number(rows[0].avg_rating));
  return { score: round2((avgRating / 5) * 100), avgRating, ratingCount: count };
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

    const { km: distanceKm, score: distance } = distanceKmAndScore(shipment.origin_region, row.origin_region);
    if (distanceKm != null && distanceKm > MAX_PICKUP_DISTANCE_KM) continue; // hard geographic cutoff

    const utilization = scoreUtilization(utilizationRatio);
    const reliabilityStats = await getReliabilityStats(row.carrier_id);
    const reliability = reliabilityStats.score;
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
        avgRating: reliabilityStats.avgRating,
        ratingCount: reliabilityStats.ratingCount,
      },
      availability: {
        originRegion: row.origin_region,
        truckType: row.truck_type,
        truckCapacityKg: row.truck_capacity_kg,
        windowStart: row.window_start,
        windowEnd: row.window_end,
        distanceKm,
      },
      scores: { total, distance, timing, utilization, reliability, acceptanceRate },
    });
  }

  scored.sort((a, b) => b.scores.total - a.scores.total);
  return scored.slice(0, limit);
}

module.exports = {
  rankCandidates,
  distanceKmAndScore,
  scoreTiming,
  scoreUtilization,
  getReliabilityStats,
  MAX_PICKUP_DISTANCE_KM,
};
