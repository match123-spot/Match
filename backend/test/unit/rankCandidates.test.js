const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDatabase } = require('../testDb');

let pool;
let rankCandidates;

before(async () => {
  pool = await setupTestDatabase();
  // Required after setupTestDatabase mutates DATABASE_URL, so config/db picks up the test DB.
  ({ rankCandidates } = require('../../src/services/matchingService'));
});

after(async () => {
  await pool.end();
});

async function makeApprovedOrgWithCarrier({ companyName, baseLocation }) {
  const org = await pool.query(
    `INSERT INTO organizations (type, company_name, status) VALUES ('carrier', $1, 'approved') RETURNING id`,
    [companyName]
  );
  const carrier = await pool.query(
    `INSERT INTO carriers (org_id, base_location) VALUES ($1, $2) RETURNING id`,
    [org.rows[0].id, baseLocation]
  );
  return { orgId: org.rows[0].id, carrierId: carrier.rows[0].id };
}

async function addAvailability(carrierId, overrides = {}) {
  const defaults = {
    availableDate: '2026-09-01',
    truckType: 'semi',
    truckCapacityKg: 25000,
    originRegion: 'Sydney, NSW',
    windowStart: '2026-09-01T00:00:00Z',
    windowEnd: '2026-09-03T00:00:00Z',
  };
  const a = { ...defaults, ...overrides };
  await pool.query(
    `INSERT INTO carrier_availability (carrier_id, available_date, truck_type, truck_capacity_kg, origin_region, window_start, window_end)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [carrierId, a.availableDate, a.truckType, a.truckCapacityKg, a.originRegion, a.windowStart, a.windowEnd]
  );
}

beforeEach(async () => {
  await pool.query('TRUNCATE organizations, carriers, carrier_availability, ratings CASCADE');
});

describe('rankCandidates', () => {
  test('excludes a carrier whose org is pending, not approved', async () => {
    const org = await pool.query(
      `INSERT INTO organizations (type, company_name, status) VALUES ('carrier', 'Pending Co', 'pending') RETURNING id`
    );
    const carrier = await pool.query(`INSERT INTO carriers (org_id, base_location) VALUES ($1, 'Sydney, NSW') RETURNING id`, [
      org.rows[0].id,
    ]);
    await addAvailability(carrier.rows[0].id);

    const shipment = {
      origin_region: 'Sydney, NSW',
      truck_type_required: 'semi',
      weight_kg: 10000,
      pickup_window_start: '2026-09-01T10:00:00Z',
      pickup_window_end: '2026-09-01T14:00:00Z',
    };
    const candidates = await rankCandidates(shipment);
    assert.equal(candidates.length, 0, 'a pending org must never be matchable');
  });

  test('excludes a carrier beyond the geographic cutoff even with a perfect score otherwise', async () => {
    const { carrierId } = await makeApprovedOrgWithCarrier({ companyName: 'Far Away Freight', baseLocation: 'Perth, WA' });
    await addAvailability(carrierId, { originRegion: 'Perth, WA' });

    const shipment = {
      origin_region: 'Sydney, NSW',
      truck_type_required: 'semi',
      weight_kg: 10000,
      pickup_window_start: '2026-09-01T10:00:00Z',
      pickup_window_end: '2026-09-01T14:00:00Z',
    };
    const candidates = await rankCandidates(shipment);
    assert.equal(candidates.length, 0, 'Perth is ~3300km from Sydney, well past the 150km cutoff');
  });

  test('right-sizing: a smaller truck than requested is included and flagged, and outranks an under-filled exact match', async () => {
    const { carrierId } = await makeApprovedOrgWithCarrier({ companyName: 'Roadrunner', baseLocation: 'Sydney, NSW' });
    // A 15t rigid — smaller than the requested semi, but exactly fits a 15t load.
    await addAvailability(carrierId, { truckType: 'rigid', truckCapacityKg: 15000, originRegion: 'Sydney, NSW' });
    // A 25t semi — the literally-requested type, but only 60% utilized by the same load.
    await addAvailability(carrierId, { truckType: 'semi', truckCapacityKg: 25000, originRegion: 'Sydney, NSW' });

    const shipment = {
      origin_region: 'Sydney, NSW',
      truck_type_required: 'semi',
      weight_kg: 15000,
      pallet_count: 15,
      ai_recommended_rate: 1800,
      pickup_window_start: '2026-09-01T10:00:00Z',
      pickup_window_end: '2026-09-01T14:00:00Z',
    };
    const candidates = await rankCandidates(shipment);
    assert.equal(candidates.length, 2);

    const [top] = candidates;
    assert.equal(top.availability.truckType, 'rigid', 'the right-sized rigid should rank first');
    assert.equal(top.truckType.match, 'downsize');
    assert.ok(top.truckType.estimatedRate < 1800, 'a smaller truck class should estimate a lower rate');
    assert.ok(top.scores.total > candidates[1].scores.total);
  });

  test('a refrigerated requirement is never substituted with a non-refrigerated truck, even a much bigger one', async () => {
    const { carrierId } = await makeApprovedOrgWithCarrier({ companyName: 'Big Rig Co', baseLocation: 'Sydney, NSW' });
    await addAvailability(carrierId, { truckType: 'B-double', truckCapacityKg: 34000, originRegion: 'Sydney, NSW' });

    const shipment = {
      origin_region: 'Sydney, NSW',
      truck_type_required: 'refrigerated',
      weight_kg: 10000,
      pickup_window_start: '2026-09-01T10:00:00Z',
      pickup_window_end: '2026-09-01T14:00:00Z',
    };
    const candidates = await rankCandidates(shipment);
    assert.equal(candidates.length, 0, 'temperature control is not substitutable by raw capacity');
  });

  test('excludes a truck whose availability window does not overlap the pickup window at all', async () => {
    const { carrierId } = await makeApprovedOrgWithCarrier({ companyName: 'Wrong Day Co', baseLocation: 'Sydney, NSW' });
    await addAvailability(carrierId, {
      windowStart: '2026-09-05T00:00:00Z',
      windowEnd: '2026-09-06T00:00:00Z',
    });

    const shipment = {
      origin_region: 'Sydney, NSW',
      truck_type_required: 'semi',
      weight_kg: 10000,
      pickup_window_start: '2026-09-01T10:00:00Z',
      pickup_window_end: '2026-09-01T14:00:00Z',
    };
    const candidates = await rankCandidates(shipment);
    assert.equal(candidates.length, 0);
  });

  test('excludes a truck whose capacity is below the shipment weight, even by a little', async () => {
    const { carrierId } = await makeApprovedOrgWithCarrier({ companyName: 'Small Truck Co', baseLocation: 'Sydney, NSW' });
    await addAvailability(carrierId, { truckCapacityKg: 9999 });

    const shipment = {
      origin_region: 'Sydney, NSW',
      truck_type_required: 'semi',
      weight_kg: 10000,
      pickup_window_start: '2026-09-01T10:00:00Z',
      pickup_window_end: '2026-09-01T14:00:00Z',
    };
    const candidates = await rankCandidates(shipment);
    assert.equal(candidates.length, 0);
  });
});
