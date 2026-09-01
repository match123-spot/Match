const express = require('express');
const cors = require('cors');

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

module.exports = app;
