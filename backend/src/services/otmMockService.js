// Mocked OTM (Oracle Transportation Management) shipment pulls.
// Simulates what a real OTM integration would hand back, so the rest of the
// app can be built and tested before a real OTM connection exists.
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

function generateMockShipments(count) {
  const shipments = [];
  for (let i = 0; i < count; i++) {
    const origin = randomFrom(REGIONS);
    const destination = randomFrom(REGIONS.filter((r) => r !== origin));
    const pickupStart = new Date(Date.now() + (1 + Math.floor(Math.random() * 6)) * 60 * 60 * 1000);
    const pickupEnd = new Date(pickupStart.getTime() + (2 + Math.floor(Math.random() * 6)) * 60 * 60 * 1000);

    shipments.push({
      otmRef: `MOCK-${Date.now()}-${i}`,
      originRegion: origin,
      destinationRegion: destination,
      weightKg: 2000 + Math.floor(Math.random() * 20000),
      truckType: randomFrom(TRUCK_TYPES),
      pickupStart: pickupStart.toISOString(),
      pickupEnd: pickupEnd.toISOString(),
    });
  }
  return shipments;
}

module.exports = { generateMockShipments };
