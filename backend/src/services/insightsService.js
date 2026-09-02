// "Day ahead" predictive insights — a morning-briefing widget on both
// dashboards. Deliberately deterministic (built on the same weighted
// scoring engine and AI-recommended pricing already used everywhere else
// in the matching flow), not a live LLM call on every dashboard load — the
// prediction *is* the scoring model; Claude's job elsewhere is explaining
// individual matches, not re-deriving this from scratch each time.
const { pool } = require('../config/db');
const { rankCandidates, scoreCandidateRow } = require('./matchingService');
const {
  INSIGHT_WINDOW_HOURS,
  INSIGHT_SHIPPER_SAVINGS_THRESHOLD_PCT,
  INSIGHT_CARRIER_SCORE_THRESHOLD,
  INSIGHT_MAX_RESULTS,
} = require('../config/matching.config');

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Shipper-side: which of my own not-yet-matched shipments, due to pick up in
 * the next INSIGHT_WINDOW_HOURS, look like a genuinely attractive spot-market
 * opportunity — i.e. the AI marketplace rate beats what I'm already paying my
 * contracted LSP by a meaningful margin, AND real carrier capacity actually
 * exists to take it (a savings estimate nobody can fulfil isn't an
 * opportunity, it's noise).
 */
async function getShipperInsights(shipperId) {
  const { rows: shipments } = await pool.query(
    `SELECT * FROM shipments
     WHERE shipper_id = $1 AND status = 'pending'
       AND pickup_window_start <= now() + ($2 || ' hours')::interval
       AND contracted_rate IS NOT NULL AND ai_recommended_rate IS NOT NULL
     ORDER BY pickup_window_start`,
    [shipperId, INSIGHT_WINDOW_HOURS]
  );

  const opportunities = [];
  for (const shipment of shipments) {
    const contracted = Number(shipment.contracted_rate);
    const aiRate = Number(shipment.ai_recommended_rate);
    const savingsAmount = contracted - aiRate;
    const savingsPct = (savingsAmount / contracted) * 100;
    if (savingsPct < INSIGHT_SHIPPER_SAVINGS_THRESHOLD_PCT) continue;

    // Real supply check — reuses the exact same eligibility/scoring rules as
    // an actual match request, so this can't promise a saving with no
    // carrier able to deliver it.
    const [topCandidate] = await rankCandidates(shipment, 1);
    if (!topCandidate) continue; // savings look good on paper, but nobody could actually take it right now
    const topScore = topCandidate.scores.total;

    opportunities.push({
      shipmentId: shipment.id,
      originRegion: shipment.origin_region,
      destinationRegion: shipment.destination_region,
      pickupWindowStart: shipment.pickup_window_start,
      truckTypeRequired: shipment.truck_type_required,
      contractedRate: round2(contracted),
      aiRecommendedRate: round2(aiRate),
      savingsAmount: round2(savingsAmount),
      savingsPct: round2(savingsPct),
      topCandidateScore: topScore,
    });
  }

  opportunities.sort((a, b) => b.savingsPct - a.savingsPct);
  const top = opportunities.slice(0, INSIGHT_MAX_RESULTS);

  return {
    windowHours: INSIGHT_WINDOW_HOURS,
    count: opportunities.length,
    totalPotentialSavings: round2(opportunities.reduce((sum, o) => sum + o.savingsAmount, 0)),
    opportunities: top,
  };
}

/**
 * Carrier-side: which open shipments — anyone's, not just ones already
 * matched to me — score well against my own open trucks in the next
 * INSIGHT_WINDOW_HOURS. This is the mirror image of rankCandidates: instead
 * of ranking every carrier against one shipment, it checks every open
 * shipment against my trucks specifically, reusing the identical scoring
 * function so "attractive" means the same thing on both sides of the
 * marketplace.
 */
async function getCarrierInsights(carrierId) {
  const { rows: myAvailability } = await pool.query(
    `SELECT ca.*, $2 AS carrier_id, o.company_name, c.base_location, c.historical_acceptance_rate
     FROM carrier_availability ca
     JOIN carriers c ON c.id = ca.carrier_id
     JOIN organizations o ON o.id = c.org_id
     WHERE ca.carrier_id = $1 AND ca.is_booked = false AND ca.available_date >= CURRENT_DATE`,
    [carrierId, carrierId]
  );
  if (myAvailability.length === 0) {
    return { windowHours: INSIGHT_WINDOW_HOURS, count: 0, areas: [], opportunities: [] };
  }

  const { rows: shipments } = await pool.query(
    `SELECT s.* FROM shipments s
     JOIN shippers sh ON sh.id = s.shipper_id
     JOIN organizations o ON o.id = sh.org_id
     WHERE s.status = 'pending' AND o.status = 'approved'
       AND s.pickup_window_start <= now() + ($1 || ' hours')::interval`,
    [INSIGHT_WINDOW_HOURS]
  );

  const opportunities = [];
  for (const shipment of shipments) {
    let best = null;
    for (const row of myAvailability) {
      const candidate = await scoreCandidateRow(shipment, row);
      if (candidate && (!best || candidate.scores.total > best.scores.total)) {
        best = candidate;
      }
    }
    if (!best || best.scores.total < INSIGHT_CARRIER_SCORE_THRESHOLD) continue;

    opportunities.push({
      shipmentId: shipment.id,
      originRegion: shipment.origin_region,
      destinationRegion: shipment.destination_region,
      pickupWindowStart: shipment.pickup_window_start,
      weightKg: shipment.weight_kg,
      truckTypeRequired: shipment.truck_type_required,
      distanceKm: best.availability.distanceKm,
      estimatedRate: shipment.ai_recommended_rate != null ? round2(Number(shipment.ai_recommended_rate)) : null,
      score: best.scores.total,
      bestTruckType: best.availability.truckType,
    });
  }

  opportunities.sort((a, b) => b.score - a.score);
  const top = opportunities.slice(0, INSIGHT_MAX_RESULTS);
  const areas = [...new Set(top.map((o) => o.originRegion))];

  return {
    windowHours: INSIGHT_WINDOW_HOURS,
    count: opportunities.length,
    areas,
    opportunities: top,
  };
}

module.exports = { getShipperInsights, getCarrierInsights };
