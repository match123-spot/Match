// Centralized, versioned configuration for the AI matching engine.
// Nothing that tunes matching behavior should be a magic number inline in
// matchingService.js / matchWorkflowService.js / geo.js — it belongs here,
// so changing it is a one-place, reviewable diff. See docs/ARCHITECTURE.md §5.

// Weighted scoring model — must sum to 1. Distance 30% / timing 25% /
// utilization 15% / reliability 20% / acceptance rate 10%.
const SCORE_WEIGHTS = {
  distance: 0.3,
  timing: 0.25,
  utilization: 0.15,
  reliability: 0.2,
  acceptanceRate: 0.1,
};

// Hard geographic eligibility cutoff (km): a truck this far from the
// shipment origin is not a candidate at all, regardless of how well it
// scores on everything else — a carrier in Auckland cannot pick up a load
// out of Wellington.
const MAX_PICKUP_DISTANCE_KM = 150;

// Utilization ratio at which a truck is considered "full" for scoring
// purposes — 85%+ capacity utilization scores 100, not just 100% exactly.
const UTILIZATION_FULL_RATIO = 0.85;

// Reliability score assigned to a carrier with zero ratings yet (neutral —
// neither penalized nor rewarded until they build a track record).
const RELIABILITY_NEUTRAL_SCORE = 70;

// Truck body-type size class, used to detect when a load could move on a
// smaller (cheaper) truck than the shipper originally specified, or would
// need a bigger one. Refrigerated is a separate axis (temperature control,
// not size) so it's excluded from this ranking and never substituted.
const TRUCK_CLASS_RANK = { rigid: 1, semi: 2, 'B-double': 3 };

// Rough relative linehaul rate multiplier by truck class, used only to
// estimate the savings/premium of a right-sized substitution — not a real
// rate lookup, just a heuristic anchor consistent with the premiums Claude's
// pricing prompt already reasons about.
const TRUCK_RATE_MULTIPLIER = { rigid: 1.0, semi: 1.12, 'B-double': 1.28, refrigerated: 1.2 };

// Typical AU/NZ pallet capacity by truck type — a load can be pallet-bound
// before it's weight-bound (e.g. light but bulky freight).
const PALLET_CAPACITY = { rigid: 12, semi: 24, 'B-double': 34, refrigerated: 20 };
const DEFAULT_PALLET_CAPACITY = 24;

// Dual-approval window before a match auto-expires and rematches.
const APPROVAL_WINDOW_MS = 20 * 60 * 1000;

// rankCandidates() returns this many ranked candidates by default; the
// rematch/live-candidates paths scan a deeper pool so there's somewhere to
// go when the top pick has already been offered and rejected.
const DEFAULT_CANDIDATE_LIMIT = 5;
const CANDIDATE_POOL_SIZE = 10;

// AU/NZ freight-hub coordinate lookup — stands in for real geocoding until
// that's wired up (see docs/ARCHITECTURE.md open questions). Mock shipments
// and the carrier availability form both use these region names.
const REGION_COORDS = {
  'sydney, nsw': { lat: -33.8688, lng: 151.2093 },
  'melbourne, vic': { lat: -37.8136, lng: 144.9631 },
  'brisbane, qld': { lat: -27.4698, lng: 153.0251 },
  'perth, wa': { lat: -31.9505, lng: 115.8605 },
  'adelaide, sa': { lat: -34.9285, lng: 138.6007 },
  'canberra, act': { lat: -35.2809, lng: 149.13 },
  'hobart, tas': { lat: -42.8821, lng: 147.3272 },
  'darwin, nt': { lat: -12.4634, lng: 130.8456 },
  'auckland, nz': { lat: -36.8485, lng: 174.7633 },
  'wellington, nz': { lat: -41.2865, lng: 174.7762 },
  'christchurch, nz': { lat: -43.5321, lng: 172.6362 },
};

// Country per region — used to keep mock shipments road-only. AU<->NZ needs
// a sea/air leg (Tasman Sea), so those pairs are excluded from mock
// generation. Interisland/Bass Strait RORO ferry lanes (Auckland/
// Wellington<->Christchurch, mainland AU<->Hobart) count as road freight by
// industry convention — trucks drive on and off, no different mode or
// customs process — so those stay in.
const REGION_COUNTRY = {
  'sydney, nsw': 'AU',
  'melbourne, vic': 'AU',
  'brisbane, qld': 'AU',
  'perth, wa': 'AU',
  'adelaide, sa': 'AU',
  'canberra, act': 'AU',
  'hobart, tas': 'AU',
  'darwin, nt': 'AU',
  'auckland, nz': 'NZ',
  'wellington, nz': 'NZ',
  'christchurch, nz': 'NZ',
};

module.exports = {
  SCORE_WEIGHTS,
  MAX_PICKUP_DISTANCE_KM,
  UTILIZATION_FULL_RATIO,
  RELIABILITY_NEUTRAL_SCORE,
  TRUCK_CLASS_RANK,
  TRUCK_RATE_MULTIPLIER,
  PALLET_CAPACITY,
  DEFAULT_PALLET_CAPACITY,
  APPROVAL_WINDOW_MS,
  DEFAULT_CANDIDATE_LIMIT,
  CANDIDATE_POOL_SIZE,
  REGION_COORDS,
  REGION_COUNTRY,
};
