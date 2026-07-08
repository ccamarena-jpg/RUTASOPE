const express = require('express');
const db = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);

// ---- Drivers ----
router.get('/drivers', (req, res) => {
  const drivers = db.prepare('SELECT * FROM drivers WHERE active = 1 ORDER BY name').all();
  res.json(drivers);
});

router.post('/drivers', requireRole('admin'), (req, res) => {
  const { name, phone, vehicle, supervisor } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  const info = db.prepare('INSERT INTO drivers (name, phone, vehicle, supervisor) VALUES (?,?,?,?)')
    .run(name, phone || '', vehicle || '', supervisor || '');
  res.json(db.prepare('SELECT * FROM drivers WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/drivers/:id', requireRole('admin'), (req, res) => {
  const { name, phone, vehicle, supervisor, active } = req.body;
  db.prepare('UPDATE drivers SET name=?, phone=?, vehicle=?, supervisor=?, active=? WHERE id=?')
    .run(name, phone || '', vehicle || '', supervisor || '', active === undefined ? 1 : active, req.params.id);
  res.json(db.prepare('SELECT * FROM drivers WHERE id = ?').get(req.params.id));
});

// ---- Accounts (cuentas) ----
router.get('/accounts', (req, res) => {
  const accounts = db.prepare('SELECT * FROM accounts ORDER BY name').all();
  res.json(accounts);
});

router.post('/accounts', requireRole('admin'), (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  const info = db.prepare('INSERT INTO accounts (name) VALUES (?)').run(name);
  res.json(db.prepare('SELECT * FROM accounts WHERE id = ?').get(info.lastInsertRowid));
});

// ---- Projects (proyectos, ligados a una cuenta) ----
router.get('/projects', (req, res) => {
  const { account_id } = req.query;
  const projects = account_id
    ? db.prepare('SELECT * FROM projects WHERE account_id = ? ORDER BY name').all(account_id)
    : db.prepare('SELECT * FROM projects ORDER BY name').all();
  res.json(projects);
});

router.post('/projects', requireRole('admin'), (req, res) => {
  const { name, account_id } = req.body;
  if (!name || !account_id) return res.status(400).json({ error: 'Nombre y cuenta requeridos' });
  const info = db.prepare('INSERT INTO projects (name, account_id) VALUES (?,?)').run(name, account_id);
  res.json(db.prepare('SELECT * FROM projects WHERE id = ?').get(info.lastInsertRowid));
});

module.exports = router;
