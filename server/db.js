const path = require('path');
const bcrypt = require('bcryptjs');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.join(__dirname, 'ruteo.db');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS drivers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      vehicle TEXT,
      supervisor TEXT,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      account_id INTEGER NOT NULL REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','chofer','cuenta')),
      driver_id INTEGER REFERENCES drivers(id),
      account_id INTEGER REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      hour TEXT NOT NULL,
      driver_id INTEGER NOT NULL REFERENCES drivers(id),
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      project_id INTEGER REFERENCES projects(id),
      destino TEXT NOT NULL,
      motivo TEXT,
      status TEXT NOT NULL DEFAULT 'pendiente' CHECK(status IN ('pendiente','en_curso','completado','no_realizada')),
      hora_salida TEXT,
      hora_llegada TEXT,
      comentario_chofer TEXT,
      motivo_no_realizada TEXT,
      guia_remision_filename TEXT,
      created_by TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_routes_date ON routes(date);
    CREATE INDEX IF NOT EXISTS idx_routes_driver ON routes(driver_id);
    CREATE INDEX IF NOT EXISTS idx_routes_account ON routes(account_id);
  `);

  migrate();

  const userCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (userCount === 0) {
    seed();
  }
}

// Bring an already-existing routes table (created before the 'no_realizada'
// status / motivo column existed) up to the current schema. Idempotent: on a
// fresh DB the CREATE above already matches, so this is a no-op.
function migrate() {
  const tableSql = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='routes'"
  ).get()?.sql || '';

  if (tableSql.includes('no_realizada')) return; // already migrated

  // SQLite can't ALTER a CHECK constraint, so rebuild the table. Copy the old
  // columns over; motivo_no_realizada defaults to NULL for existing rows.
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE routes_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        hour TEXT NOT NULL,
        driver_id INTEGER NOT NULL REFERENCES drivers(id),
        account_id INTEGER NOT NULL REFERENCES accounts(id),
        project_id INTEGER REFERENCES projects(id),
        destino TEXT NOT NULL,
        motivo TEXT,
        status TEXT NOT NULL DEFAULT 'pendiente' CHECK(status IN ('pendiente','en_curso','completado','no_realizada')),
        hora_salida TEXT,
        hora_llegada TEXT,
        comentario_chofer TEXT,
        motivo_no_realizada TEXT,
        guia_remision_filename TEXT,
        created_by TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO routes_new
        (id, date, hour, driver_id, account_id, project_id, destino, motivo, status,
         hora_salida, hora_llegada, comentario_chofer, guia_remision_filename, created_by, updated_at)
      SELECT
         id, date, hour, driver_id, account_id, project_id, destino, motivo, status,
         hora_salida, hora_llegada, comentario_chofer, guia_remision_filename, created_by, updated_at
      FROM routes;
      DROP TABLE routes;
      ALTER TABLE routes_new RENAME TO routes;
      CREATE INDEX IF NOT EXISTS idx_routes_date ON routes(date);
      CREATE INDEX IF NOT EXISTS idx_routes_driver ON routes(driver_id);
      CREATE INDEX IF NOT EXISTS idx_routes_account ON routes(account_id);
    `);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

function seed() {
  const insertDriver = db.prepare('INSERT INTO drivers (name, phone, vehicle, supervisor) VALUES (?,?,?,?)');
  const d1 = insertDriver.run('Christian Herrera', '999111222', 'ABC-123', 'Pamela').lastInsertRowid;
  const d2 = insertDriver.run('Luis Ramirez', '999333444', 'DEF-456', 'Pamela').lastInsertRowid;
  const d3 = insertDriver.run('Jorge Salas', '999555666', 'GHI-789', 'Miguel').lastInsertRowid;

  const insertAccount = db.prepare('INSERT INTO accounts (name) VALUES (?)');
  const a1 = insertAccount.run('Alicorp').lastInsertRowid;
  const a2 = insertAccount.run('Backus').lastInsertRowid;

  const insertProject = db.prepare('INSERT INTO projects (name, account_id) VALUES (?,?)');
  const p1 = insertProject.run('Distribucion Lima Norte', a1).lastInsertRowid;
  const p2 = insertProject.run('Reposicion Tiendas SJL', a1).lastInsertRowid;
  const p3 = insertProject.run('Entrega Canal Moderno', a2).lastInsertRowid;

  const insertUser = db.prepare('INSERT INTO users (email, password_hash, name, role, driver_id, account_id) VALUES (?,?,?,?,?,?)');
  const hash = (pw) => bcrypt.hashSync(pw, 8);

  insertUser.run('admin@ttaudit.com', hash('admin123'), 'Administrador TT Audit', 'admin', null, null);
  insertUser.run('christian.herrera@ttaudit.com', hash('chofer123'), 'Christian Herrera', 'chofer', d1, null);
  insertUser.run('luis.ramirez@ttaudit.com', hash('chofer123'), 'Luis Ramirez', 'chofer', d2, null);
  insertUser.run('jorge.salas@ttaudit.com', hash('chofer123'), 'Jorge Salas', 'chofer', d3, null);
  insertUser.run('cuenta.alicorp@cliente.com', hash('cuenta123'), 'Alicorp - Contacto', 'cuenta', null, a1);
  insertUser.run('cuenta.backus@cliente.com', hash('cuenta123'), 'Backus - Contacto', 'cuenta', null, a2);

  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const fmt = (dt) => dt.toISOString().slice(0, 10);

  const insertRoute = db.prepare(`INSERT INTO routes (date, hour, driver_id, account_id, project_id, destino, motivo, status, created_by)
    VALUES (?,?,?,?,?,?,?,?,?)`);

  const sample = [
    [0, '08:00', d1, a1, p1, 'Almacen Chiclin', 'Carga inicial de pedidos', 'completado'],
    [0, '10:00', d1, a1, p2, 'Cliente Alicorp - SJL', 'Entrega de pedido #4521', 'completado'],
    [0, '09:00', d2, a2, p3, 'Tienda Backus - Surco', 'Reposicion de stock', 'en_curso'],
    [1, '08:00', d1, a1, p1, 'Almacen Chiclin', 'Recojo de mercaderia', 'pendiente'],
    [1, '11:00', d3, a2, p3, 'Tienda Backus - San Isidro', 'Entrega pedido #4530', 'pendiente'],
    [2, '08:00', d2, a1, p2, 'Cliente Alicorp - Los Olivos', 'Entrega de pedido #4540', 'pendiente'],
  ];
  for (const [dayOffset, hour, driverId, accountId, projectId, destino, motivo, status] of sample) {
    const date = fmt(new Date(monday.getTime() + dayOffset * 86400000));
    insertRoute.run(date, hour, driverId, accountId, projectId, destino, motivo, status, 'seed');
  }
}

init();

module.exports = db;
