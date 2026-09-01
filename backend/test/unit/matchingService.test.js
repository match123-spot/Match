const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  distanceKmAndScore,
  scoreTiming,
  scoreUtilization,
  utilizationRatio,
  TRUCK_CLASS_RANK,
  MAX_PICKUP_DISTANCE_KM,
} = require('../../src/services/matchingService');

describe('distanceKmAndScore', () => {
  test('same region scores 100 at 0km', () => {
    const { km, score } = distanceKmAndScore('Sydney, NSW', 'Sydney, NSW');
    assert.equal(km, 0);
    assert.equal(score, 100);
  });

  test('a carrier this far outside the region-hub grid should not falsely score well', () => {
    // Sydney -> Melbourne is genuinely ~713km, far past the 150km cutoff —
    // this is the exact "Auckland truck can't take a Wellington load" case.
    const { km, score } = distanceKmAndScore('Sydney, NSW', 'Melbourne, VIC');
    assert.ok(km > MAX_PICKUP_DISTANCE_KM, `expected >${MAX_PICKUP_DISTANCE_KM}km, got ${km}`);
    assert.equal(score, 0); // clamped at 0, not negative
  });

  test('unknown region returns a neutral score, not a crash', () => {
    const { km, score } = distanceKmAndScore('Nowhereville', 'Sydney, NSW');
    assert.equal(km, null);
    assert.equal(score, 50);
  });
});

describe('scoreTiming', () => {
  test('full overlap scores 100', () => {
    const shipment = { pickup_window_start: '2026-09-01T08:00:00Z', pickup_window_end: '2026-09-01T10:00:00Z' };
    const availability = { window_start: '2026-09-01T07:00:00Z', window_end: '2026-09-01T11:00:00Z' };
    assert.equal(scoreTiming(shipment, availability), 100);
  });

  test('no overlap at all scores 0', () => {
    const shipment = { pickup_window_start: '2026-09-01T08:00:00Z', pickup_window_end: '2026-09-01T10:00:00Z' };
    const availability = { window_start: '2026-09-02T08:00:00Z', window_end: '2026-09-02T10:00:00Z' };
    assert.equal(scoreTiming(shipment, availability), 0);
  });

  test('half overlap scores roughly 50', () => {
    const shipment = { pickup_window_start: '2026-09-01T08:00:00Z', pickup_window_end: '2026-09-01T10:00:00Z' };
    const availability = { window_start: '2026-09-01T09:00:00Z', window_end: '2026-09-01T11:00:00Z' };
    assert.equal(scoreTiming(shipment, availability), 50);
  });
});

describe('scoreUtilization', () => {
  test('a full truck (ratio 1.0) scores 100, not over', () => {
    assert.equal(scoreUtilization(1.0), 100);
  });

  test('85% capacity is the scoring ceiling — reaches 100 exactly there', () => {
    assert.equal(scoreUtilization(0.85), 100);
  });

  test('a half-empty truck scores well under 100', () => {
    const score = scoreUtilization(0.4);
    assert.ok(score > 0 && score < 60, `expected a middling score, got ${score}`);
  });
});

describe('utilizationRatio (weight vs. pallet binding)', () => {
  test('weight is the binding constraint when pallets are light but heavy', () => {
    const shipment = { weight_kg: 20000, pallet_count: 2 };
    const row = { truck_capacity_kg: 25000, truck_type: 'semi' }; // semi pallet cap 24 in the table
    const ratio = utilizationRatio(shipment, row);
    assert.equal(ratio, 20000 / 25000); // 0.8, driven by weight not the near-empty pallet count
  });

  test('pallet count is the binding constraint when the load is light but bulky', () => {
    // 15 pallets on a rigid (pallet capacity 12) but only 3000kg — pallets bind, not weight.
    const shipment = { weight_kg: 3000, pallet_count: 15 };
    const row = { truck_capacity_kg: 15000, truck_type: 'rigid' };
    const ratio = utilizationRatio(shipment, row);
    assert.ok(ratio > 3000 / 15000, 'pallet ratio should dominate the light weight ratio');
  });

  test('no pallet_count on the shipment falls back to weight ratio alone', () => {
    const shipment = { weight_kg: 10000, pallet_count: null };
    const row = { truck_capacity_kg: 20000, truck_type: 'semi' };
    assert.equal(utilizationRatio(shipment, row), 0.5);
  });
});

describe('truck class ranking (right-sizing)', () => {
  test('rigid < semi < B-double, refrigerated excluded from the ranking', () => {
    assert.ok(TRUCK_CLASS_RANK.rigid < TRUCK_CLASS_RANK.semi);
    assert.ok(TRUCK_CLASS_RANK.semi < TRUCK_CLASS_RANK['B-double']);
    assert.equal(TRUCK_CLASS_RANK.refrigerated, undefined);
  });
});
