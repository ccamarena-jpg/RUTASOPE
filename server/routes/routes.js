const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { parse } = require('csv-parse/sync');
const db = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, safe);
  },
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });
const csvUpload = multer({ storage: multer.memoryStorage() });

const SELECT_JOIN = `
  SELECT r.*, d.name AS driver_name, d.vehicle AS vehicle, d.supervisor AS supervisor,
         a.name AS account_name, p.name AS project_name
  FROM routes r
  JOIN drivers d ON d.id = r.driver_id
  JOIN accounts a ON a.id = r.account_id
  LEFT JOIN projects p ON p.id = r.project_id
`;

function scopedWhere(req) {
  if (req.user.role === 'chofer') return { clause: 'r.driver_id = ?', param: req.user.driver_id };
  if (req.user.role === 'cuenta') return { clause: 'r.account_id = ?', param: req.user.account_id };
  return null;
}

// List routes with filters: date, week_start/week_end, driver_id, account_id
router.get('/', (req, res) => {
  const { date, from, to, driver_id, account_id } = req.query;
  const clauses = [];
  const params = [];

  const scope = scopedWhere(req);
  if (scope) {
    clauses.push(scope.clause);
    params.push(scope.param);
  }
  if (date) { clauses.push('r.date = ?'); params.push(date); }
  if (from && to) { clauses.push('r.date BETWEEN ? AND ?'); params.push(from, to); }
  if (driver_id) { clauses.push('r.driver_id = ?'); params.push(driver_id); }
  if (account_id) { clauses.push('r.account_id = ?'); params.push(account_id); }

  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const rows = db.prepare(`${SELECT_JOIN} ${where} ORDER BY r.date, r.hour`).all(...params);
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const row = db.prepare(`${SELECT_JOIN} WHERE r.id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Ruta no encontrada' });
  if (req.user.role === 'chofer' && row.driver_id !== req.user.driver_id) return res.status(403).json({ error: 'No autorizado' });
  if (req.user.role === 'cuenta' && row.account_id !== req.user.account_id) return res.status(403).json({ error: 'No autorizado' });
  res.json(row);
});

// Create single route (admin)
router.post('/', requireRole('admin'), (req, res) => {
  const { date, hour, driver_id, account_id, project_id, destino, motivo } = req.body;
  if (!date || !hour || !driver_id || !account_id || !destino) {
    return res.status(400).json({ error: 'date, hour, driver_id, account_id y destino son requeridos' });
  }
  const info = db.prepare(`INSERT INTO routes (date, hour, driver_id, account_id, project_id, destino, motivo, created_by)
    VALUES (?,?,?,?,?,?,?,?)`).run(date, hour, driver_id, account_id, project_id || null, destino, motivo || '', req.user.email);
  res.json(db.prepare(`${SELECT_JOIN} WHERE r.id = ?`).get(info.lastInsertRowid));
});

// Bulk create via CSV (admin) - columns: date,hour,driver_id,account_id,project_id,destino,motivo
router.post('/bulk', requireRole('admin'), csvUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Archivo CSV requerido (campo "file")' });
  let records;
  try {
    records = parse(req.file.buffer.toString('utf-8'), { columns: true, skip_empty_lines: true, trim: true });
  } catch (e) {
    return res.status(400).json({ error: 'No se pudo leer el CSV: ' + e.message });
  }

  const insert = db.prepare(`INSERT INTO routes (date, hour, driver_id, account_id, project_id, destino, motivo, created_by)
    VALUES (?,?,?,?,?,?,?,?)`);
  const driverByName = db.prepare('SELECT id FROM drivers WHERE lower(name) = lower(?)');
  const accountByName = db.prepare('SELECT id FROM accounts WHERE lower(name) = lower(?)');
  const projectByName = db.prepare('SELECT id FROM projects WHERE lower(name) = lower(?) AND account_id = ?');

  const created = [];
  const errors = [];

  db.exec('BEGIN');
  try {
    records.forEach((row, idx) => {
      const lineNo = idx + 2;
      try {
        const date = row.date || row.fecha;
        const hour = row.hour || row.hora;
        const destino = row.destino;
        const motivo = row.motivo || '';
        let driverId = row.driver_id || null;
        let accountId = row.account_id || null;
        let projectId = row.project_id || null;

        if (!driverId && row.driver_name) driverId = driverByName.get(row.driver_name)?.id;
        if (!accountId && row.account_name) accountId = accountByName.get(row.account_name)?.id;
        if (!projectId && row.project_name && accountId) projectId = projectByName.get(row.project_name, accountId)?.id;

        if (!date || !hour || !destino || !driverId || !accountId) {
          errors.push(`Fila ${lineNo}: faltan datos requeridos (date, hour, destino, chofer, cuenta)`);
          return;
        }
        const info = insert.run(date, hour, driverId, accountId, projectId || null, destino, motivo, req.user.email);
        created.push(info.lastInsertRowid);
      } catch (e) {
        errors.push(`Fila ${lineNo}: ${e.message}`);
      }
    });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: 'Error procesando el archivo: ' + e.message });
  }

  res.json({ created: created.length, errors });
});

// Update route details (admin)
router.put('/:id', requireRole('admin'), (req, res) => {
  const existing = db.prepare('SELECT * FROM routes WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Ruta no encontrada' });
  const { date, hour, driver_id, account_id, project_id, destino, motivo } = req.body;
  db.prepare(`UPDATE routes SET date=?, hour=?, driver_id=?, account_id=?, project_id=?, destino=?, motivo=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(
      date ?? existing.date,
      hour ?? existing.hour,
      driver_id ?? existing.driver_id,
      account_id ?? existing.account_id,
      project_id ?? existing.project_id,
      destino ?? existing.destino,
      motivo ?? existing.motivo,
      req.params.id
    );
  res.json(db.prepare(`${SELECT_JOIN} WHERE r.id = ?`).get(req.params.id));
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM routes WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

function ensureOwnRoute(req, res) {
  const route = db.prepare('SELECT * FROM routes WHERE id = ?').get(req.params.id);
  if (!route) { res.status(404).json({ error: 'Ruta no encontrada' }); return null; }
  if (route.driver_id !== req.user.driver_id) { res.status(403).json({ error: 'No autorizado' }); return null; }
  return route;
}

// Chofer marks hora de salida
router.post('/:id/salida', requireRole('chofer'), (req, res) => {
  const route = ensureOwnRoute(req, res);
  if (!route) return;
  const hora = req.body.hora || new Date().toTimeString().slice(0, 5);
  db.prepare(`UPDATE routes SET hora_salida = ?, status = 'en_curso', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(hora, req.params.id);
  res.json(db.prepare(`${SELECT_JOIN} WHERE r.id = ?`).get(req.params.id));
});

// Chofer marks hora de llegada (completa la tarea)
router.post('/:id/llegada', requireRole('chofer'), (req, res) => {
  const route = ensureOwnRoute(req, res);
  if (!route) return;
  const hora = req.body.hora || new Date().toTimeString().slice(0, 5);
  db.prepare(`UPDATE routes SET hora_llegada = ?, status = 'completado', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(hora, req.params.id);
  res.json(db.prepare(`${SELECT_JOIN} WHERE r.id = ?`).get(req.params.id));
});

// Chofer marks route as no realizada (not completed) with a reason
router.post('/:id/no-realizada', requireRole('chofer'), (req, res) => {
  const route = ensureOwnRoute(req, res);
  if (!route) return;
  const motivo = (req.body.motivo || '').trim();
  if (!motivo) return res.status(400).json({ error: 'Debes indicar el motivo por el que no se realizo' });
  db.prepare(`UPDATE routes SET status = 'no_realizada', motivo_no_realizada = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(motivo, req.params.id);
  res.json(db.prepare(`${SELECT_JOIN} WHERE r.id = ?`).get(req.params.id));
});

// Chofer adds/updates comentario
router.post('/:id/comentario', requireRole('chofer'), (req, res) => {
  const route = ensureOwnRoute(req, res);
  if (!route) return;
  db.prepare(`UPDATE routes SET comentario_chofer = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(req.body.comentario || '', req.params.id);
  res.json(db.prepare(`${SELECT_JOIN} WHERE r.id = ?`).get(req.params.id));
});

// Chofer uploads guia de remision (cargo de entrega)
router.post('/:id/guia', requireRole('chofer'), upload.single('guia'), (req, res) => {
  const route = ensureOwnRoute(req, res);
  if (!route) return;
  if (!req.file) return res.status(400).json({ error: 'Archivo requerido (campo "guia")' });
  db.prepare(`UPDATE routes SET guia_remision_filename = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(req.file.filename, req.params.id);
  res.json(db.prepare(`${SELECT_JOIN} WHERE r.id = ?`).get(req.params.id));
});

module.exports = router;
