const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDatabase } = require('../testDb');

let pool;
let workflow;

before(async () => {
  pool = await setupTestDatabase();
  workflow = require('../../src/services/matchWorkflowService');
});

after(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query(
    'TRUNCATE organizations, users, shippers, carriers, carrier_availability, shipments, matches, ratings CASCADE'
  );
});

async function makeShipper({ autoApproveMaxCost = null } = {}) {
  const org = await pool.query(
    `INSERT INTO organizations (type, company_name, status) VALUES ('shipper', 'Acme Shipper', 'approved') RETURNING id`
  );
  const shipper = await pool.query(
    `INSERT INTO shippers (org_id, auto_approve_max_cost) VALUES ($1, $2) RETURNING id`,
    [org.rows[0].id, autoApproveMaxCost]
  );
  await pool.query(
    `INSERT INTO users (email, password_hash, role, full_name, org_id) VALUES ($1, 'x', 'shipper', 'Planner', $2)`,
    [`planner-${org.rows[0].id}@test.local`, org.rows[0].id]
  );
  return { orgId: org.rows[0].id, shipperId: shipper.rows[0].id };
}

async function makeCarrierWithAvailability({ autoApproveMinIncome = null, truckType = 'semi' } = {}) {
  const org = await pool.query(
    `INSERT INTO organizations (type, company_name, status) VALUES ('carrier', 'Roadrunner', 'approved') RETURNING id`
  );
  const carrier = await pool.query(
    `INSERT INTO carriers (org_id, base_location, auto_approve_min_income) VALUES ($1, 'Sydney, NSW', $2) RETURNING id`,
    [org.rows[0].id, autoApproveMinIncome]
  );
  await pool.query(
    `INSERT INTO users (email, password_hash, role, full_name, org_id) VALUES ($1, 'x', 'carrier', 'Dispatcher', $2)`,
    [`dispatcher-${org.rows[0].id}@test.local`, org.rows[0].id]
  );
  const availability = await pool.query(
    `INSERT INTO carrier_availability (carrier_id, available_date, truck_type, truck_capacity_kg, origin_region, window_start, window_end)
     VALUES ($1, CURRENT_DATE, $2, 25000, 'Sydney, NSW', now() - interval '1 hour', now() + interval '2 days') RETURNING id`,
    [carrier.rows[0].id, truckType]
  );
  return { orgId: org.rows[0].id, carrierId: carrier.rows[0].id, availabilityId: availability.rows[0].id };
}

async function makeShipment(shipperId, overrides = {}) {
  const defaults = {
    originRegion: 'Sydney, NSW',
    destinationRegion: 'Melbourne, VIC',
    weightKg: 10000,
    truckType: 'semi',
    aiRecommendedRate: 1000,
  };
  const s = { ...defaults, ...overrides };
  const result = await pool.query(
    `INSERT INTO shipments (shipper_id, origin_region, destination_region, weight_kg, truck_type_required,
       pickup_window_start, pickup_window_end, ai_recommended_rate, status)
     VALUES ($1,$2,$3,$4,$5, now() + interval '2 hours', now() + interval '6 hours', $6,'pending') RETURNING *`,
    [shipperId, s.originRegion, s.destinationRegion, s.weightKg, s.truckType, s.aiRecommendedRate]
  );
  return result.rows[0];
}

describe('createMatchForShipment', () => {
  test('opens a match with a 20-minute approval window against the best candidate', async () => {
    const { shipperId } = await makeShipper();
    const { carrierId } = await makeCarrierWithAvailability();
    const shipment = await makeShipment(shipperId);

    const match = await workflow.createMatchForShipment(shipment);

    assert.ok(match);
    assert.equal(match.carrier_id, carrierId);
    assert.equal(match.status, 'pending');
    const minsUntilDeadline = (new Date(match.approval_deadline) - Date.now()) / 60000;
    assert.ok(minsUntilDeadline > 19 && minsUntilDeadline <= 20, `expected ~20min, got ${minsUntilDeadline}`);
  });

  test('with only one eligible candidate, skips the Claude selection call and stores no AI reasoning', async () => {
    const { shipperId } = await makeShipper();
    const { carrierId } = await makeCarrierWithAvailability();
    const shipment = await makeShipment(shipperId);

    const match = await workflow.createMatchForShipment(shipment);

    assert.equal(match.carrier_id, carrierId);
    assert.equal(match.ai_selection_reasoning, null);
    assert.equal(match.ai_selection_rank, null);
  });

  test('returns null and leaves the shipment pending when no carrier is eligible', async () => {
    const { shipperId } = await makeShipper();
    const shipment = await makeShipment(shipperId); // no carrier availability created at all

    const match = await workflow.createMatchForShipment(shipment);
    assert.equal(match, null);

    const reloaded = await pool.query('SELECT status FROM shipments WHERE id = $1', [shipment.id]);
    assert.equal(reloaded.rows[0].status, 'pending');
  });

  test('auto-approves both sides and books immediately when thresholds clear', async () => {
    const { shipperId } = await makeShipper({ autoApproveMaxCost: 2000 });
    const { availabilityId } = await makeCarrierWithAvailability({ autoApproveMinIncome: 500 });
    const shipment = await makeShipment(shipperId, { aiRecommendedRate: 1000 }); // between both thresholds

    const match = await workflow.createMatchForShipment(shipment);

    assert.equal(match.status, 'booked');
    assert.ok(match.shipper_approved_at);
    assert.ok(match.carrier_approved_at);

    const availabilityRow = await pool.query('SELECT is_booked FROM carrier_availability WHERE id = $1', [availabilityId]);
    assert.equal(availabilityRow.rows[0].is_booked, true, 'booking should mark the truck as no longer available');

    const shipmentRow = await pool.query('SELECT status FROM shipments WHERE id = $1', [shipment.id]);
    assert.equal(shipmentRow.rows[0].status, 'booked');
  });

  test('auto-approves only the side whose threshold clears, leaving the match half-open', async () => {
    const { shipperId } = await makeShipper({ autoApproveMaxCost: 500 }); // rate 1000 exceeds this
    await makeCarrierWithAvailability({ autoApproveMinIncome: 500 }); // rate 1000 clears this
    const shipment = await makeShipment(shipperId, { aiRecommendedRate: 1000 });

    const match = await workflow.createMatchForShipment(shipment);

    assert.equal(match.status, 'carrier_approved');
    assert.equal(match.shipper_approved_at, null);
    assert.ok(match.carrier_approved_at);
  });
});

