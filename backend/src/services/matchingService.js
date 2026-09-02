const { pool } = require('../config/db');
const { lookupCoords, haversineKm } = require('./geo');
const {
  SCORE_WEIGHTS,
  MAX_PICKUP_DISTANCE_KM,
  UTILIZATION_FULL_RATIO,
  RELIABILITY_NEUTRAL_SCORE,
  TRUCK_CLASS_RANK,
  TRUCK_RATE_MULTIPLIER,
  PALLET_CAPACITY,
  DEFAULT_PALLET_CAPACITY,
  DEFAULT_CANDIDATE_LIMIT,
} = require('../config/matching.config');

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
  // Rewards near-full trucks; UTILIZATION_FULL_RATIO+ capacity scores 100.
  return round2(Math.min(100, (ratio / UTILIZATION_FULL_RATIO) * 100));
}

// A load can be bound by weight or by pallet slots, whichever is tighter —
// e.g. 15 pallets of light freight fills a rigid's pallet capacity long
// before it hits the weight limit. Returns the binding ratio.
function utilizationRatio(shipment, availabilityRow) {
  const weightRatio = shipment.weight_kg / availabilityRow.truck_capacity_kg;
  if (shipment.pallet_count == null) return weightRatio;
  const palletCapacity = PALLET_CAPACITY[availabilityRow.truck_type] ?? DEFAULT_PALLET_CAPACITY;
  const palletRatio = shipment.pallet_count / palletCapacity;
  return Math.max(weightRatio, palletRatio);
}

async function getReliabilityStats(carrierId) {
  const { rows } = await pool.query(
    `SELECT AVG(star_rating) AS avg_rating, COUNT(*) AS count FROM ratings WHERE rated_carrier_id = $1`,
    [carrierId]
  );
  const count = Number(rows[0]?.count ?? 0);
  if (count === 0) {
    return { score: RELIABILITY_NEUTRAL_SCORE, avgRating: null, ratingCount: 0 }; // neutral until the carrier has ratings
  }
  const avgRating = round2(Number(rows[0].avg_rating));
  return { score: round2((avgRating / 5) * 100), avgRating, ratingCount: count };
}

/**
 * Scores one carrier_availability row (as returned by the SQL shape used
 * below: id, carrier_id, company_name, base_location, historical_acceptance_rate,
 * truck_type, truck_capacity_kg, origin_region, window_start, window_end)
 * against a shipment. Returns null if ineligible, otherwise the same shape
 * rankCandidates() has always returned. Pulled out on its own so both
 * "rank every carrier against my shipment" (rankCandidates, shipper side)
 * and "check my trucks against every open shipment" (insightsService,
 * carrier side) share one scoring implementation instead of two drifting
 * copies of the same rules.
 *
 * Truck type eligibility is capacity-based, not a rigid category match:
 * a refrigerated load requires a refrigerated truck (temperature control
 * can't be substituted), but otherwise any rigid/semi/B-double with enough
 * capacity is eligible — including a *smaller* truck than the shipper
 * originally specified. Utilization scoring then naturally favours a
 * right-sized truck over an under-filled bigger one, and the result is
 * flagged as a `truckType.match: 'downsize'` recommendation.
 */
async function scoreCandidateRow(shipment, row) {
  const requiresRefrigerated = shipment.truck_type_required === 'refrigerated';
  if (requiresRefrigerated && row.truck_type !== 'refrigerated') return null;
  if (!requiresRefrigerated && row.truck_type === 'refrigerated') return null;

  // Hard cutoff is weight only — that's the carrier's actual declared
  // capacity. Pallet capacity is a rough per-category estimate (real trucks
  // vary a lot by deck length), so it informs the utilization score but
  // shouldn't alone disqualify a candidate that fits on weight.
  const weightRatio = shipment.weight_kg / row.truck_capacity_kg;
  if (weightRatio > 1) return null;

  const timing = scoreTiming(shipment, row);
  if (timing <= 0) return null;

  const { km: distanceKm, score: distance } = distanceKmAndScore(shipment.origin_region, row.origin_region);
  if (distanceKm != null && distanceKm > MAX_PICKUP_DISTANCE_KM) return null; // hard geographic cutoff

  const utilization = scoreUtilization(utilizationRatio(shipment, row));
  const reliabilityStats = await getReliabilityStats(row.carrier_id);
  const reliability = reliabilityStats.score;
  const acceptanceRate = round2(Number(row.historical_acceptance_rate));

  const total = round2(
    distance * SCORE_WEIGHTS.distance +
      timing * SCORE_WEIGHTS.timing +
      utilization * SCORE_WEIGHTS.utilization +
      reliability * SCORE_WEIGHTS.reliability +
      acceptanceRate * SCORE_WEIGHTS.acceptanceRate
  );

  const requiredRank = TRUCK_CLASS_RANK[shipment.truck_type_required] ?? null;
  const offeredRank = TRUCK_CLASS_RANK[row.truck_type] ?? null;
  let truckTypeMatch = 'exact';
  if (requiredRank != null && offeredRank != null) {
    if (offeredRank < requiredRank) truckTypeMatch = 'downsize';
    else if (offeredRank > requiredRank) truckTypeMatch = 'upsize';
  }

  let estimatedRate = null;
  if (truckTypeMatch !== 'exact' && shipment.ai_recommended_rate != null) {
    const fromMultiplier = TRUCK_RATE_MULTIPLIER[shipment.truck_type_required] ?? 1;
    const toMultiplier = TRUCK_RATE_MULTIPLIER[row.truck_type] ?? 1;
    estimatedRate = round2((Number(shipment.ai_recommended_rate) / fromMultiplier) * toMultiplier);
  }

  return {
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
    truckType: {
      required: shipment.truck_type_required,
      offered: row.truck_type,
      match: truckTypeMatch,
      estimatedRate,
    },
    scores: { total, distance, timing, utilization, reliability, acceptanceRate },
  };
}

/**
 * Ranks eligible carrier_availability entries against a shipment using the
 * weighted scoring model: distance 30%, timing 25%, utilization 15%,
 * reliability 20%, historical acceptance rate 10%.
 */
async function rankCandidates(shipment, limit = DEFAULT_CANDIDATE_LIMIT) {
  const requiresRefrigerated = shipment.truck_type_required === 'refrigerated';
  const truckTypeClause = requiresRefrigerated ? `ca.truck_type = 'refrigerated'` : `ca.truck_type != 'refrigerated'`;
  const { rows } = await pool.query(
    `SELECT ca.*, c.id AS carrier_id, o.company_name, c.base_location, c.historical_acceptance_rate
     FROM carrier_availability ca
     JOIN carriers c ON c.id = ca.carrier_id
     JOIN organizations o ON o.id = c.org_id
     WHERE ${truckTypeClause} AND ca.is_booked = false AND ca.available_date >= CURRENT_DATE
       AND o.status = 'approved'`
  );

  const scored = [];
  for (const row of rows) {
    const candidate = await scoreCandidateRow(shipment, row);
    if (candidate) scored.push(candidate);
  }

  scored.sort((a, b) => b.scores.total - a.scores.total);
  return scored.slice(0, limit);
}

module.exports = {
  rankCandidates,
  scoreCandidateRow,
  distanceKmAndScore,
  scoreTiming,
  scoreUtilization,
  utilizationRatio,
  getReliabilityStats,
  MAX_PICKUP_DISTANCE_KM,
  TRUCK_CLASS_RANK,
  TRUCK_RATE_MULTIPLIER,
  PALLET_CAPACITY,
};
