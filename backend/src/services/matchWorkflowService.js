const { pool } = require('../config/db');
const { rankCandidates } = require('./matchingService');
const { sendMatchRequestEmail, sendBookingConfirmationEmail } = require('./emailService');
const { APPROVAL_WINDOW_MS, CANDIDATE_POOL_SIZE } = require('../config/matching.config');

const OPEN_STATUSES = ['pending', 'shipper_approved', 'carrier_approved'];

async function getExcludedAvailabilityIds(shipmentId) {
  const { rows } = await pool.query(
    `SELECT carrier_availability_id FROM matches WHERE shipment_id = $1 AND carrier_availability_id IS NOT NULL`,
    [shipmentId]
  );
  return rows.map((r) => r.carrier_availability_id);
}

/**
 * Auto-approves a freshly created match on whichever side has opted in and
 * clears its threshold: shippers set a max acceptable rate, carriers set a
 * min acceptable rate (their idle-truck opportunity cost). Each side is
 * independent — a match can end up half auto-approved, waiting on a human
 * on the other side.
 */
async function maybeAutoApprove(match, shipment, carrierInfo) {
  const rate = shipment.ai_recommended_rate;
  if (rate == null) return;

  const shipperResult = await pool.query('SELECT auto_approve_max_cost FROM shippers WHERE id = $1', [
    shipment.shipper_id,
  ]);
  // System-initiated approval — no specific human, so approved_by stays null.
  const shipperThreshold = shipperResult.rows[0]?.auto_approve_max_cost;
  const carrierThreshold = carrierInfo.auto_approve_min_income;

  if (shipperThreshold != null && Number(rate) <= Number(shipperThreshold)) {
    await approveMatch(match.id, 'shipper');
  }
  if (carrierThreshold != null && Number(rate) >= Number(carrierThreshold)) {
    await approveMatch(match.id, 'carrier');
  }
}

/**
 * Picks the best not-yet-tried candidate for a shipment and opens a new
 * 20-minute dual-approval window. Used both for the shipper's initial match
 * request and for auto-rematch after a rejection or expiry.
 */
