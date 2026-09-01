// Mocked OTM (Oracle Transportation Management) shipment pulls.
// Simulates what a real OTM integration would hand back, so the rest of the
// app can be built and tested before a real OTM connection exists.
//
// Road only for now: origin and destination are always drawn from the same
// country (AU or NZ) — a Tasman Sea crossing needs a different mode/customs
// process entirely, out of scope until air/sea freight is added.
const { lookupCoords, lookupCountry, haversineKm } = require('./geo');

const AU_REGIONS = ['Sydney, NSW', 'Melbourne, VIC', 'Brisbane, QLD', 'Perth, WA', 'Adelaide, SA', 'Canberra, ACT', 'Hobart, TAS', 'Darwin, NT'];
const NZ_REGIONS = ['Auckland, NZ', 'Wellington, NZ', 'Christchurch, NZ'];
const TRUCK_TYPES = ['semi', 'B-double', 'rigid', 'refrigerated'];

const CUSTOMERS = [
  'Southern Grocers Co-op',
  'Bluegum Building Supplies',
  'Harborview Retail Group',
  'Outback Mining Services',
  'Coastal Produce Exporters',
  'Alpine Beverage Co',
  'Redgum Hardware',
  'Kiwi Fresh Distributors',
];

// Fictional incumbent LSP names — deliberately not real companies, since this
// field stands in for "whoever the shipper currently uses" in mocked OTM data.
const CURRENT_LSPS = [
  'Southern Cross Transport',
  'Outback Freight Co',
  'Tasman Line Logistics',
  'Coastal Carriers',
  'Redback Road Freight',
  'Long White Cloud Haulage',
];

const AVG_ROAD_SPEED_KMH = 75; // incl. rest breaks, not point-to-point highway speed
const UNLOADING_BUFFER_HOURS = 1.5;
const AVG_PALLET_WEIGHT_KG = 700;

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

// Rough AU/NZ linehaul pricing formula — used as the anchor Claude's pricing
// call is grounded against, not shown to users directly.
function estimateMarketRate(originRegion, destinationRegion, weightKg) {
  const a = lookupCoords(originRegion);
  const b = lookupCoords(destinationRegion);
  const km = a && b ? haversineKm(a, b) : 500;
  const base = 150 + km * 1.85 + weightKg * 0.04;
  const variance = 0.9 + Math.random() * 0.2;
  return Math.round(base * variance * 100) / 100;
}

// The shipper's existing contracted rate with their current LSP — simulates
// typical incumbent-carrier pricing, which the marketplace aims to beat.
function estimateContractedRate(marketRate) {
  const markup = 1.08 + Math.random() * 0.22; // 8-30% above the efficient-market anchor
  return Math.round(marketRate * markup * 100) / 100;
}

function generateMockShipments(count) {
  const shipments = [];
  for (let i = 0; i < count; i++) {
    const country = randomFrom(['AU', 'NZ']);
    const pool = country === 'AU' ? AU_REGIONS : NZ_REGIONS;
    const origin = randomFrom(pool);
    const destination = randomFrom(pool.filter((r) => r !== origin));

    const leadTimeHours = randomBetween(4, 48);
    const pickupStart = new Date(Date.now() + leadTimeHours * 60 * 60 * 1000);
    const pickupEnd = new Date(pickupStart.getTime() + (2 + Math.floor(Math.random() * 6)) * 60 * 60 * 1000);

    const a = lookupCoords(origin);
    const b = lookupCoords(destination);
    const distanceKm = a && b ? Math.round(haversineKm(a, b) * 10) / 10 : null;

    const transitHours = (distanceKm ?? 500) / AVG_ROAD_SPEED_KMH + UNLOADING_BUFFER_HOURS;
    const deliveryStart = new Date(pickupEnd.getTime() + transitHours * 60 * 60 * 1000);
    const deliveryEnd = new Date(deliveryStart.getTime() + (2 + Math.floor(Math.random() * 4)) * 60 * 60 * 1000);

    const weightKg = 2000 + Math.floor(Math.random() * 20000);
    const palletCount = Math.max(1, Math.round(weightKg / AVG_PALLET_WEIGHT_KG));

    const marketRate = estimateMarketRate(origin, destination, weightKg);

    shipments.push({
      otmRef: `MOCK-${Date.now()}-${i}`,
      originRegion: origin,
      destinationRegion: destination,
      distanceKm,
      weightKg,
      palletCount,
      truckType: randomFrom(TRUCK_TYPES),
      pickupStart: pickupStart.toISOString(),
      pickupEnd: pickupEnd.toISOString(),
      expectedDeliveryStart: deliveryStart.toISOString(),
      expectedDeliveryEnd: deliveryEnd.toISOString(),
      leadTimeHours: Math.round(leadTimeHours * 10) / 10,
      customerName: randomFrom(CUSTOMERS),
      currentLsp: randomFrom(CURRENT_LSPS),
      contractedRate: estimateContractedRate(marketRate),
      marketRateAnchor: marketRate,
    });
  }
  return shipments;
}

module.exports = { generateMockShipments };
