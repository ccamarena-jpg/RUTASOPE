/**
 * Ruteo TT Audit — Backend completo en Google Apps Script.
 *
 * Reemplaza a la API serverless. No necesita proyecto en Google Cloud, ni
 * cuenta de servicio, ni llave JSON: Apps Script ya tiene acceso nativo a la
 * hoja (SpreadsheetApp) y a Drive (DriveApp).
 *
 * COMO USAR (ver apps-script/README.md para el detalle):
 *   1. Crea una hoja de calculo en Google Sheets.
 *   2. Extensiones > Apps Script. Pega TODO este archivo.
 *   3. Cambia CONFIG.JWT_SECRET por una cadena larga y aleatoria.
 *   4. Ejecuta la funcion setup() una vez (crea las pestanas + datos de ejemplo).
 *   5. Implementar > Nueva implementacion > Aplicacion web:
 *        - Ejecutar como: Yo
 *        - Quien tiene acceso: Cualquier persona
 *      Copia la URL /exec y pegala en el frontend (VITE_APPS_SCRIPT_URL).
 */

// ====== CONFIG ======
var CONFIG = {
  // Deja vacio si el script esta VINCULADO a la hoja (Extensiones > Apps Script
  // desde el propio Sheet). Si es un script independiente, pon el ID de la hoja.
  SHEET_ID: '',
  // Carpeta de Drive para las guias de remision. Vacio = raiz de tu Drive.
  DRIVE_FOLDER_ID: '',
  // Clave para firmar los tokens de sesion. CAMBIALA por algo largo y aleatorio.
  JWT_SECRET: 'cambia-esto-por-una-cadena-larga-y-aleatoria',
  // Duracion del token de sesion (dias).
  TOKEN_DAYS: 30,
  // ID de cliente OAuth de Google para "Iniciar sesion con Google" (personal
  // TT Audit). Se crea una vez en la Consola de Google (ver apps-script/README).
  // Debe ser el MISMO que uses en el frontend (VITE_GOOGLE_CLIENT_ID).
  GOOGLE_CLIENT_ID: '850065266017-3tvj9u512flo9dbfpk88gnn3mofbtt8s.apps.googleusercontent.com',
};

// Orden de columnas por pestana (fila 1 = encabezados).
var SCHEMA = {
  users: ['id', 'email', 'password_hash', 'name', 'role', 'driver_id', 'account_id'],
  drivers: ['id', 'name', 'phone', 'vehicle', 'supervisor', 'active', 'last_lat', 'last_lng', 'last_loc_at'],
  accounts: ['id', 'name'],
  projects: ['id', 'name', 'account_id'],
  routes: [
    'id', 'date', 'hour', 'driver_id', 'account_id', 'project_id', 'destino', 'motivo',
    'status', 'hora_salida', 'hora_llegada', 'comentario_chofer', 'motivo_no_realizada',
    'guia_url', 'created_by', 'updated_at',
    'cantidad_bultos', 'gr_firmada', 'foto_elementos_url',
    'tipo_movimiento', 'elementos_trasladados', 'lat', 'lng',
  ],
};
var NUMERIC = { id: 1, driver_id: 1, account_id: 1, project_id: 1, active: 1, last_lat: 1, last_lng: 1, lat: 1, lng: 1 };

// ====== ENTRADAS HTTP ======
function doGet() {
  return json({ ok: true, service: 'Ruteo TT Audit API', time: new Date().toISOString() });
}

