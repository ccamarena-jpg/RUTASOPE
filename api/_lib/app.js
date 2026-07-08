// Express app that powers the whole API, backed by Google Sheets + Drive.
// On Vercel it is exported as a single serverless function (see api/[...path].js).
// Locally it can be run as a normal server (see dev.js).
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { parse } = require('csv-parse/sync');

const data = require('./data');
const { uploadGuia } = require('./driveUpload');
const { authRequired, requireRole, signToken } = require('./auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const app = express();
app.use(cors());
app.use(express.json());

// ---------- helpers ----------
function enrichRoutes(routes, { drivers, accounts, projects }) {
  const dById = new Map(drivers.map((d) => [Number(d.id), d]));
  const aById = new Map(accounts.map((a) => [Number(a.id), a]));
  const pById = new Map(projects.map((p) => [Number(p.id), p]));
  return routes.map((r) => {
    const d = dById.get(Number(r.driver_id));
    const a = aById.get(Number(r.account_id));
    const p = r.project_id ? pById.get(Number(r.project_id)) : null;
    return {
      ...r,
      driver_name: d ? d.name : null,
      vehicle: d ? d.vehicle : null,
      supervisor: d ? d.supervisor : null,
      account_name: a ? a.name : null,
      project_name: p ? p.name : null,
    };
  });
}

async function loadCatalogs() {
  const { drivers, accounts, projects } = await data.readMany(['drivers', 'accounts', 'projects']);
  return { drivers: drivers || [], accounts: accounts || [], projects: projects || [] };
}

async function enrichOne(route) {
  if (!route) return null;
  const catalogs = await loadCatalogs();
  return enrichRoutes([route], catalogs)[0];
}

function nowISO() { return new Date().toISOString(); }

// Wrap async handlers so thrown errors become clean 500s instead of hanging.
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error(e);
  res.status(500).json({ error: e.message || 'Error interno' });
});

// ---------- health ----------
app.get('/api/health', (req, res) => res.json({ ok: true, time: nowISO() }));

// ---------- auth ----------
app.post('/api/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contrasena requeridos' });
  const users = await data.readAll('users');
  const user = users.find((u) => String(u.email).trim().toLowerCase() === email.trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password, String(user.password_hash))) {
    return res.status(401).json({ error: 'Credenciales invalidas' });
  }
  const payload = {
    id: user.id, email: user.email, name: user.name, role: user.role,
    driver_id: user.driver_id, account_id: user.account_id,
  };
  res.json({ token: signToken(payload), user: payload });
}));

// Everything below requires a valid token.
app.use('/api', authRequired);

// ---------- catalog: drivers ----------
app.get('/api/drivers', wrap(async (req, res) => {
  const drivers = (await data.readAll('drivers')).filter((d) => d.active !== 0);
  drivers.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  res.json(drivers);
}));

app.post('/api/drivers', requireRole('admin'), wrap(async (req, res) => {
  const { name, phone, vehicle, supervisor } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  const rec = await data.append('drivers', { name, phone: phone || '', vehicle: vehicle || '', supervisor: supervisor || '', active: 1 });
  res.json(rec);
}));

app.put('/api/drivers/:id', requireRole('admin'), wrap(async (req, res) => {
  const { name, phone, vehicle, supervisor, active } = req.body;
  const patch = { name, phone: phone || '', vehicle: vehicle || '', supervisor: supervisor || '', active: active === undefined ? 1 : active };
  const rec = await data.updateById('drivers', req.params.id, patch);
  if (!rec) return res.status(404).json({ error: 'Chofer no encontrado' });
  res.json(rec);
}));

// ---------- catalog: accounts ----------
app.get('/api/accounts', wrap(async (req, res) => {
  const accounts = await data.readAll('accounts');
  accounts.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  res.json(accounts);
}));

app.post('/api/accounts', requireRole('admin'), wrap(async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  res.json(await data.append('accounts', { name }));
}));

// ---------- catalog: projects ----------
app.get('/api/projects', wrap(async (req, res) => {
  const { account_id } = req.query;
  let projects = await data.readAll('projects');
  if (account_id) projects = projects.filter((p) => String(p.account_id) === String(account_id));
  projects.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  res.json(projects);
}));

app.post('/api/projects', requireRole('admin'), wrap(async (req, res) => {
  const { name, account_id } = req.body;
  if (!name || !account_id) return res.status(400).json({ error: 'Nombre y cuenta requeridos' });
  res.json(await data.append('projects', { name, account_id }));
}));

