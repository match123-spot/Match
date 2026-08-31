const express = require('express');
const { registerUser, loginUser } = require('../services/authService');

const router = express.Router();

router.post('/register', async (req, res) => {
  const { email, password, role, fullName, phone, profile } = req.body;

  if (!email || !password || !role || !fullName) {
    return res.status(400).json({ error: 'email, password, role, and fullName are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }

  try {
    const { user, token } = await registerUser({ email, password, role, fullName, phone, profile });
    res.status(201).json({ user, token });
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.status ? err.message : 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
    const { user, token } = await loginUser({ email, password });
    res.json({ user, token });
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.status ? err.message : 'Login failed' });
  }
});

module.exports = router;