function doPost(e) {
  try {
    var env = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    return json({ ok: true, data: handle(env) });
  } catch (err) {
    var status = err && err.status ? err.status : 500;
    return json({ ok: false, status: status, error: (err && err.message) || 'Error interno' });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function apiError(status, message) {
  var e = new Error(message);
  e.status = status;
  return e;
}

// ====== ROUTER ======
function handle(env) {
  var path = env.path || '';
  var method = (env.method || 'GET').toUpperCase();
  var body = env.body || {};
  var query = env.query || {};
  var token = env.token || '';

  // Publico
  if (path === '/health') return { ok: true, time: new Date().toISOString() };
  if (path === '/auth/login' && method === 'POST') return login(body);
  if (path === '/auth/google' && method === 'POST') return googleLogin(body);

  // De aqui en adelante requiere sesion
  var user = requireAuth(token);
  var seg = path.split('/').filter(function (s) { return s !== ''; });

  if (seg[0] === 'drivers') {
    if (seg.length === 1 && method === 'GET') {
      var ds = readAll('drivers').filter(function (d) { return d.active !== 0; });
      ds.sort(byName);
      return ds;
    }
    if (seg.length === 1 && method === 'POST') { requireRole(user, ['admin']); return createDriver(body); }
    if (seg.length === 2 && method === 'PUT') { requireRole(user, ['admin']); return updateDriver(seg[1], body); }
  }

  if (seg[0] === 'accounts') {
    if (seg.length === 1 && method === 'GET') { var as = readAll('accounts'); as.sort(byName); return as; }
    if (seg.length === 1 && method === 'POST') {
      requireRole(user, ['admin']);
      if (!body.name) throw apiError(400, 'Nombre requerido');
      return append('accounts', { name: body.name });
    }
  }

  if (seg[0] === 'projects') {
    if (seg.length === 1 && method === 'GET') {
      var ps = readAll('projects');
      if (query.account_id) ps = ps.filter(function (p) { return String(p.account_id) === String(query.account_id); });
      ps.sort(byName);
      return ps;
    }
    if (seg.length === 1 && method === 'POST') {
      requireRole(user, ['admin', 'cuenta']);
      if (!body.name || !body.account_id) throw apiError(400, 'Nombre y cuenta requeridos');
      return append('projects', { name: body.name, account_id: body.account_id });
    }
  }

  if (seg[0] === 'users') {
    requireRole(user, ['admin']);
    if (seg.length === 1 && method === 'GET') return listUsers();
    if (seg.length === 2 && method === 'PUT') return updateUserLink(seg[1], body);
  }

  // Ubicacion en tiempo real
  if (path === '/location' && method === 'POST') { requireRole(user, ['chofer']); return saveLocation(user, body); }
  if (path === '/locations' && method === 'GET') { requireRole(user, ['admin', 'cuenta']); return listLocations(); }

  if (seg[0] === 'routes') {
    if (seg.length === 1 && method === 'GET') return getRoutes(user, query);
    if (seg.length === 1 && method === 'POST') { requireRole(user, ['admin']); return createRoute(user, body); }
    if (seg.length === 2 && seg[1] === 'bulk' && method === 'POST') { requireRole(user, ['admin']); return bulkRoutes(user, body); }
    if (seg.length === 2 && seg[1] === 'viaje' && method === 'POST') { requireRole(user, ['admin']); return createViaje(user, body); }
    if (seg.length === 2 && method === 'GET') return getRouteById(user, seg[1]);
    if (seg.length === 2 && method === 'PUT') { requireRole(user, ['admin']); return updateRoute(seg[1], body); }
    if (seg.length === 2 && method === 'DELETE') { requireRole(user, ['admin']); deleteById('routes', seg[1]); return { ok: true }; }
    if (seg.length === 3 && method === 'POST') {
      requireRole(user, ['chofer']);
      var action = seg[2];
      if (action === 'salida') return choferSalida(user, seg[1], body);
      if (action === 'llegada') return choferLlegada(user, seg[1], body);
      if (action === 'comentario') return choferComentario(user, seg[1], body);
      if (action === 'no-realizada') return choferNoRealizada(user, seg[1], body);
      if (action === 'entrega') return choferEntrega(user, seg[1], body);
      if (action === 'foto-elementos') return choferFotoElementos(user, seg[1], body);
      if (action === 'guia') return choferGuia(user, seg[1], body);
    }
  }

  throw apiError(404, 'Ruta no encontrada: ' + method + ' ' + path);
}

function byName(a, b) { return String(a.name).localeCompare(String(b.name)); }

// ====== AUTENTICACION ======
function login(body) {
  var email = String(body.email || '').trim().toLowerCase();
  var password = body.password || '';
  if (!email || !password) throw apiError(400, 'Email y contrasena requeridos');
  var user = readAll('users').find(function (u) { return String(u.email).trim().toLowerCase() === email; });
  if (!user || !verifyPassword(password, String(user.password_hash))) {
    throw apiError(401, 'Credenciales invalidas');
  }
  var payload = {
    id: user.id, email: user.email, name: user.name, role: user.role,
    driver_id: user.driver_id, account_id: user.account_id,
  };
  return { token: signToken(payload), user: payload };
}

// Inicio de sesion con Google (personal TT Audit). Recibe el ID token que emite
// "Iniciar sesion con Google" en el frontend, lo valida contra Google y, si el
// correo esta autorizado en la pestana "users", emite la sesion.
function googleLogin(body) {
  var idToken = body.id_token || body.credential || '';
  if (!idToken) throw apiError(400, 'Falta el token de Google');
  if (!CONFIG.GOOGLE_CLIENT_ID) throw apiError(500, 'Falta configurar GOOGLE_CLIENT_ID en el backend');

  var resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
  var info;
  try { info = JSON.parse(resp.getContentText()); } catch (e) { info = null; }
  if (!info || info.error || resp.getResponseCode() !== 200) throw apiError(401, 'Token de Google invalido');
  if (String(info.aud) !== String(CONFIG.GOOGLE_CLIENT_ID)) throw apiError(401, 'Token de Google no valido para esta app');
  if (String(info.email_verified) !== 'true') throw apiError(401, 'Correo de Google no verificado');

  var email = String(info.email || '').trim().toLowerCase();
  var user = readAll('users').find(function (u) { return String(u.email).trim().toLowerCase() === email; });
  if (!user) throw apiError(403, 'Tu correo (' + email + ') no esta autorizado. Contacta al administrador.');

  var payload = {
    id: user.id, email: user.email, name: user.name || info.name || email, role: user.role,
    driver_id: user.driver_id, account_id: user.account_id,
  };
  return { token: signToken(payload), user: payload };
}

function requireAuth(token) {
  var u = verifyToken(token);
  if (!u) throw apiError(401, 'No autenticado');
  return u;
}

function requireRole(user, roles) {
  if (roles.indexOf(user.role) === -1) throw apiError(403, 'No tienes permisos para esta accion');
}

function hashPassword(pw) {
  var salt = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  return 'sha256$' + salt + '$' + sha256(salt + pw);
}

function verifyPassword(pw, stored) {
  var parts = String(stored).split('$');
  if (parts.length === 3 && parts[0] === 'sha256') return sha256(parts[1] + pw) === parts[2];
  return stored === pw; // compatibilidad si alguien pone la clave en texto plano
}

function sha256(s) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return raw.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function signToken(payload) {
  var body = Object.assign({}, payload, { exp: new Date().getTime() + CONFIG.TOKEN_DAYS * 86400000 });
  var p = b64(JSON.stringify(body));
  return p + '.' + hmac(p);
}

function verifyToken(token) {
  var parts = String(token).split('.');
  if (parts.length !== 2) return null;
  if (hmac(parts[0]) !== parts[1]) return null;
  var body;
  try { body = JSON.parse(unb64(parts[0])); } catch (e) { return null; }
  if (!body.exp || new Date().getTime() > body.exp) return null;
  return body;
}

function hmac(s) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(s, CONFIG.JWT_SECRET));
}
function b64(s) { return Utilities.base64EncodeWebSafe(Utilities.newBlob(s).getBytes()); }
function unb64(s) { return Utilities.newBlob(Utilities.base64DecodeWebSafe(s)).getDataAsString(); }