async function createMatchForShipment(shipment, { rematchOf = null } = {}) {
  const excluded = await getExcludedAvailabilityIds(shipment.id);
  const candidates = await rankCandidates(shipment, CANDIDATE_POOL_SIZE);
  const pick = candidates.find((c) => !excluded.includes(c.availabilityId));

  if (!pick) {
    await pool.query(`UPDATE shipments SET status = 'pending', updated_at = now() WHERE id = $1`, [shipment.id]);
    return null;
  }

  const deadline = new Date(Date.now() + APPROVAL_WINDOW_MS);
  const { rows } = await pool.query(
    `INSERT INTO matches
       (shipment_id, carrier_id, carrier_availability_id, score_total, score_distance, score_timing,
        score_utilization, score_reliability, score_acceptance_rate, approval_deadline, is_rematch_of)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [
      shipment.id,
      pick.carrier.id,
      pick.availabilityId,
      pick.scores.total,
      pick.scores.distance,
      pick.scores.timing,
      pick.scores.utilization,
      pick.scores.reliability,
      pick.scores.acceptanceRate,
      deadline,
      rematchOf,
    ]
  );
  const match = rows[0];

  await pool.query(`UPDATE shipments SET status = 'awaiting_approval', updated_at = now() WHERE id = $1`, [
    shipment.id,
  ]);

  const carrierResult = await pool.query(
    `SELECT o.company_name, c.auto_approve_min_income,
            array_agg(u.email) AS carrier_emails
     FROM carriers c
     JOIN organizations o ON o.id = c.org_id
     JOIN users u ON u.org_id = c.org_id
     WHERE c.id = $1
     GROUP BY o.company_name, c.auto_approve_min_income`,
    [match.carrier_id]
  );
  const carrierInfo = carrierResult.rows[0];

  await sendMatchRequestEmail(carrierInfo.carrier_emails, { shipment });
  await maybeAutoApprove(match, shipment, carrierInfo);

  const finalResult = await pool.query('SELECT * FROM matches WHERE id = $1', [match.id]);
  return finalResult.rows[0];
}

async function bookMatch(match) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE matches SET status = 'booked', updated_at = now() WHERE id = $1`, [match.id]);
    await client.query(`UPDATE shipments SET status = 'booked', updated_at = now() WHERE id = $1`, [
      match.shipment_id,
    ]);
    await client.query(`UPDATE carrier_availability SET is_booked = true WHERE id = $1`, [
      match.carrier_availability_id,
    ]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function sendBookingEmails(matchId) {
  const { rows } = await pool.query(
    `SELECT s.*, oc.company_name AS carrier_company_name,
            array_agg(DISTINCT us.email) AS shipper_emails,
            array_agg(DISTINCT uc.email) AS carrier_emails
     FROM matches m
     JOIN shipments s ON s.id = m.shipment_id
     JOIN shippers sh ON sh.id = s.shipper_id
     JOIN users us ON us.org_id = sh.org_id
     JOIN carriers c ON c.id = m.carrier_id
     JOIN organizations oc ON oc.id = c.org_id
     JOIN users uc ON uc.org_id = c.org_id
     WHERE m.id = $1
     GROUP BY s.id, oc.company_name`,
    [matchId]
  );
  const ctx = rows[0];
  if (!ctx) return;

  await sendBookingConfirmationEmail({
    shipperEmails: ctx.shipper_emails,
    carrierEmails: ctx.carrier_emails,
    shipment: ctx,
    carrierCompanyName: ctx.carrier_company_name,
  });
}

/**
 * Resolves whether `orgId` is the shipper org or the carrier org on a given
 * match — any user belonging to that org can act on its behalf, not just
 * whoever originally signed up.
 */
async function getMatchForUser(matchId, orgId) {
  const { rows } = await pool.query(
    `SELECT m.*, sh.org_id AS shipper_org_id, c.org_id AS carrier_org_id
     FROM matches m
     JOIN shipments s ON s.id = m.shipment_id
     JOIN shippers sh ON sh.id = s.shipper_id
     JOIN carriers c ON c.id = m.carrier_id
     WHERE m.id = $1`,
    [matchId]
  );
  const row = rows[0];
  if (!row) return null;
  if (row.shipper_org_id === orgId) return { match: row, role: 'shipper' };
  if (row.carrier_org_id === orgId) return { match: row, role: 'carrier' };
  return null;
}

async function approveMatch(matchId, role, approvingUserId = null) {
  const atColumn = role === 'shipper' ? 'shipper_approved_at' : 'carrier_approved_at';
  const byColumn = role === 'shipper' ? 'shipper_approved_by' : 'carrier_approved_by';
  const { rows } = await pool.query(
    `UPDATE matches SET ${atColumn} = now(), ${byColumn} = $3, updated_at = now()
     WHERE id = $1 AND status = ANY($2) AND approval_deadline > now()
     RETURNING *`,
    [matchId, OPEN_STATUSES, approvingUserId]
  );
  const match = rows[0];
  if (!match) return null;

  const bothApproved = Boolean(match.shipper_approved_at && match.carrier_approved_at);
  const newStatus = bothApproved ? 'dual_approved' : match.shipper_approved_at ? 'shipper_approved' : 'carrier_approved';

  const updated = await pool.query(`UPDATE matches SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`, [
    matchId,
    newStatus,
  ]);

  if (bothApproved) {
    await bookMatch(updated.rows[0]);
    await sendBookingEmails(matchId);
    const rebooked = await pool.query('SELECT * FROM matches WHERE id = $1', [matchId]);
    return rebooked.rows[0];
  }

  return updated.rows[0];
}

async function rejectMatch(matchId, role) {
  const { rows } = await pool.query(
    `UPDATE matches SET status = 'rejected', rejected_by = $2, updated_at = now()
     WHERE id = $1 AND status = ANY($3) RETURNING *`,
    [matchId, role, OPEN_STATUSES]
  );
  const match = rows[0];
  if (!match) return null;

  const shipmentResult = await pool.query('SELECT * FROM shipments WHERE id = $1', [match.shipment_id]);
  const rematch = await createMatchForShipment(shipmentResult.rows[0], { rematchOf: match.id });
  return { match, rematch };
}

/** Called by the background poller: expires overdue matches and auto-rematches. */
async function expireStaleMatches() {
  const { rows: expired } = await pool.query(
    `UPDATE matches SET status = 'expired', updated_at = now()
     WHERE status = ANY($1) AND approval_deadline < now()
     RETURNING *`,
    [OPEN_STATUSES]
  );

  for (const match of expired) {
    const shipmentResult = await pool.query('SELECT * FROM shipments WHERE id = $1', [match.shipment_id]);
    await createMatchForShipment(shipmentResult.rows[0], { rematchOf: match.id });
  }

  return expired;
}

module.exports = {
  createMatchForShipment,
  approveMatch,
  rejectMatch,
  expireStaleMatches,
  getMatchForUser,
  getExcludedAvailabilityIds,
};