describe('approveMatch / dual approval', () => {
  test('first approval moves to the single-sided status; second triggers booking', async () => {
    const { shipperId, orgId: shipperOrgId } = await makeShipper();
    const { orgId: carrierOrgId } = await makeCarrierWithAvailability();
    const shipment = await makeShipment(shipperId);
    const match = await workflow.createMatchForShipment(shipment);

    const afterShipper = await workflow.approveMatch(match.id, 'shipper', null);
    assert.equal(afterShipper.status, 'shipper_approved');

    const afterCarrier = await workflow.approveMatch(match.id, 'carrier', null);
    assert.equal(afterCarrier.status, 'booked');

    // sanity: getMatchForUser resolves each org to the right role
    const shipperView = await workflow.getMatchForUser(match.id, shipperOrgId);
    assert.equal(shipperView.role, 'shipper');
    const carrierView = await workflow.getMatchForUser(match.id, carrierOrgId);
    assert.equal(carrierView.role, 'carrier');
  });

  test('records which specific user approved on behalf of their org', async () => {
    const { shipperId, orgId } = await makeShipper();
    await makeCarrierWithAvailability();
    const shipment = await makeShipment(shipperId);
    const match = await workflow.createMatchForShipment(shipment);

    const plannerUser = await pool.query('SELECT id FROM users WHERE org_id = $1', [orgId]);
    const approvingUserId = plannerUser.rows[0].id;

    const approved = await workflow.approveMatch(match.id, 'shipper', approvingUserId);
    assert.equal(approved.shipper_approved_by, approvingUserId);
  });

  test('approving after the deadline has passed is a no-op', async () => {
    const { shipperId } = await makeShipper();
    await makeCarrierWithAvailability();
    const shipment = await makeShipment(shipperId);
    const match = await workflow.createMatchForShipment(shipment);

    await pool.query(`UPDATE matches SET approval_deadline = now() - interval '1 minute' WHERE id = $1`, [match.id]);

    const result = await workflow.approveMatch(match.id, 'shipper', null);
    assert.equal(result, null);
  });
});

describe('rejectMatch', () => {
  test('rejecting triggers an automatic rematch against the next candidate', async () => {
    const { shipperId } = await makeShipper();
    // Two carriers so a rematch has somewhere to go.
    await makeCarrierWithAvailability();
    await makeCarrierWithAvailability();
    const shipment = await makeShipment(shipperId);
    const match = await workflow.createMatchForShipment(shipment);

    const { match: rejected, rematch } = await workflow.rejectMatch(match.id, 'carrier');

    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.rejected_by, 'carrier');
    assert.ok(rematch, 'a second carrier should still be available for rematch');
    assert.equal(rematch.is_rematch_of, match.id);
    assert.notEqual(rematch.carrier_availability_id, match.carrier_availability_id);
  });
});

describe('expireStaleMatches', () => {
  test('expires an overdue match and rematches it', async () => {
    const { shipperId } = await makeShipper();
    await makeCarrierWithAvailability();
    await makeCarrierWithAvailability();
    const shipment = await makeShipment(shipperId);
    const match = await workflow.createMatchForShipment(shipment);

    await pool.query(`UPDATE matches SET approval_deadline = now() - interval '1 second' WHERE id = $1`, [match.id]);

    const expired = await workflow.expireStaleMatches();
    assert.equal(expired.length, 1);
    assert.equal(expired[0].id, match.id);
    assert.equal(expired[0].status, 'expired');

    const rematches = await pool.query('SELECT * FROM matches WHERE is_rematch_of = $1', [match.id]);
    assert.equal(rematches.rows.length, 1);
  });

  test('leaves matches within their deadline untouched', async () => {
    const { shipperId } = await makeShipper();
    await makeCarrierWithAvailability();
    const shipment = await makeShipment(shipperId);
    await workflow.createMatchForShipment(shipment);

    const expired = await workflow.expireStaleMatches();
    assert.equal(expired.length, 0);
  });
});