// ====== ACCESO A LA HOJA ======
function book() {
  return CONFIG.SHEET_ID ? SpreadsheetApp.openById(CONFIG.SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}
function sheet(tab) {
  var sh = book().getSheetByName(tab);
  if (!sh) throw apiError(500, 'Falta la pestana "' + tab + '". Ejecuta setup() primero.');
  return sh;
}
function tz() { return book().getSpreadsheetTimeZone(); }

function coerce(field, value) {
  if (value instanceof Date) {
    if (field === 'date') return Utilities.formatDate(value, tz(), 'yyyy-MM-dd');
    if (field === 'hour' || field === 'hora_salida' || field === 'hora_llegada') return Utilities.formatDate(value, tz(), 'HH:mm');
    return Utilities.formatDate(value, tz(), "yyyy-MM-dd'T'HH:mm:ss");
  }
  if (value === '' || value === undefined || value === null) return NUMERIC[field] ? null : '';
  if (NUMERIC[field]) { var n = Number(value); return isNaN(n) ? value : n; }
  return value;
}

function rowToObj(tab, row) {
  var cols = SCHEMA[tab], o = {};
  for (var i = 0; i < cols.length; i++) o[cols[i]] = coerce(cols[i], row[i]);
  return o;
}
function objToRow(tab, obj) {
  return SCHEMA[tab].map(function (c) {
    var v = obj[c];
    return v === null || v === undefined ? '' : String(v);
  });
}

function readAll(tab) {
  var sh = sheet(tab);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var cols = SCHEMA[tab];
  var values = sh.getRange(2, 1, last - 1, cols.length).getValues();
  return values.map(function (r) { return rowToObj(tab, r); })
    .filter(function (o) { return o.id !== null && o.id !== ''; });
}

function nextId(tab) {
  return readAll(tab).reduce(function (m, r) { return Math.max(m, Number(r.id) || 0); }, 0) + 1;
}

function findRowNumber(tab, id) {
  var sh = sheet(tab), last = sh.getLastRow();
  if (last < 2) return null;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return null;
}

function setRow(sh, rowNum, arr) {
  var rng = sh.getRange(rowNum, 1, 1, arr.length);
  rng.setNumberFormat('@');
  rng.setValues([arr.map(String)]);
}

function append(tab, obj) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = sheet(tab);
    var id = obj.id != null ? obj.id : nextId(tab);
    var record = Object.assign({}, obj, { id: id });
    setRow(sh, Math.max(sh.getLastRow() + 1, 2), objToRow(tab, record));
    return rowToObj(tab, objToRow(tab, record));
  } finally { lock.releaseLock(); }
}

function getById(tab, id) {
  return readAll(tab).find(function (r) { return String(r.id) === String(id); }) || null;
}

