const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDatabase } = require('../testDb');

let pool;
let request;

before(async () => {
  pool = await setupTestDatabase();
  const supertest = require('supertest');
  const app = require('../../src/app');
  request = supertest(app);
});

after(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query(
    'TRUNCATE organizations, users, shippers, carriers, carrier_availability, shipments, matches, ratings CASCADE'
  );
});

async function registerShipper(email, overrides = {}) {
  const res = await request.post('/auth/register').send({
    email,
    password: 'testpass123',
    fullName: 'Jane Shipper',
    role: 'shipper',
    profile: { companyName: overrides.companyName ?? 'Acme Co' },
  });
  return res;
}

async function registerCarrier(email, overrides = {}) {
  const res = await request.post('/auth/register').send({
    email,
    password: 'testpass123',
    fullName: 'Carl Carrier',
    role: 'carrier',
    profile: {
      companyName: overrides.companyName ?? 'Roadrunner',
      baseLocation: 'Sydney, NSW',
      fleetSize: 5,
    },
  });
  return res;
}

describe('GET /config', () => {
  test('exposes matching-engine constants publicly, no auth required', async () => {
    const res = await request.get('/config');
    assert.equal(res.status, 200);
    assert.equal(res.body.maxPickupDistanceKm, 150);
    assert.equal(res.body.approvalWindowMinutes, 20);
    const sum = Object.values(res.body.scoreWeights).reduce((a, b) => a + b, 0);
    assert.equal(sum, 100, 'score weights should sum to 100%');
  });
});

describe('POST /auth/register', () => {
  test('creates a user and a pending org, returns a usable token', async () => {
    const res = await registerShipper('shipper1@test.local');
    assert.equal(res.status, 201);
    assert.equal(res.body.user.role, 'shipper');
    assert.ok(res.body.token);

    const org = await pool.query('SELECT status, company_name FROM organizations WHERE id = $1', [res.body.user.org_id]);
    assert.equal(org.rows[0].status, 'pending');
    assert.equal(org.rows[0].company_name, 'Acme Co');
  });

  test('a second signup with the same company name joins the existing org', async () => {
    const first = await registerShipper('shipper1@test.local', { companyName: 'Shared Co' });
    const second = await registerShipper('shipper2@test.local', { companyName: 'Shared Co' });

    assert.equal(first.body.user.org_id, second.body.user.org_id);
  });

  test('rejects a password under 8 characters', async () => {
    const res = await request.post('/auth/register').send({
      email: 'short@test.local',
      password: 'short',
      fullName: 'X',
      role: 'shipper',
    });
    assert.equal(res.status, 400);
  });

  test('rejects a duplicate email', async () => {
    await registerShipper('dupe@test.local');
    const res = await registerShipper('dupe@test.local');
    assert.equal(res.status, 409);
  });
});

describe('POST /auth/login', () => {
  test('rejects a wrong password without leaking whether the email exists', async () => {
    await registerShipper('shipper1@test.local');
    const res = await request.post('/auth/login').send({ email: 'shipper1@test.local', password: 'wrongpass' });
    assert.equal(res.status, 401);
    assert.match(res.body.error, /invalid email or password/i);
  });

  test('succeeds with correct credentials and includes org status', async () => {
    await registerShipper('shipper1@test.local');
    const res = await request.post('/auth/login').send({ email: 'shipper1@test.local', password: 'testpass123' });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.org_status, 'pending');
  });
});

describe('authorization', () => {
  test('rejects requests with no token', async () => {
    const res = await request.get('/availability/me');
    assert.equal(res.status, 401);
  });

  test('rejects a shipper hitting a carrier-only route', async () => {
    const shipper = await registerShipper('shipper1@test.local');
    const res = await request.get('/availability/me').set('Authorization', `Bearer ${shipper.body.token}`);
    assert.equal(res.status, 403);
  });

  test('rejects a garbage token', async () => {
    const res = await request.get('/availability/me').set('Authorization', 'Bearer not-a-real-token');
    assert.equal(res.status, 401);
  });
});

