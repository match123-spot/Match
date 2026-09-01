require('dotenv').config();
const app = require('./app');
const { expireStaleMatches } = require('./services/matchWorkflowService');

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`FreightCopilot backend listening on port ${PORT}`);
});

// Expires matches past their 20-minute dual-approval deadline and auto-rematches.
const MATCH_POLL_INTERVAL_MS = 30 * 1000;
setInterval(() => {
  expireStaleMatches().catch((err) => console.error('expireStaleMatches failed:', err.message));
}, MATCH_POLL_INTERVAL_MS);