function updateById(tab, id, patch) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var rowNum = findRowNumber(tab, id);
    if (rowNum === null) return null;
    var current = getById(tab, id);
    var merged = Object.assign({}, current, patch, { id: current.id });
    setRow(sheet(tab), rowNum, objToRow(tab, merged));
    return rowToObj(tab, objToRow(tab, merged));
  } finally { lock.releaseLock(); }
}

function deleteById(tab, id) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var rowNum = findRowNumber(tab, id);
    if (rowNum === null) return false;
    sheet(tab).deleteRow(rowNum);
    return true;
  } finally { lock.releaseLock(); }
}

// ====== NEGOCIO ======
function loadCatalogs() {
  return { drivers: readAll('drivers'), accounts: readAll('accounts'), projects: readAll('projects') };
}

function enrichRoutes(routes, c) {
  var dById = {}, aById = {}, pById = {};
  c.drivers.forEach(function (d) { dById[Number(d.id)] = d; });
  c.accounts.forEach(function (a) { aById[Number(a.id)] = a; });
  c.projects.forEach(function (p) { pById[Number(p.id)] = p; });
  return routes.map(function (r) {
    var d = dById[Number(r.driver_id)], a = aById[Number(r.account_id)], p = r.project_id ? pById[Number(r.project_id)] : null;
    var o = Object.assign({}, r);
    o.driver_name = d ? d.name : null;
    o.vehicle = d ? d.vehicle : null;
    o.supervisor = d ? d.supervisor : null;
    o.account_name = a ? a.name : null;
    o.project_name = p ? p.name : null;
    return o;
  });
}
function enrichOne(route) { return route ? enrichRoutes([route], loadCatalogs())[0] : null; }

function createDriver(b) {
  if (!b.name) throw apiError(400, 'Nombre requerido');
  return append('drivers', { name: b.name, phone: b.phone || '', vehicle: b.vehicle || '', supervisor: b.supervisor || '', active: 1 });
}
function updateDriver(id, b) {
  var patch = { name: b.name, phone: b.phone || '', vehicle: b.vehicle || '', supervisor: b.supervisor || '', active: b.active === undefined ? 1 : b.active };
  var rec = updateById('drivers', id, patch);
  if (!rec) throw apiError(404, 'Chofer no encontrado');
  return rec;
}

// Usuarios (solo admin). Nunca se expone el password_hash.
function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, driver_id: u.driver_id, account_id: u.account_id };
}
function listUsers() {
  var users = readAll('users').map(publicUser);
  users.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
  return users;
}
// Solo permite cambiar el vinculo (driver_id / account_id) y el nombre. No toca
// email, rol ni contrasena.
function updateUserLink(id, b) {
  var patch = {};
  if (b.driver_id !== undefined) patch.driver_id = (b.driver_id === '' || b.driver_id === null) ? '' : b.driver_id;
  if (b.account_id !== undefined) patch.account_id = (b.account_id === '' || b.account_id === null) ? '' : b.account_id;
  if (b.name !== undefined && b.name !== '') patch.name = b.name;
  var rec = updateById('users', id, patch);
  if (!rec) throw apiError(404, 'Usuario no encontrado');
  return publicUser(rec);
}

// Ubicacion en tiempo real: el chofer guarda su posicion en su registro de chofer.
function saveLocation(user, b) {
  if (!user.driver_id) throw apiError(400, 'Tu usuario no tiene un chofer vinculado');
  if (b.lat === undefined || b.lat === null || b.lng === undefined || b.lng === null) throw apiError(400, 'Faltan coordenadas');
  updateById('drivers', user.driver_id, { last_lat: b.lat, last_lng: b.lng, last_loc_at: nowISO() });
  return { ok: true };
}
// Admin/responsables leen la ultima posicion de cada chofer activo.
function listLocations() {
  return readAll('drivers').filter(function (d) { return d.active !== 0; }).map(function (d) {
    return { driver_id: d.id, name: d.name, vehicle: d.vehicle, lat: d.last_lat, lng: d.last_lng, updated_at: d.last_loc_at };
  });
}

function scopeFilter(user, routes) {
  // Los choferes solo ven sus propias rutas. Admins y responsables de cuenta
  // (gestores internos) ven todas.
  if (user.role === 'chofer') return routes.filter(function (r) { return Number(r.driver_id) === Number(user.driver_id); });
  return routes;
}

function getRoutes(user, q) {
  var routes = scopeFilter(user, readAll('routes'));
  if (q.date) routes = routes.filter(function (r) { return r.date === q.date; });
  if (q.from && q.to) routes = routes.filter(function (r) { return r.date >= q.from && r.date <= q.to; });
  if (q.driver_id) routes = routes.filter(function (r) { return Number(r.driver_id) === Number(q.driver_id); });
  if (q.account_id) routes = routes.filter(function (r) { return Number(r.account_id) === Number(q.account_id); });
  routes.sort(function (a, b) { return (a.date + a.hour).localeCompare(b.date + b.hour); });
  return enrichRoutes(routes, loadCatalogs());
}

