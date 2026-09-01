// Small AU/NZ freight-hub coordinate lookup for MVP distance scoring.
// No geocoding API in scope yet — mock shipments and the carrier availability
// form both use these region names, so this covers the demo cleanly.
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

// Country per region — used to keep mock shipments road-only. AU<->NZ needs a
// sea/air leg (Tasman Sea), so those pairs are excluded from mock generation.
// Interisland/Bass Strait RORO ferry lanes (Auckland/Wellington<->Christchurch,
// mainland AU<->Hobart) count as road freight by industry convention — trucks
// drive on and off, no different mode or customs process — so those stay in.
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

function lookupCoords(regionName) {
  if (!regionName) return null;
  return REGION_COORDS[regionName.trim().toLowerCase()] ?? null;
}

function lookupCountry(regionName) {
  if (!regionName) return null;
  return REGION_COUNTRY[regionName.trim().toLowerCase()] ?? null;
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

module.exports = { REGION_COORDS, lookupCoords, lookupCountry, haversineKm };
