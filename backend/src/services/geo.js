const { REGION_COORDS, REGION_COUNTRY } = require('../config/matching.config');

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

module.exports = { lookupCoords, lookupCountry, haversineKm };