function getRouteById(user, id) {
  var route = getById('routes', id);
  if (!route) throw apiError(404, 'Ruta no encontrada');
  if (user.role === 'chofer' && Number(route.driver_id) !== Number(user.driver_id)) throw apiError(403, 'No autorizado');
  return enrichOne(route);
}

function createRoute(user, b) {
  if (!b.date || !b.hour || !b.driver_id || !b.account_id || !b.destino) {
    throw apiError(400, 'date, hour, driver_id, account_id y destino son requeridos');
  }
  var rec = append('routes', {
    date: b.date, hour: b.hour, driver_id: b.driver_id, account_id: b.account_id, project_id: b.project_id || null,
    destino: b.destino, motivo: b.motivo || '', status: 'pendiente', hora_salida: '', hora_llegada: '',
    comentario_chofer: '', motivo_no_realizada: '', guia_url: '', created_by: user.email, updated_at: nowISO(),
    cantidad_bultos: '', gr_firmada: '', foto_elementos_url: '',
    tipo_movimiento: b.tipo_movimiento || '', elementos_trasladados: b.elementos_trasladados || '',
    lat: b.lat || '', lng: b.lng || '',
  });
  return enrichOne(rec);
}

function updateRoute(id, b) {
  var ex = getById('routes', id);
  if (!ex) throw apiError(404, 'Ruta no encontrada');
  var patch = {
    date: def(b.date, ex.date), hour: def(b.hour, ex.hour), driver_id: def(b.driver_id, ex.driver_id),
    account_id: def(b.account_id, ex.account_id), project_id: def(b.project_id, ex.project_id),
    destino: def(b.destino, ex.destino), motivo: def(b.motivo, ex.motivo),
    tipo_movimiento: def(b.tipo_movimiento, ex.tipo_movimiento),
    elementos_trasladados: def(b.elementos_trasladados, ex.elementos_trasladados),
    lat: def(b.lat, ex.lat), lng: def(b.lng, ex.lng), updated_at: nowISO(),
  };
  return enrichOne(updateById('routes', id, patch));
}
function def(v, d) { return (v === undefined || v === null) ? d : v; }

function bulkRoutes(user, b) {
  if (!b.file || !b.file.dataBase64) throw apiError(400, 'Archivo CSV requerido');
  var csv = Utilities.newBlob(Utilities.base64Decode(b.file.dataBase64)).getDataAsString();
  var rows;
  try { rows = Utilities.parseCsv(csv); } catch (e) { throw apiError(400, 'No se pudo leer el CSV: ' + e.message); }
  if (!rows.length) return { created: 0, errors: ['CSV vacio'] };

  var header = rows[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var col = function (row, name) { var i = header.indexOf(name); return i === -1 ? '' : String(row[i]).trim(); };
  var cat = loadCatalogs();
  var findDriver = function (n) { return cat.drivers.find(function (d) { return String(d.name).toLowerCase() === String(n).toLowerCase(); }); };
  var findAccount = function (n) { return cat.accounts.find(function (a) { return String(a.name).toLowerCase() === String(n).toLowerCase(); }); };
  var findProject = function (n, acc) { return cat.projects.find(function (p) { return String(p.name).toLowerCase() === String(n).toLowerCase() && String(p.account_id) === String(acc); }); };

  var maxId = readAll('routes').reduce(function (m, r) { return Math.max(m, Number(r.id) || 0); }, 0);
  var toInsert = [], errors = [];
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    if (row.join('') === '') continue;
    var lineNo = i + 1;
    var date = col(row, 'date') || col(row, 'fecha');
    var hour = col(row, 'hour') || col(row, 'hora');
    var destino = col(row, 'destino');
    var motivo = col(row, 'motivo');
    var driverId = col(row, 'driver_id'), accountId = col(row, 'account_id'), projectId = col(row, 'project_id');
    if (!driverId && col(row, 'driver_name')) { var d = findDriver(col(row, 'driver_name')); driverId = d ? d.id : ''; }
    if (!accountId && col(row, 'account_name')) { var a = findAccount(col(row, 'account_name')); accountId = a ? a.id : ''; }
    if (!projectId && col(row, 'project_name') && accountId) { var p = findProject(col(row, 'project_name'), accountId); projectId = p ? p.id : ''; }
    if (!date || !hour || !destino || !driverId || !accountId) {
      errors.push('Fila ' + lineNo + ': faltan datos requeridos (date, hour, destino, chofer, cuenta)');
      continue;
    }
    toInsert.push({
      id: ++maxId, date: date, hour: hour, driver_id: driverId, account_id: accountId, project_id: projectId || null,
      destino: destino, motivo: motivo, status: 'pendiente', hora_salida: '', hora_llegada: '', comentario_chofer: '',
      motivo_no_realizada: '', guia_url: '', created_by: user.email, updated_at: nowISO(),
    });
  }
  if (toInsert.length) {
    var lock = LockService.getScriptLock(); lock.waitLock(30000);
    try {
      var sh = sheet('routes');
      var start = Math.max(sh.getLastRow() + 1, 2);
      var values = toInsert.map(function (o) { return objToRow('routes', o).map(String); });
      var rng = sh.getRange(start, 1, values.length, SCHEMA.routes.length);
      rng.setNumberFormat('@');
      rng.setValues(values);
    } finally { lock.releaseLock(); }
  }
  return { created: toInsert.length, errors: errors };
}

