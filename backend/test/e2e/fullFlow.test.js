// One end-to-end test covering the complete MVP flow, per the brief's §8.3
// requirement: signup -> carrier posts availability -> shipper pulls a mock
// shipment -> match requested -> dual approval -> booking -> rating.
const { test, before, after } = require('node:test');
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

test('full flow: signup -> availability -> mock pull -> match -> dual approval -> booking -> rating', async () => {
  // 1. Both sides sign up.
  const shipperSignup = await request.post('/auth/register').send({
    email: 'e2e-shipper@test.local',
    password: 'testpass123',
    fullName: 'Jane Shipper',
    role: 'shipper',
    profile: { companyName: 'E2E Shipping Co' },
  });
  assert.equal(shipperSignup.status, 201);
  const shipperToken = shipperSignup.body.token;

  const carrierSignup = await request.post('/auth/register').send({
    email: 'e2e-carrier@test.local',
    password: 'testpass123',
    fullName: 'Carl Carrier',
    role: 'carrier',
    profile: { companyName: 'E2E Freight Co', baseLocation: 'Sydney, NSW', fleetSize: 3 },
  });
  assert.equal(carrierSignup.status, 201);
  const carrierToken = carrierSignup.body.token;

  // 2. Admin approves both orgs — pending orgs can't transact yet.
  const adminHash = require('bcrypt').hashSync('adminpass123', 4);
  await pool.query(
    `INSERT INTO users (email, password_hash, role, full_name) VALUES ('e2e-admin@test.local', $1, 'admin', 'Admin')`,
    [adminHash]
  );
  const adminLogin = await request.post('/auth/login').send({ email: 'e2e-admin@test.local', password: 'adminpass123' });
  const adminToken = adminLogin.body.token;

  for (const user of [shipperSignup, carrierSignup]) {
    const approve = await request
      .patch(`/admin/organizations/${user.body.user.org_id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'approved' });
    assert.equal(approve.status, 200);
  }

  // 3. Carrier posts truck availability.
  const availability = await request
    .post('/availability')
    .set('Authorization', `Bearer ${carrierToken}`)
    .send({
      availableDate: new Date().toISOString().slice(0, 10),
      truckType: 'semi',
      truckCapacityKg: 25000,
      originRegion: 'Sydney, NSW',
      windowStart: new Date().toISOString(),
      windowEnd: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    });
  assert.equal(availability.status, 201);

  // 4. Shipper pulls a mock shipment, forcing a lane that overlaps the carrier's
  // availability (mock pulls are randomized, so insert one directly instead of
  // retrying the random generator — the mock-pull endpoint itself is covered
  // separately by the integration suite).
  const shipperOrgResult = await pool.query('SELECT id FROM shippers WHERE org_id = $1', [
    shipperSignup.body.user.org_id,
  ]);
  const shipmentResult = await pool.query(
    `INSERT INTO shipments (shipper_id, origin_region, destination_region, weight_kg, truck_type_required,
       pickup_window_start, pickup_window_end, ai_recommended_rate, status)
     VALUES ($1, 'Sydney, NSW', 'Melbourne, VIC', 10000, 'semi', now() + interval '1 hour', now() + interval '4 hours', 1200, 'pending')
     RETURNING id`,
    [shipperOrgResult.rows[0].id]
  );
  const shipmentId = shipmentResult.rows[0].id;

  // 5. Shipper requests a match.
  const matchRequest = await request
    .post('/matches')
    .set('Authorization', `Bearer ${shipperToken}`)
    .send({ shipmentId });
  assert.equal(matchRequest.status, 201);
  const matchId = matchRequest.body.match.id;
  assert.equal(matchRequest.body.match.status, 'pending');

  // 6. Both sides see it in their match list.
  const shipperMatches = await request.get('/matches/me').set('Authorization', `Bearer ${shipperToken}`);
  assert.equal(shipperMatches.body.matches.length, 1);
  const carrierMatches = await request.get('/matches/me').set('Authorization', `Bearer ${carrierToken}`);
  assert.equal(carrierMatches.body.matches.length, 1);

  // 7. Dual approval.
  const shipperApprove = await request
    .post(`/matches/${matchId}/approve`)
    .set('Authorization', `Bearer ${shipperToken}`);
  assert.equal(shipperApprove.status, 200);
  assert.equal(shipperApprove.body.match.status, 'shipper_approved');

  const carrierApprove = await request
    .post(`/matches/${matchId}/approve`)
    .set('Authorization', `Bearer ${carrierToken}`);
  assert.equal(carrierApprove.status, 200);
  assert.equal(carrierApprove.body.match.status, 'booked');

  // 8. Shipment and truck availability both reflect the booking.
  const shipmentRow = await pool.query('SELECT status FROM shipments WHERE id = $1', [shipmentId]);
  assert.equal(shipmentRow.rows[0].status, 'booked');
  const availabilityRow = await pool.query('SELECT is_booked FROM carrier_availability WHERE id = $1', [
    availability.body.availability.id,
  ]);
  assert.equal(availabilityRow.rows[0].is_booked, true);

  // 9. Mark the shipment complete, then both sides rate each other.
  const complete = await request
    .post(`/matches/${matchId}/complete`)
    .set('Authorization', `Bearer ${shipperToken}`);
  assert.equal(complete.status, 200);

  const shipperRates = await request
    .post('/ratings')
    .set('Authorization', `Bearer ${shipperToken}`)
    .send({ matchId, starRating: 5, onTime: true, hadDamageOrComplaint: false, comment: 'Great carrier' });
  assert.equal(shipperRates.status, 201);

  const carrierRates = await request
    .post('/ratings')
    .set('Authorization', `Bearer ${carrierToken}`)
    .send({ matchId, starRating: 4, responseTimeMinutes: 5, wasCancelled: false });
  assert.equal(carrierRates.status, 201);

  // 10. Both reputation summaries reflect the new rating.
  const carrierSummary = await request.get('/ratings/me/summary').set('Authorization', `Bearer ${carrierToken}`);
  assert.equal(carrierSummary.body.summary.count, '1');
  assert.equal(Number(carrierSummary.body.summary.avg_star), 5);

  const shipperSummary = await request.get('/ratings/me/summary').set('Authorization', `Bearer ${shipperToken}`);
  assert.equal(shipperSummary.body.summary.count, '1');
  assert.equal(Number(shipperSummary.body.summary.avg_star), 4);
});
