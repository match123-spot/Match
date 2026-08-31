// Mocked OTM (Oracle Transportation Management) shipment pulls.
// Simulates what a real OTM integration would hand back, so the rest of the
// app can be built and tested before a real OTM connection exists.
const { lookupCoords, haversineKm } = require('./geo');

const REGIONS = [
  'Sydney, NSW',
  'Melbourne, VIC',
  'Brisbane, QLD',
  'Perth, WA',
  'Adelaide, SA',
  'Canberra, ACT',
  'Hobart, TAS',
  'Darwin, NT',
  'Auckland, NZ',
  'Wellington, NZ',
  'Christchurch, NZ',
];
const TRUCK_TYPES = ['semi', 'B-double', 'rigid', 'refrigerated'];

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Rough AU/NZ linehaul pricing: base callout + per-km + per-kg, plus +/-10% variance.
function estimateRate(originRegion, destinationRegion, weightKg) {
  const a = lookupCoords(originRegion);
  const b = lookupCoords(destinationRegion);
  const km = a && b ? haversineKm(a, b) : 500;
  const base = 150 + km * 1.85 + weightKg * 0.04;
  const variance = 0.9 + Math.random() * 0.2;
  return Math.round(base * variance * 100) / 100;
}

function generateMockShipments(count) {
  const shipments = [];
  for (let i = 0; i < count; i++) {
    const origin = randomFrom(REGIONS);
    const destination = randomFrom(REGIONS.filter((r) => r !== origin));
    const pickupStart = new Date(Date.now() + (1 + Math.floor(Math.random() * 6)) * 60 * 60 * 1000);
    const pickupEnd = new Date(pickupStart.getTime() + (2 + Math.floor(Math.random() * 6)) * 60 * 60 * 1000);

    const weightKg = 2000 + Math.floor(Math.random() * 20000);

    shipments.push({
      otmRef: `MOCK-${Date.now()}-${i}`,
      originRegion: origin,
      destinationRegion: destination,
      weightKg,
      truckType: randomFrom(TRUCK_TYPES),
      pickupStart: pickupStart.toISOString(),
      pickupEnd: pickupEnd.toISOString(),
      quotedRate: estimateRate(origin, destination, weightKg),
    });
  }
  return shipments;
}

module.exports = { generateMockShipments };