describe('carrier availability isolation between orgs', () => {
  test("one carrier cannot see or delete another carrier's availability", async () => {
    const carrierA = await registerCarrier('carrierA@test.local', { companyName: 'Carrier A' });
    const carrierB = await registerCarrier('carrierB@test.local', { companyName: 'Carrier B' });

    const created = await request
      .post('/availability')
      .set('Authorization', `Bearer ${carrierA.body.token}`)
      .send({
        availableDate: new Date().toISOString().slice(0, 10),
        truckType: 'semi',
        truckCapacityKg: 25000,
        originRegion: 'Sydney, NSW',
        windowStart: new Date().toISOString(),
        windowEnd: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      });
    assert.equal(created.status, 201);

    const bListing = await request.get('/availability/me').set('Authorization', `Bearer ${carrierB.body.token}`);
    assert.equal(bListing.body.availability.length, 0, "B should not see A's availability");

    const deleteAttempt = await request
      .delete(`/availability/${created.body.availability.id}`)
      .set('Authorization', `Bearer ${carrierB.body.token}`);
    assert.equal(deleteAttempt.status, 404, "B should not be able to delete A's entry");
  });
});

describe('match request blocked for a pending org', () => {
  test('a pending shipper org cannot request a match even for its own shipment', async () => {
    const shipper = await registerShipper('shipper1@test.local');
    const shipmentResult = await pool.query(
      `SELECT id FROM shippers WHERE org_id = $1`,
      [shipper.body.user.org_id]
    );
    const shipperRowId = shipmentResult.rows[0].id;
    const shipment = await pool.query(
      `INSERT INTO shipments (shipper_id, origin_region, destination_region, weight_kg, truck_type_required,
         pickup_window_start, pickup_window_end, status)
       VALUES ($1, 'Sydney, NSW', 'Melbourne, VIC', 10000, 'semi', now(), now() + interval '4 hours', 'pending')
       RETURNING id`,
      [shipperRowId]
    );

    const res = await request
      .post('/matches')
      .set('Authorization', `Bearer ${shipper.body.token}`)
      .send({ shipmentId: shipment.rows[0].id });

    assert.equal(res.status, 403);
    assert.match(res.body.error, /pending admin approval/i);
  });
});

describe('settings (auto-approval thresholds)', () => {
  test('a shipper can set and read back their threshold', async () => {
    const shipper = await registerShipper('shipper1@test.local');
    const patch = await request
      .patch('/settings/shipper')
      .set('Authorization', `Bearer ${shipper.body.token}`)
      .send({ autoApproveMaxCost: 2500 });
    assert.equal(patch.status, 200);

    const read = await request.get('/settings/me').set('Authorization', `Bearer ${shipper.body.token}`);
    assert.equal(Number(read.body.autoApproveMaxCost), 2500);
  });

  test('rejects a negative threshold', async () => {
    const shipper = await registerShipper('shipper1@test.local');
    const res = await request
      .patch('/settings/shipper')
      .set('Authorization', `Bearer ${shipper.body.token}`)
      .send({ autoApproveMaxCost: -5 });
    assert.equal(res.status, 400);
  });
});

describe('GET /insights/me', () => {
  test('a shipper with no shipments gets an empty briefing, not an error', async () => {
    const shipper = await registerShipper('shipper1@test.local');
    const res = await request.get('/insights/me').set('Authorization', `Bearer ${shipper.body.token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.role, 'shipper');
    assert.equal(res.body.count, 0);
    assert.deepEqual(res.body.opportunities, []);
  });

  test('a carrier with no trucks gets an empty briefing, not an error', async () => {
    const carrier = await registerCarrier('carrier1@test.local');
    const res = await request.get('/insights/me').set('Authorization', `Bearer ${carrier.body.token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.role, 'carrier');
    assert.equal(res.body.count, 0);
    assert.deepEqual(res.body.areas, []);
  });

  test('requires auth', async () => {
    const res = await request.get('/insights/me');
    assert.equal(res.status, 401);
  });
});

describe('admin authorization', () => {
  test('a non-admin cannot access /admin/organizations', async () => {
    const shipper = await registerShipper('shipper1@test.local');
    const res = await request.get('/admin/organizations').set('Authorization', `Bearer ${shipper.body.token}`);
    assert.equal(res.status, 403);
  });
});
