const express = require('express');
const cors = require('cors');
const { SCORE_WEIGHTS, MAX_PICKUP_DISTANCE_KM, APPROVAL_WINDOW_MS } = require('./config/matching.config');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'freightcopilot-backend' });
});

// Public, read-only matching-engine constants the frontend displays (e.g. the
// "how AI matching works" explainer) — single source of truth, so the UI
// can't drift out of sync with the actual scoring logic.
app.get('/config', (req, res) => {
  res.json({
    maxPickupDistanceKm: MAX_PICKUP_DISTANCE_KM,
    approvalWindowMinutes: APPROVAL_WINDOW_MS / 60000,
    scoreWeights: {
      distance: Math.round(SCORE_WEIGHTS.distance * 100),
      timing: Math.round(SCORE_WEIGHTS.timing * 100),
      utilization: Math.round(SCORE_WEIGHTS.utilization * 100),
      reliability: Math.round(SCORE_WEIGHTS.reliability * 100),
      acceptanceRate: Math.round(SCORE_WEIGHTS.acceptanceRate * 100),
    },
  });
});

app.use('/auth', require('./routes/auth'));
app.use('/users', require('./routes/users'));
app.use('/availability', require('./routes/availability'));
app.use('/shipments', require('./routes/shipments'));
app.use('/matches', require('./routes/matches'));
app.use('/ratings', require('./routes/ratings'));
app.use('/settings', require('./routes/settings'));
app.use('/map', require('./routes/map'));
app.use('/admin', require('./routes/admin'));

module.exports = app;
