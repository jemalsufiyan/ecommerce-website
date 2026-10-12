const express = require('express');
const db = require('../db');
const router = express.Router();

// 1. User Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ status: 'error', message: 'Email and password are required' });
  }

  try {
    // Check using password_hash column
    const result = await db.query(
      'SELECT user_id, username, email, is_admin FROM users WHERE email = $1 AND password_hash = $2',
      [email, password]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ status: 'error', message: 'Invalid credentials' });
    }

    res.json({ status: 'success', data: result.rows[0] });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// 2. Customer Registration (Sign Up)
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ status: 'error', message: 'Email and password are required' });
  }

  try {
    // Check if email already exists
    const existing = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ status: 'error', message: 'Email already registered' });
    }

    // Insert new customer using password_hash column
    const result = await db.query(
      'INSERT INTO users (username, email, password_hash, is_admin) VALUES ($1, $2, $3, false) RETURNING user_id, username, email, is_admin',
      [username || email.split('@')[0], email, password]
    );

    res.json({ status: 'success', data: result.rows[0] });
  } catch (err) {
    console.error('Registration error:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;