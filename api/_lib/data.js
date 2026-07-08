// Data layer backed by a Google Spreadsheet. One tab per "table", with a fixed
// column order defined here (row 1 = headers). All reads/writes go through the
// Sheets API. Volumes are small (an internal tool), so joins are done in JS.
const { sheets, SHEET_ID } = require('./google');

// Column order for each tab. Keep in sync with scripts/seed-sheets.js.
const SCHEMA = {
  users: ['id', 'email', 'password_hash', 'name', 'role', 'driver_id', 'account_id'],
  drivers: ['id', 'name', 'phone', 'vehicle', 'supervisor', 'active'],
  accounts: ['id', 'name'],
  projects: ['id', 'name', 'account_id'],
  routes: [
    'id', 'date', 'hour', 'driver_id', 'account_id', 'project_id', 'destino', 'motivo',
    'status', 'hora_salida', 'hora_llegada', 'comentario_chofer', 'motivo_no_realizada',
    'guia_url', 'created_by', 'updated_at',
  ],
};

// Fields that should be coerced to numbers when reading (blank -> null).
const NUMERIC = new Set(['id', 'driver_id', 'account_id', 'project_id', 'active']);

function coerce(field, value) {
  if (value === '' || value === undefined || value === null) {
    return NUMERIC.has(field) ? null : '';
  }
  if (NUMERIC.has(field)) {
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  }
  return value;
}

function rowToObj(tab, row) {
  const cols = SCHEMA[tab];
  const obj = {};
  cols.forEach((c, i) => { obj[c] = coerce(c, row[i]); });
  return obj;
}

function objToRow(tab, obj) {
  return SCHEMA[tab].map((c) => {
    const v = obj[c];
    return v === null || v === undefined ? '' : String(v);
  });
}

// Read every data row of a tab as objects (skips the header row).
async function readAll(tab) {
  const res = await sheets().spreadsheets.values.get({
    spreadsheetId: SHEET_ID(),
    range: `${tab}!A2:Z`,
  });
  const rows = res.data.values || [];
  return rows.map((r) => rowToObj(tab, r)).filter((o) => o.id !== null && o.id !== '');
}

// Read several tabs in a single API call (fewer requests => friendlier to quotas).
async function readMany(tabs) {
  const res = await sheets().spreadsheets.values.batchGet({
    spreadsheetId: SHEET_ID(),
    ranges: tabs.map((t) => `${t}!A2:Z`),
  });
  const out = {};
  (res.data.valueRanges || []).forEach((vr, i) => {
    const tab = tabs[i];
    const rows = vr.values || [];
    out[tab] = rows.map((r) => rowToObj(tab, r)).filter((o) => o.id !== null && o.id !== '');
  });
  return out;
}

async function nextId(tab) {
  const rows = await readAll(tab);
  return rows.reduce((max, r) => Math.max(max, Number(r.id) || 0), 0) + 1;
}

async function append(tab, obj) {
  const id = obj.id != null ? obj.id : await nextId(tab);
  const record = { ...obj, id };
  await sheets().spreadsheets.values.append({
    spreadsheetId: SHEET_ID(),
    range: `${tab}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [objToRow(tab, record)] },
  });
  return record;
}

// Find the 1-based sheet row number (including header) for a given id.
async function findRowNumber(tab, id) {
  const res = await sheets().spreadsheets.values.get({
    spreadsheetId: SHEET_ID(),
    range: `${tab}!A2:A`,
  });
  const ids = res.data.values || [];
  const idx = ids.findIndex((r) => String(r[0]) === String(id));
  return idx === -1 ? null : idx + 2; // +2: skip header, 1-based
}

async function updateById(tab, id, patch) {
  const rowNum = await findRowNumber(tab, id);
  if (rowNum === null) return null;
  const current = await getById(tab, id);
  const merged = { ...current, ...patch, id: current.id };
  await sheets().spreadsheets.values.update({
    spreadsheetId: SHEET_ID(),
    range: `${tab}!A${rowNum}`,
    valueInputOption: 'RAW',
    requestBody: { values: [objToRow(tab, merged)] },
  });
  return merged;
}

async function getById(tab, id) {
  const rows = await readAll(tab);
  return rows.find((r) => String(r.id) === String(id)) || null;
}

async function deleteById(tab, id) {
  const rowNum = await findRowNumber(tab, id);
  if (rowNum === null) return false;
  const sheetId = await getTabId(tab);
  await sheets().spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID(),
    requestBody: {
      requests: [{
        deleteDimension: {
          range: { sheetId, dimension: 'ROWS', startIndex: rowNum - 1, endIndex: rowNum },
        },
      }],
    },
  });
  return true;
}

// Map tab name -> numeric sheetId (gid), cached.
let _tabIds = null;
async function getTabId(tab) {
  if (!_tabIds) {
    const meta = await sheets().spreadsheets.get({ spreadsheetId: SHEET_ID() });
    _tabIds = {};
    for (const s of meta.data.sheets || []) _tabIds[s.properties.title] = s.properties.sheetId;
  }
  return _tabIds[tab];
}

module.exports = {
  SCHEMA,
  readAll,
  readMany,
  append,
  getById,
  updateById,
  deleteById,
};