function ensureOwnRoute(user, id) {
  var route = getById('routes', id);
  if (!route) throw apiError(404, 'Ruta no encontrada');
  if (Number(route.driver_id) !== Number(user.driver_id)) throw apiError(403, 'No autorizado');
  return route;
}
function choferSalida(user, id, b) {
  ensureOwnRoute(user, id);
  return enrichOne(updateById('routes', id, { hora_salida: b.hora || hhmm(), status: 'en_curso', updated_at: nowISO() }));
}
function choferLlegada(user, id, b) {
  ensureOwnRoute(user, id);
  return enrichOne(updateById('routes', id, { hora_llegada: b.hora || hhmm(), status: 'completado', updated_at: nowISO() }));
}
function choferComentario(user, id, b) {
  ensureOwnRoute(user, id);
  return enrichOne(updateById('routes', id, { comentario_chofer: b.comentario || '', updated_at: nowISO() }));
}
function choferNoRealizada(user, id, b) {
  ensureOwnRoute(user, id);
  var m = (b.motivo || '').trim();
  if (!m) throw apiError(400, 'Debes indicar el motivo por el que no se realizo');
  return enrichOne(updateById('routes', id, { status: 'no_realizada', motivo_no_realizada: m, updated_at: nowISO() }));
}
function choferGuia(user, id, b) {
  ensureOwnRoute(user, id);
  if (!b.file || !b.file.dataBase64) throw apiError(400, 'Archivo requerido');
  var url = uploadGuia(b.file.dataBase64, b.file.name, b.file.mimeType);
  return enrichOne(updateById('routes', id, { guia_url: url, updated_at: nowISO() }));
}

// Datos de entrega: tipo de movimiento, elementos, bultos y firma de la GR.
function choferEntrega(user, id, b) {
  ensureOwnRoute(user, id);
  var patch = { updated_at: nowISO() };
  if (b.cantidad_bultos !== undefined) patch.cantidad_bultos = b.cantidad_bultos || '';
  if (b.gr_firmada !== undefined) patch.gr_firmada = b.gr_firmada || '';
  if (b.tipo_movimiento !== undefined) patch.tipo_movimiento = b.tipo_movimiento || '';
  if (b.elementos_trasladados !== undefined) patch.elementos_trasladados = b.elementos_trasladados || '';
  return enrichOne(updateById('routes', id, patch));
}

// Registrar viaje: el admin crea un viaje (ruta no programada) para un chofer.
function createViaje(user, b) {
  if (!b.driver_id) throw apiError(400, 'Selecciona el chofer del viaje');
  if (!b.destino) throw apiError(400, 'Indica el destino del viaje');
  var rec = append('routes', {
    date: b.date || todayISO(), hour: b.hour || hhmm(), driver_id: b.driver_id,
    account_id: b.account_id || '', project_id: b.project_id || '',
    destino: b.destino, motivo: b.motivo || '', status: 'pendiente',
    hora_salida: '', hora_llegada: '', comentario_chofer: '', motivo_no_realizada: '',
    guia_url: '', created_by: user.email, updated_at: nowISO(),
    cantidad_bultos: b.cantidad_bultos || '', gr_firmada: b.gr_firmada || '', foto_elementos_url: '',
    tipo_movimiento: b.tipo_movimiento || '', elementos_trasladados: b.elementos_trasladados || '',
    lat: b.lat || '', lng: b.lng || '',
  });
  return enrichOne(rec);
}

// Foto de los elementos entregados/recogidos (se sube a Drive, aparte de la guia).
function choferFotoElementos(user, id, b) {
  ensureOwnRoute(user, id);
  if (!b.file || !b.file.dataBase64) throw apiError(400, 'Archivo requerido');
  var url = uploadGuia(b.file.dataBase64, b.file.name, b.file.mimeType);
  return enrichOne(updateById('routes', id, { foto_elementos_url: url, updated_at: nowISO() }));
}