// ---------- routes ----------
function scopeFilter(req, routes) {
  if (req.user.role === 'chofer') return routes.filter((r) => Number(r.driver_id) === Number(req.user.driver_id));
  if (req.user.role === 'cuenta') return routes.filter((r) => Number(r.account_id) === Number(req.user.account_id));
  return routes;
}

app.get('/api/routes', wrap(async (req, res) => {
  const { date, from, to, driver_id, account_id } = req.query;
  const [routesRaw, catalogs] = await Promise.all([data.readAll('routes'), loadCatalogs()]);
  let routes = scopeFilter(req, routesRaw);
  if (date) routes = routes.filter((r) => r.date === date);
  if (from && to) routes = routes.filter((r) => r.date >= from && r.date <= to);
  if (driver_id) routes = routes.filter((r) => Number(r.driver_id) === Number(driver_id));
  if (account_id) routes = routes.filter((r) => Number(r.account_id) === Number(account_id));
  routes.sort((a, b) => (a.date + a.hour).localeCompare(b.date + b.hour));
  res.json(enrichRoutes(routes, catalogs));
}));

app.get('/api/routes/:id', wrap(async (req, res) => {
  const route = await data.getById('routes', req.params.id);
  if (!route) return res.status(404).json({ error: 'Ruta no encontrada' });
  if (req.user.role === 'chofer' && Number(route.driver_id) !== Number(req.user.driver_id)) return res.status(403).json({ error: 'No autorizado' });
  if (req.user.role === 'cuenta' && Number(route.account_id) !== Number(req.user.account_id)) return res.status(403).json({ error: 'No autorizado' });
  res.json(await enrichOne(route));
}));

app.post('/api/routes', requireRole('admin'), wrap(async (req, res) => {
  const { date, hour, driver_id, account_id, project_id, destino, motivo } = req.body;
  if (!date || !hour || !driver_id || !account_id || !destino) {
    return res.status(400).json({ error: 'date, hour, driver_id, account_id y destino son requeridos' });
  }
  const rec = await data.append('routes', {
    date, hour, driver_id, account_id, project_id: project_id || null,
    destino, motivo: motivo || '', status: 'pendiente',
    hora_salida: '', hora_llegada: '', comentario_chofer: '', motivo_no_realizada: '',
    guia_url: '', created_by: req.user.email, updated_at: nowISO(),
  });
  res.json(await enrichOne(rec));
}));

// Bulk create via CSV (admin). Resolves names to ids using current catalogs.
app.post('/api/routes/bulk', requireRole('admin'), upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Archivo CSV requerido (campo "file")' });
  let records;
  try {
    records = parse(req.file.buffer.toString('utf-8'), { columns: true, skip_empty_lines: true, trim: true });
  } catch (e) {
    return res.status(400).json({ error: 'No se pudo leer el CSV: ' + e.message });
  }

  const { drivers, accounts, projects } = await loadCatalogs();
  const findDriver = (name) => drivers.find((d) => String(d.name).toLowerCase() === String(name).toLowerCase());
  const findAccount = (name) => accounts.find((a) => String(a.name).toLowerCase() === String(name).toLowerCase());
  const findProject = (name, accId) => projects.find((p) => String(p.name).toLowerCase() === String(name).toLowerCase() && String(p.account_id) === String(accId));

  const existing = await data.readAll('routes');
  let maxId = existing.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);

  const rowsToInsert = [];
  const errors = [];
  records.forEach((row, idx) => {
    const lineNo = idx + 2;
    const date = row.date || row.fecha;
    const hour = row.hour || row.hora;
    const destino = row.destino;
    const motivo = row.motivo || '';
    let driverId = row.driver_id || null;
    let accountId = row.account_id || null;
    let projectId = row.project_id || null;
    if (!driverId && row.driver_name) driverId = findDriver(row.driver_name)?.id;
    if (!accountId && row.account_name) accountId = findAccount(row.account_name)?.id;
    if (!projectId && row.project_name && accountId) projectId = findProject(row.project_name, accountId)?.id;
    if (!date || !hour || !destino || !driverId || !accountId) {
      errors.push(`Fila ${lineNo}: faltan datos requeridos (date, hour, destino, chofer, cuenta)`);
      return;
    }
    rowsToInsert.push({
      id: ++maxId, date, hour, driver_id: driverId, account_id: accountId, project_id: projectId || null,
      destino, motivo, status: 'pendiente', hora_salida: '', hora_llegada: '', comentario_chofer: '',
      motivo_no_realizada: '', guia_url: '', created_by: req.user.email, updated_at: nowISO(),
    });
  });

  if (rowsToInsert.length) {
    const values = rowsToInsert.map((o) => data.SCHEMA.routes.map((c) => (o[c] == null ? '' : String(o[c]))));
    const { sheets, SHEET_ID } = require('./google');
    await sheets().spreadsheets.values.append({
      spreadsheetId: SHEET_ID(),
      range: 'routes!A1',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    });
  }
  res.json({ created: rowsToInsert.length, errors });
}));

