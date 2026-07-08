const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contrasena requeridos' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Credenciales invalidas' });
  }

  const payload = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    driver_id: user.driver_id,
    account_id: user.account_id,
  };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, user: payload });
});

module.exports = router;