function uploadGuia(dataB64, name, mime) {
  var bytes = Utilities.base64Decode(dataB64);
  var safe = new Date().getTime() + '-' + String(name || 'guia').replace(/[^a-zA-Z0-9.\-_]/g, '_');
  var blob = Utilities.newBlob(bytes, mime || 'application/octet-stream', safe);
  var folder = CONFIG.DRIVE_FOLDER_ID ? DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID) : DriveApp.getRootFolder();
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return 'https://drive.google.com/file/d/' + file.getId() + '/view';
}

function nowISO() { return new Date().toISOString(); }
function hhmm() { return Utilities.formatDate(new Date(), tz(), 'HH:mm'); }
function todayISO() { return Utilities.formatDate(new Date(), tz(), 'yyyy-MM-dd'); }

// ====== SETUP / SEMILLA (ejecutar una vez desde el editor) ======
function setup() {
  var b = book();
  Object.keys(SCHEMA).forEach(function (tab) {
    var sh = b.getSheetByName(tab) || b.insertSheet(tab);
    var cols = SCHEMA[tab];
    sh.getRange(1, 1, Math.max(sh.getMaxRows(), 1), cols.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  seedIfEmpty();
  return 'Setup completo. Personal entra con Google; chofer cris@ttaudit.com / Cris';
}

// Aplica userDirectory() sobre la hoja aunque ya tenga datos: agrega los usuarios
// que falten (por correo) y actualiza nombre/rol/chofer de los existentes. Al
// chofer nuevo le crea su registro en "drivers" si no existe. No borra usuarios
// que ya no esten en la lista. Ejecutala desde el editor cuando cambies la lista.
function syncUsers() {
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var existing = readAll('users');
    var byEmail = {};
    existing.forEach(function (u) { byEmail[String(u.email).trim().toLowerCase()] = u; });
    var drivers = readAll('drivers');
    var driverByName = {};
    drivers.forEach(function (d) { driverByName[String(d.name).trim().toLowerCase()] = d; });

    var added = 0, updated = 0;
    userDirectory().forEach(function (u) {
      var email = String(u.email).trim().toLowerCase();
      var driverId = '';
      if (u.driver) {
        var dExist = driverByName[String(u.driver.name).trim().toLowerCase()];
        if (dExist) driverId = dExist.id;
        else {
          var created = append('drivers', { name: u.driver.name, phone: u.driver.phone || '', vehicle: u.driver.vehicle || '', supervisor: u.driver.supervisor || '', active: 1 });
          driverId = created.id;
          driverByName[String(u.driver.name).trim().toLowerCase()] = created;
        }
      }
      var current = byEmail[email];
      if (current) {
        var patch = { name: u.name, role: u.role, driver_id: driverId || current.driver_id || '' };
        if (u.password) patch.password_hash = hashPassword(u.password);
        updateById('users', current.id, patch);
        updated++;
      } else {
        append('users', {
          email: u.email, password_hash: u.password ? hashPassword(u.password) : '',
          name: u.name, role: u.role, driver_id: driverId, account_id: '',
        });
        added++;
      }
    });
    return 'Usuarios sincronizados. Agregados: ' + added + ', actualizados: ' + updated + '.';
  } finally { lock.releaseLock(); }
}

function seedIfEmpty() {
  if (readAll('users').length) return;
  var d = seedData();
  writeRows('drivers', d.drivers);
  writeRows('accounts', d.accounts);
  writeRows('projects', d.projects);
  writeRows('users', d.users);
  writeRows('routes', d.routes);
}

function writeRows(tab, objs) {
  if (!objs.length) return;
  var sh = sheet(tab);
  var start = Math.max(sh.getLastRow() + 1, 2);
  var values = objs.map(function (o) { return objToRow(tab, o).map(String); });
  var rng = sh.getRange(start, 1, values.length, SCHEMA[tab].length);
  rng.setNumberFormat('@');
  rng.setValues(values);
}

// Lista oficial de usuarios. Editala aqui y ejecuta syncUsers() para aplicarla
// aunque la hoja ya tenga datos (agrega los que falten y actualiza rol/chofer).
// - Admin y cuenta entran con Google (no necesitan contrasena).
// - Chofer entra con correo + contrasena.
function userDirectory() {
  return [
    // Admins (acceso total; Pamela asigna rutas)
    { email: 'ccamarena@ttaudit.com', name: 'Claudia Camarena', role: 'admin' },
    { email: 'logistica@palmera.pe', name: 'Pamela - Logistica', role: 'admin', password: 'Palmera2026' },
    { email: 'epezo@ttaudit.com', name: 'E. Pezo', role: 'admin' },
    { email: 'botero@ttaudit.com', name: 'Botero', role: 'admin' },
    { email: 'rgallo@ttaudit.com', name: 'R. Gallo', role: 'admin' },
    { email: 'operaciones@ttaudit.com', name: 'Operaciones TT Audit', role: 'admin' },
    // Responsables de cuenta (crean proyectos para todas las cuentas)
    { email: 'rpulido@ttaudit.com', name: 'R. Pulido', role: 'cuenta' },
    { email: 'dolaguibel@ttaudit.com', name: 'D. Olaguibel', role: 'cuenta' },
    { email: 'mcarhuallanqui@ttaudit.com', name: 'M. Carhuallanqui', role: 'cuenta' },
    { email: 'ghidalgo@ttaudit.com', name: 'G. Hidalgo', role: 'cuenta' },
    // Choferes (correo + contrasena)
    { email: 'cris@ttaudit.com', name: 'Cris', role: 'chofer', password: 'Cris', driver: { name: 'Cris', phone: '', vehicle: '', supervisor: 'Pamela' } },
  ];
}

// Cuentas oficiales. Ejecuta setupAccounts() desde el editor para cargarlas.
// Es idempotente: solo agrega las que falten (compara por nombre). No borra
// cuentas existentes. Los proyectos se crean aparte (varian por cuenta).
function accountDirectory() {
  return ['BAT', 'Alicorp', 'Ilko', 'Casa Europa', 'Edgwell', 'Arca Continental', 'Palmera'];
}

function setupAccounts() {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var existing = readAll('accounts');
    var have = {};
    existing.forEach(function (a) { have[String(a.name).trim().toLowerCase()] = true; });
    var added = 0;
    accountDirectory().forEach(function (name) {
      if (!have[name.trim().toLowerCase()]) { append('accounts', { name: name }); added++; }
    });
    return 'Cuentas cargadas. Agregadas: ' + added + '. Total ahora: ' + readAll('accounts').length + '.';
  } finally { lock.releaseLock(); }
}

function seedData() {
  var drivers = [
    { id: 1, name: 'Christian Herrera', phone: '999111222', vehicle: 'ABC-123', supervisor: 'Pamela', active: 1 },
    { id: 2, name: 'Luis Ramirez', phone: '999333444', vehicle: 'DEF-456', supervisor: 'Pamela', active: 1 },
    { id: 3, name: 'Jorge Salas', phone: '999555666', vehicle: 'GHI-789', supervisor: 'Miguel', active: 1 },
  ];
  var accounts = [{ id: 1, name: 'Alicorp' }, { id: 2, name: 'Backus' }];
  var projects = [
    { id: 1, name: 'Distribucion Lima Norte', account_id: 1 },
    { id: 2, name: 'Reposicion Tiendas SJL', account_id: 1 },
    { id: 3, name: 'Entrega Canal Moderno', account_id: 2 },
  ];

  // Usuarios reales (ver userDirectory). Al chofer se le crea su registro en drivers.
  var nextDriverId = drivers.reduce(function (m, d) { return Math.max(m, d.id); }, 0);
  var users = userDirectory().map(function (u, i) {
    var driverId = '';
    if (u.driver) {
      driverId = ++nextDriverId;
      drivers.push({ id: driverId, name: u.driver.name, phone: u.driver.phone || '', vehicle: u.driver.vehicle || '', supervisor: u.driver.supervisor || '', active: 1 });
    }
    return {
      id: i + 1, email: u.email, password_hash: u.password ? hashPassword(u.password) : '',
      name: u.name, role: u.role, driver_id: driverId, account_id: '',
    };
  });

  var today = new Date();
  var monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  var fmt = function (dt) { return Utilities.formatDate(dt, tz(), 'yyyy-MM-dd'); };
  var dateAt = function (off) { return fmt(new Date(monday.getTime() + off * 86400000)); };

  var sample = [
    [0, '08:00', 1, 1, 1, 'Almacen Chiclin', 'Carga inicial de pedidos', 'completado'],
    [0, '10:00', 1, 1, 2, 'Cliente Alicorp - SJL', 'Entrega de pedido #4521', 'completado'],
    [0, '09:00', 2, 2, 3, 'Tienda Backus - Surco', 'Reposicion de stock', 'en_curso'],
    [1, '08:00', 1, 1, 1, 'Almacen Chiclin', 'Recojo de mercaderia', 'pendiente'],
    [1, '11:00', 3, 2, 3, 'Tienda Backus - San Isidro', 'Entrega pedido #4530', 'pendiente'],
    [2, '08:00', 2, 1, 2, 'Cliente Alicorp - Los Olivos', 'Entrega de pedido #4540', 'pendiente'],
  ];
  var routes = sample.map(function (s, i) {
    return {
      id: i + 1, date: dateAt(s[0]), hour: s[1], driver_id: s[2], account_id: s[3], project_id: s[4],
      destino: s[5], motivo: s[6], status: s[7], hora_salida: '', hora_llegada: '', comentario_chofer: '',
      motivo_no_realizada: '', guia_url: '', created_by: 'seed', updated_at: nowISO(),
    };
  });

  return { drivers: drivers, accounts: accounts, projects: projects, users: users, routes: routes };
}
