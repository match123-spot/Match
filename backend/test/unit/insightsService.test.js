const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDatabase } = require('../testDb');

let pool;
let insightsService;

before(async () => {
  pool = await setupTestDatabase();
  insightsService = require('../../src/services/insightsService');
});

after(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query(
    'TRUNCATE organizations, shippers, carriers, carrier_availability, shipments, matches, ratings CASCADE'
  );
});

const IN_2_HOURS = () => new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
const IN_6_HOURS = () => new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
const IN_40_HOURS = () => new Date(Date.now() + 40 * 60 * 60 * 1000).toISOString(); // outside the 24h window
const TODAY = () => new Date().toISOString().slice(0, 10);
const START_OF_WINDOW = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();
const END_OF_WINDOW = () => new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

async function makeShipper() {
  const org = await pool.query(
    `INSERT INTO organizations (type, company_name, status) VALUES ('shipper', 'Acme Shipper', 'approved') RETURNING id`
  );
  const shipper = await pool.query(`INSERT INTO shippers (org_id) VALUES ($1) RETURNING id`, [org.rows[0].id]);
  return shipper.rows[0].id;
}

async function makeCarrierWithAvailability(overrides = {}) {
  const org = await pool.query(
    `INSERT INTO organizations (type, company_name, status) VALUES ('carrier', 'Roadrunner', 'approved') RETURNING id`
  );
  const carrier = await pool.query(`INSERT INTO carriers (org_id, base_location) VALUES ($1, 'Sydney, NSW') RETURNING id`, [
    org.rows[0].id,
  ]);
  const a = {
    truckType: 'semi',
    truckCapacityKg: 25000,
    originRegion: 'Sydney, NSW',
    windowStart: START_OF_WINDOW(),
    windowEnd: END_OF_WINDOW(),
    ...overrides,
  };
  await pool.query(
    `INSERT INTO carrier_availability (carrier_id, available_date, truck_type, truck_capacity_kg, origin_region, window_start, window_end)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [carrier.rows[0].id, TODAY(), a.truckType, a.truckCapacityKg, a.originRegion, a.windowStart, a.windowEnd]
  );
  return carrier.rows[0].id;
}

async function makeShipment(shipperId, overrides = {}) {
  const s = {
    originRegion: 'Sydney, NSW',
    destinationRegion: 'Melbourne, VIC',
    weightKg: 10000,
    truckType: 'semi',
    contractedRate: 1000,
    aiRate: 1000,
    pickupStart: IN_2_HOURS(),
    pickupEnd: IN_6_HOURS(),
    ...overrides,
  };
  const result = await pool.query(
    `INSERT INTO shipments (shipper_id, origin_region, destination_region, weight_kg, truck_type_required,
       pickup_window_start, pickup_window_end, contracted_rate, ai_recommended_rate, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending') RETURNING *`,
    [
      shipperId,
      s.originRegion,
      s.destinationRegion,
      s.weightKg,
      s.truckType,
      s.pickupStart,
      s.pickupEnd,
      s.contractedRate,
      s.aiRate,
    ]
  );
  return result.rows[0];
}

describe('getShipperInsights', () => {
  test('flags a shipment as an opportunity when savings clear the threshold and real supply exists', async () => {
    const shipperId = await makeShipper();
    await makeCarrierWithAvailability();
    await makeShipment(shipperId, { contractedRate: 1000, aiRate: 850 }); // 15% savings, > 8% threshold

    const insights = await insightsService.getShipperInsights(shipperId);
    assert.equal(insights.count, 1);
    assert.equal(insights.opportunities[0].savingsPct, 15);
    assert.equal(insights.opportunities[0].savingsAmount, 150);
  });

  test('does not flag a shipment whose savings are below the threshold', async () => {
    const shipperId = await makeShipper();
    await makeCarrierWithAvailability();
    await makeShipment(shipperId, { contractedRate: 1000, aiRate: 970 }); // 3% savings, below 8% threshold

    const insights = await insightsService.getShipperInsights(shipperId);
    assert.equal(insights.count, 0);
  });

  test('does not flag a shipment with good savings but no real carrier supply', async () => {
    const shipperId = await makeShipper();
    // No carrier availability created at all.
    await makeShipment(shipperId, { contractedRate: 1000, aiRate: 800 }); // 20% savings, but nobody can take it

    const insights = await insightsService.getShipperInsights(shipperId);
    assert.equal(insights.count, 0, 'a savings estimate nobody can fulfil is not a real opportunity');
  });

  test('ignores shipments outside the day-ahead window', async () => {
    const shipperId = await makeShipper();
    await makeCarrierWithAvailability();
    await makeShipment(shipperId, { contractedRate: 1000, aiRate: 800, pickupStart: IN_40_HOURS(), pickupEnd: IN_40_HOURS() });

    const insights = await insightsService.getShipperInsights(shipperId);
    assert.equal(insights.count, 0);
  });

  test('ignores a shipment with no contracted_rate to compare against', async () => {
    const shipperId = await makeShipper();
    await makeCarrierWithAvailability();
    const shipment = await makeShipment(shipperId, { contractedRate: 1000, aiRate: 800 });
    await pool.query('UPDATE shipments SET contracted_rate = NULL WHERE id = $1', [shipment.id]);

    const insights = await insightsService.getShipperInsights(shipperId);
    assert.equal(insights.count, 0);
  });

  test('sums total potential savings across multiple opportunities', async () => {
    const shipperId = await makeShipper();
    await makeCarrierWithAvailability();
    await makeShipment(shipperId, { contractedRate: 1000, aiRate: 850 }); // saves 150
    await makeShipment(shipperId, { contractedRate: 2000, aiRate: 1700 }); // saves 300

    const insights = await insightsService.getShipperInsights(shipperId);
    assert.equal(insights.count, 2);
    assert.equal(insights.totalPotentialSavings, 450);
  });
});

describe('getCarrierInsights', () => {
  test('flags a nearby, well-timed, well-fitting shipment as an opportunity', async () => {
    const carrierId = await makeCarrierWithAvailability({ originRegion: 'Sydney, NSW' });
    const shipperId = await makeShipper();
    await makeShipment(shipperId, { originRegion: 'Sydney, NSW', weightKg: 20000 }); // 80% utilization, close, on time

    const insights = await insightsService.getCarrierInsights(carrierId);
    assert.equal(insights.count, 1);
    assert.equal(insights.opportunities[0].originRegion, 'Sydney, NSW');
    assert.ok(insights.areas.includes('Sydney, NSW'));
  });

  test('does not flag a shipment too far from any of my trucks', async () => {
    const carrierId = await makeCarrierWithAvailability({ originRegion: 'Perth, WA' });
    const shipperId = await makeShipper();
    await makeShipment(shipperId, { originRegion: 'Sydney, NSW' });

    const insights = await insightsService.getCarrierInsights(carrierId);
    assert.equal(insights.count, 0);
  });

  test('does not flag a shipment that scores below the attractiveness threshold', async () => {
    // Distance/reliability/acceptance alone can reach ~54/100 for an
    // eligible same-region carrier with no rating history yet (30 + 14 + 10),
    // so this needs both timing AND utilization poor — not just one of them
    // — to land the total under the 70 threshold while staying eligible
    // (timing > 0) rather than excluded outright by the overlap cutoff.
    const shipment_pickup_start = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const shipment_pickup_end = new Date(Date.now() + 6 * 60 * 60 * 1000); // 4h window
    const availability_start = new Date(Date.now() + 5 * 60 * 60 * 1000);
    const availability_end = new Date(Date.now() + 7 * 60 * 60 * 1000); // overlaps only the last 1h of 4h

    const carrierId = await makeCarrierWithAvailability({
      originRegion: 'Sydney, NSW',
      truckCapacityKg: 25000,
      windowStart: availability_start.toISOString(),
      windowEnd: availability_end.toISOString(),
    });
    const shipperId = await makeShipper();
    await makeShipment(shipperId, {
      originRegion: 'Sydney, NSW',
      weightKg: 2000, // ~9% utilization
      pickupStart: shipment_pickup_start.toISOString(),
      pickupEnd: shipment_pickup_end.toISOString(),
    });

    const insights = await insightsService.getCarrierInsights(carrierId);
    assert.equal(insights.count, 0);
  });

  test('a carrier with no open trucks at all gets an empty, cheap response', async () => {
    const org = await pool.query(
      `INSERT INTO organizations (type, company_name, status) VALUES ('carrier', 'Idle Co', 'approved') RETURNING id`
    );
    const carrier = await pool.query(`INSERT INTO carriers (org_id, base_location) VALUES ($1, 'Sydney, NSW') RETURNING id`, [
      org.rows[0].id,
    ]);

    const insights = await insightsService.getCarrierInsights(carrier.rows[0].id);
    assert.equal(insights.count, 0);
    assert.deepEqual(insights.areas, []);
  });

  test("does not surface another carrier's shipments as opportunities for me if already booked", async () => {
    const carrierId = await makeCarrierWithAvailability({ originRegion: 'Sydney, NSW' });
    const shipperId = await makeShipper();
    const shipment = await makeShipment(shipperId, { originRegion: 'Sydney, NSW', weightKg: 20000 });
    await pool.query(`UPDATE shipments SET status = 'booked' WHERE id = $1`, [shipment.id]);

    const insights = await insightsService.getCarrierInsights(carrierId);
    assert.equal(insights.count, 0, 'an already-booked shipment is not an opportunity for anyone');
  });
});