app.put('/api/routes/:id', requireRole('admin'), wrap(async (req, res) => {
  const existing = await data.getById('routes', req.params.id);
  if (!existing) return res.status(404).json({ error: 'Ruta no encontrada' });
  const { date, hour, driver_id, account_id, project_id, destino, motivo } = req.body;
  const patch = {
    date: date ?? existing.date,
    hour: hour ?? existing.hour,
    driver_id: driver_id ?? existing.driver_id,
    account_id: account_id ?? existing.account_id,
    project_id: project_id ?? existing.project_id,
    destino: destino ?? existing.destino,
    motivo: motivo ?? existing.motivo,
    updated_at: nowISO(),
  };
  const rec = await data.updateById('routes', req.params.id, patch);
  res.json(await enrichOne(rec));
}));

app.delete('/api/routes/:id', requireRole('admin'), wrap(async (req, res) => {
  await data.deleteById('routes', req.params.id);
  res.json({ ok: true });
}));

// Chofer-only actions on own routes.
async function ensureOwnRoute(req, res) {
  const route = await data.getById('routes', req.params.id);
  if (!route) { res.status(404).json({ error: 'Ruta no encontrada' }); return null; }
  if (Number(route.driver_id) !== Number(req.user.driver_id)) { res.status(403).json({ error: 'No autorizado' }); return null; }
  return route;
}

app.post('/api/routes/:id/salida', requireRole('chofer'), wrap(async (req, res) => {
  const route = await ensureOwnRoute(req, res);
  if (!route) return;
  const hora = req.body.hora || new Date().toTimeString().slice(0, 5);
  const rec = await data.updateById('routes', req.params.id, { hora_salida: hora, status: 'en_curso', updated_at: nowISO() });
  res.json(await enrichOne(rec));
}));

app.post('/api/routes/:id/llegada', requireRole('chofer'), wrap(async (req, res) => {
  const route = await ensureOwnRoute(req, res);
  if (!route) return;
  const hora = req.body.hora || new Date().toTimeString().slice(0, 5);
  const rec = await data.updateById('routes', req.params.id, { hora_llegada: hora, status: 'completado', updated_at: nowISO() });
  res.json(await enrichOne(rec));
}));

app.post('/api/routes/:id/comentario', requireRole('chofer'), wrap(async (req, res) => {
  const route = await ensureOwnRoute(req, res);
  if (!route) return;
  const rec = await data.updateById('routes', req.params.id, { comentario_chofer: req.body.comentario || '', updated_at: nowISO() });
  res.json(await enrichOne(rec));
}));

app.post('/api/routes/:id/no-realizada', requireRole('chofer'), wrap(async (req, res) => {
  const route = await ensureOwnRoute(req, res);
  if (!route) return;
  const motivo = (req.body.motivo || '').trim();
  if (!motivo) return res.status(400).json({ error: 'Debes indicar el motivo por el que no se realizo' });
  const rec = await data.updateById('routes', req.params.id, { status: 'no_realizada', motivo_no_realizada: motivo, updated_at: nowISO() });
  res.json(await enrichOne(rec));
}));

app.post('/api/routes/:id/guia', requireRole('chofer'), upload.single('guia'), wrap(async (req, res) => {
  const route = await ensureOwnRoute(req, res);
  if (!route) return;
  if (!req.file) return res.status(400).json({ error: 'Archivo requerido (campo "guia")' });
  const url = await uploadGuia(req.file.buffer, req.file.originalname, req.file.mimetype);
  const rec = await data.updateById('routes', req.params.id, { guia_url: url, updated_at: nowISO() });
  res.json(await enrichOne(rec));
}));

module.exports = app;
