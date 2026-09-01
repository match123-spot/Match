require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { expireStaleMatches } = require('./services/matchWorkflowService');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'freightcopilot-backend' });
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

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`FreightCopilot backend listening on port ${PORT}`);
});

// Expires matches past their 20-minute dual-approval deadline and auto-rematches.
const MATCH_POLL_INTERVAL_MS = 30 * 1000;
setInterval(() => {
  expireStaleMatches().catch((err) => console.error('expireStaleMatches failed:', err.message));
}, MATCH_POLL_INTERVAL_MS);
