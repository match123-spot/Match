require('dotenv').config();
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

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`FreightCopilot backend listening on port ${PORT}`);
});
