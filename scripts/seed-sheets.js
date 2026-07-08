// One-time setup: creates the tabs (with headers) in your Google Sheet and
// fills them with the same seed data the old SQLite version had.
//
// Usage (from the repo root, with a valid .env):
//   npm run seed
//
// Safe to re-run: it only creates missing tabs and only seeds when the "users"
// tab is still empty, so it won't duplicate data.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { sheets, SHEET_ID } = require('../api/_lib/google');
const { SCHEMA } = require('../api/_lib/data');

async function ensureTabs() {
  const meta = await sheets().spreadsheets.get({ spreadsheetId: SHEET_ID() });
  const existing = new Set((meta.data.sheets || []).map((s) => s.properties.title));
  const toAdd = Object.keys(SCHEMA).filter((t) => !existing.has(t));
  if (toAdd.length) {
    await sheets().spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID(),
      requestBody: { requests: toAdd.map((title) => ({ addSheet: { properties: { title } } })) },
    });
    console.log('Pestanas creadas:', toAdd.join(', '));
  }
  // Write header row for every tab.
  for (const [tab, cols] of Object.entries(SCHEMA)) {
    await sheets().spreadsheets.values.update({
      spreadsheetId: SHEET_ID(),
      range: `${tab}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [cols] },
    });
  }
  console.log('Encabezados escritos.');
}

async function usersEmpty() {
  const res = await sheets().spreadsheets.values.get({ spreadsheetId: SHEET_ID(), range: 'users!A2:A' });
  return !(res.data.values && res.data.values.length);
}

async function writeRows(tab, objects) {
  const cols = SCHEMA[tab];
  const values = objects.map((o) => cols.map((c) => (o[c] == null ? '' : String(o[c]))));
  await sheets().spreadsheets.values.append({
    spreadsheetId: SHEET_ID(),
    range: `${tab}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });
  console.log(`  ${tab}: ${values.length} filas`);
}

function seedData() {
  const hash = (pw) => bcrypt.hashSync(pw, 8);

  const drivers = [
    { id: 1, name: 'Christian Herrera', phone: '999111222', vehicle: 'ABC-123', supervisor: 'Pamela', active: 1 },
    { id: 2, name: 'Luis Ramirez', phone: '999333444', vehicle: 'DEF-456', supervisor: 'Pamela', active: 1 },
    { id: 3, name: 'Jorge Salas', phone: '999555666', vehicle: 'GHI-789', supervisor: 'Miguel', active: 1 },
  ];
  const accounts = [
    { id: 1, name: 'Alicorp' },
    { id: 2, name: 'Backus' },
  ];
  const projects = [
    { id: 1, name: 'Distribucion Lima Norte', account_id: 1 },
    { id: 2, name: 'Reposicion Tiendas SJL', account_id: 1 },
    { id: 3, name: 'Entrega Canal Moderno', account_id: 2 },
  ];
  const users = [
    { id: 1, email: 'admin@ttaudit.com', password_hash: hash('admin123'), name: 'Administrador TT Audit', role: 'admin', driver_id: '', account_id: '' },
    { id: 2, email: 'christian.herrera@ttaudit.com', password_hash: hash('chofer123'), name: 'Christian Herrera', role: 'chofer', driver_id: 1, account_id: '' },
    { id: 3, email: 'luis.ramirez@ttaudit.com', password_hash: hash('chofer123'), name: 'Luis Ramirez', role: 'chofer', driver_id: 2, account_id: '' },
    { id: 4, email: 'jorge.salas@ttaudit.com', password_hash: hash('chofer123'), name: 'Jorge Salas', role: 'chofer', driver_id: 3, account_id: '' },
    { id: 5, email: 'cuenta.alicorp@cliente.com', password_hash: hash('cuenta123'), name: 'Alicorp - Contacto', role: 'cuenta', driver_id: '', account_id: 1 },
    { id: 6, email: 'cuenta.backus@cliente.com', password_hash: hash('cuenta123'), name: 'Backus - Contacto', role: 'cuenta', driver_id: '', account_id: 2 },
  ];

  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const fmt = (dt) => dt.toISOString().slice(0, 10);
  const dateAt = (off) => fmt(new Date(monday.getTime() + off * 86400000));

  const sample = [
    [0, '08:00', 1, 1, 1, 'Almacen Chiclin', 'Carga inicial de pedidos', 'completado'],
    [0, '10:00', 1, 1, 2, 'Cliente Alicorp - SJL', 'Entrega de pedido #4521', 'completado'],
    [0, '09:00', 2, 2, 3, 'Tienda Backus - Surco', 'Reposicion de stock', 'en_curso'],
    [1, '08:00', 1, 1, 1, 'Almacen Chiclin', 'Recojo de mercaderia', 'pendiente'],
    [1, '11:00', 3, 2, 3, 'Tienda Backus - San Isidro', 'Entrega pedido #4530', 'pendiente'],
    [2, '08:00', 2, 1, 2, 'Cliente Alicorp - Los Olivos', 'Entrega de pedido #4540', 'pendiente'],
  ];
  const routes = sample.map((s, i) => ({
    id: i + 1, date: dateAt(s[0]), hour: s[1], driver_id: s[2], account_id: s[3], project_id: s[4],
    destino: s[5], motivo: s[6], status: s[7], hora_salida: '', hora_llegada: '', comentario_chofer: '',
    motivo_no_realizada: '', guia_url: '', created_by: 'seed', updated_at: new Date().toISOString(),
  }));

  return { drivers, accounts, projects, users, routes };
}

async function main() {
  console.log('Hoja:', SHEET_ID());
  await ensureTabs();
  if (!(await usersEmpty())) {
    console.log('La pestana "users" ya tiene datos: no se vuelve a sembrar. Listo.');
    return;
  }
  console.log('Sembrando datos de ejemplo...');
  const { drivers, accounts, projects, users, routes } = seedData();
  await writeRows('drivers', drivers);
  await writeRows('accounts', accounts);
  await writeRows('projects', projects);
  await writeRows('users', users);
  await writeRows('routes', routes);
  console.log('\nListo. Usuarios de prueba: admin@ttaudit.com / admin123');
}

main().catch((e) => { console.error('\nError:', e.message); process.exit(1); });
