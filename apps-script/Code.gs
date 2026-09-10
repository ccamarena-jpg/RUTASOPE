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
  drivers: ['id', 'name', 'phone', 'vehicle', 'supervisor', 'active', 'last_lat', 'last_lng', 'last_loc_at', 'es_proveedor'],
  accounts: ['id', 'name'],
  projects: ['id', 'name', 'account_id'],
  // Ubicacion en vivo, UNA fila por chofer (clave: driver_id). Vive aparte del
  // catalogo (drivers) para que las escrituras cada 60s NO ensucien el catalogo
  // ni invaliden su cache. La escribe saveLocation; la lee listLocations.
  driver_locations: ['driver_id', 'lat', 'lng', 'updated_at'],
  routes: [
    'id', 'date', 'hour', 'driver_id', 'account_id', 'project_id', 'destino', 'motivo',
    'status', 'hora_salida', 'hora_llegada', 'comentario_chofer', 'motivo_no_realizada',
    'guia_url', 'created_by', 'updated_at',
    'cantidad_bultos', 'gr_firmada', 'foto_elementos_url',
    'tipo_movimiento', 'elementos_trasladados', 'lat', 'lng', 'proyecto',
    'costo_transporte', 'costo_proveedor', 'hora_fin',
  ],
  // ====== FLOTA (unidades moviles) ======
  // Ficha de cada unidad movil. Las fechas *_venc son de vencimiento (proxima)
  // y alimentan el semaforo (vencido / por vencer / al dia) en el frontend.
  units: [
    'id', 'placa', 'marca', 'modelo', 'anio', 'driver_id', 'estado',
    'rev_tt_venc', 'mant_euro_venc', 'soat_venc', 'rtv_venc', 'poliza_venc',
    'tarjeta_propiedad', 'km_ultimo_mant', 'km_intervalo_mant', 'notas', 'updated_at',
  ],
  // Checklist de materiales obligatorios por unidad. tiene: 1/0. vencimiento:
  // opcional (extintor y botiquin caducan) y entra al semaforo.
  unit_materiales: ['id', 'unit_id', 'material', 'tiene', 'vencimiento', 'nota'],
  // Papeletas de transito por unidad.
  unit_papeletas: ['id', 'unit_id', 'fecha', 'papeleta_num', 'infraccion', 'monto', 'estado', 'driver_id', 'foto_url', 'created_by', 'created_at'],
  // Historial de kilometraje (lecturas de odometro).
  unit_km: ['id', 'unit_id', 'fecha', 'km', 'nota', 'created_by', 'created_at'],
  // Historial de mantenimiento por unidad (importado del taller). km_servicio =
  // km planeado del servicio (5000, 10000, ...). Solo lectura por ahora.
  unit_mantenimiento: ['id', 'unit_id', 'taller', 'km_ingreso', 'km_servicio', 'fecha_ingreso', 'fecha_salida', 'descripcion', 'created_at'],
};
var NUMERIC = { id: 1, driver_id: 1, account_id: 1, project_id: 1, active: 1, last_lat: 1, last_lng: 1, lat: 1, lng: 1, es_proveedor: 1, costo_transporte: 1, costo_proveedor: 1, unit_id: 1, anio: 1, km: 1, km_ultimo_mant: 1, km_intervalo_mant: 1, monto: 1, tiene: 1, km_ingreso: 1, km_servicio: 1 };

// Materiales obligatorios que se crean por defecto al registrar una unidad.
var DEFAULT_MATERIALES = ['Extintor', 'Botiquin', 'Cono de seguridad', 'Gata', 'Llanta de repuesto', 'Triangulos de seguridad', 'Chaleco reflectivo', 'Llave de ruedas'];

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
      var cachedD = cacheGetArr('cat_drivers');
      if (cachedD) return cachedD;
      var ds = readAll('drivers').filter(function (d) { return d.active !== 0; });
      ds.sort(byName);
      // El combo no usa last_lat/lng; la ubicacion en vivo va por /locations. Por
      // eso es seguro cachear esta lista aunque traiga posicion algo vieja.
      cachePutArr('cat_drivers', ds);
      return ds;
    }
    if (seg.length === 1 && method === 'POST') { requireRole(user, ['admin']); bustCache('cat_drivers'); return createDriver(body); }
    if (seg.length === 2 && method === 'PUT') { requireRole(user, ['admin']); bustCache('cat_drivers'); return updateDriver(seg[1], body); }
    if (seg.length === 2 && method === 'DELETE') { requireRole(user, ['admin']); deleteById('drivers', seg[1]); bustCache('cat_drivers'); return { ok: true }; }
  }

  if (seg[0] === 'accounts') {
    if (seg.length === 1 && method === 'GET') {
      var cachedA = cacheGetArr('cat_accounts');
      if (cachedA) return cachedA;
      var as = readAll('accounts'); as.sort(byName);
      cachePutArr('cat_accounts', as);
      return as;
    }
    if (seg.length === 1 && method === 'POST') {
      requireRole(user, ['admin']);
      if (!body.name) throw apiError(400, 'Nombre requerido');
      var newAccount = append('accounts', { name: body.name });
      bustCache('cat_accounts');
      return newAccount;
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

  // ====== FLOTA (unidades moviles) — solo admin ======
  if (seg[0] === 'units') {
    requireRole(user, ['admin']);
    if (seg.length === 1 && method === 'GET') return listUnits();
    if (seg.length === 1 && method === 'POST') return createUnit(user, body);
    if (seg.length === 2 && method === 'GET') return getUnitDetail(seg[1]);
    if (seg.length === 2 && method === 'PUT') return updateUnit(seg[1], body);
    if (seg.length === 2 && method === 'DELETE') { deleteUnit(seg[1]); return { ok: true }; }
    if (seg.length === 3 && method === 'POST') {
      if (seg[2] === 'materiales') return saveMateriales(seg[1], body);
      if (seg[2] === 'papeletas') return addPapeleta(user, seg[1], body);
      if (seg[2] === 'km') return addKm(user, seg[1], body);
    }
    if (seg.length === 4 && seg[2] === 'papeletas') {
      if (method === 'PUT') return updatePapeleta(seg[1], seg[3], body);
      if (method === 'DELETE') { deletePapeleta(seg[1], seg[3]); return { ok: true }; }
    }
    if (seg.length === 4 && seg[2] === 'km' && method === 'DELETE') { deleteKm(seg[1], seg[3]); return { ok: true }; }
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

// ---- Cache de catalogos (CacheService) ----
// El catalogo de choferes/cuentas se lee en cada carga del panel y del combo. El
// Sheet es lento e intermitente (cold start, contencion), asi que guardamos la
// ultima lista en memoria unos minutos: sale en milisegundos y un bache del Sheet
// deja de vaciar el combo. Se invalida (bustCache) al crear/editar/borrar. OJO: NO
// cachear /locations (ubicacion en vivo, cambia cada 60s) — usa readAll siempre.
var CATALOG_TTL = 120; // segundos
function cacheGetArr(key) {
  try { var s = CacheService.getScriptCache().get(key); return s ? JSON.parse(s) : null; } catch (e) { return null; }
}
function cachePutArr(key, arr) {
  try { CacheService.getScriptCache().put(key, JSON.stringify(arr), CATALOG_TTL); } catch (e) { /* >100KB o sin acceso */ }
}
function bustCache(key) {
  try { CacheService.getScriptCache().remove(key); } catch (e) { /* noop */ }
}

// Borra varias filas por id en UNA sola pasada, de abajo hacia arriba (para no
// recalcular indices). Reemplaza el patron caro de deleteById por cada fila hija,
// que hacia una lectura de columna + un deleteRow con lock POR CADA fila.
function deleteRowsByIds(tab, ids) {
  if (!ids || !ids.length) return 0;
  var wanted = {};
  ids.forEach(function (x) { wanted[String(x)] = true; });
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = sheet(tab), last = sh.getLastRow();
    if (last < 2) return 0;
    var idCol = sh.getRange(2, 1, last - 1, 1).getValues();
    var rows = [];
    for (var i = 0; i < idCol.length; i++) if (wanted[String(idCol[i][0])]) rows.push(i + 2);
    rows.sort(function (a, b) { return b - a; });
    for (var j = 0; j < rows.length; j++) sh.deleteRow(rows[j]);
    return rows.length;
  } finally { lock.releaseLock(); }
}

function nextId(tab) {
  // Solo la columna de IDs, no la hoja entera (antes hacia un readAll completo
  // en CADA creacion solo para sacar el maximo id).
  var sh = sheet(tab), last = sh.getLastRow();
  if (last < 2) return 1;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  var max = 0;
  for (var i = 0; i < ids.length; i++) { var n = Number(ids[i][0]) || 0; if (n > max) max = n; }
  return max + 1;
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
    var sh = sheet(tab);
    var rowNum = findRowNumber(tab, id); // lee solo la columna de IDs
    if (rowNum === null) return null;
    // Antes: getById() hacia un readAll COMPLETO de la tabla solo para traer esta
    // fila. Ahora leemos unicamente la fila objetivo. Clave para saveLocation, que
    // corre cada 60s por chofer sobre la tabla drivers.
    var cols = SCHEMA[tab];
    var current = rowToObj(tab, sh.getRange(rowNum, 1, 1, cols.length).getValues()[0]);
    var merged = Object.assign({}, current, patch, { id: current.id });
    setRow(sh, rowNum, objToRow(tab, merged));
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
    o.project_name = (r.proyecto && r.proyecto !== '') ? r.proyecto : (p ? p.name : null);
    return o;
  });
}
function enrichOne(route) { return route ? enrichRoutes([route], loadCatalogs())[0] : null; }

function createDriver(b) {
  if (!b.name) throw apiError(400, 'Nombre requerido');
  return append('drivers', { name: b.name, phone: b.phone || '', vehicle: b.vehicle || '', supervisor: b.supervisor || '', active: 1, es_proveedor: b.es_proveedor ? 1 : 0 });
}
function updateDriver(id, b) {
  var patch = { name: b.name, phone: b.phone || '', vehicle: b.vehicle || '', supervisor: b.supervisor || '', active: b.active === undefined ? 1 : b.active, es_proveedor: b.es_proveedor ? 1 : 0 };
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

// Ubicacion en tiempo real: se guarda en driver_locations (una fila por chofer),
// NO en el catalogo drivers. Asi la escritura cada 60s no toca el catalogo ni su
// cache. Upsert por driver_id: actualiza su fila o la crea si no existe.
function upsertLocation(driverId, lat, lng, updatedAt) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = sheet('driver_locations');
    var last = sh.getLastRow();
    var rowNum = null;
    if (last >= 2) {
      var ids = sh.getRange(2, 1, last - 1, 1).getValues(); // solo columna driver_id
      for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(driverId)) { rowNum = i + 2; break; }
    }
    var target = rowNum || Math.max(last + 1, 2);
    var rng = sh.getRange(target, 1, 1, SCHEMA.driver_locations.length);
    rng.setNumberFormat('@');
    rng.setValues([[String(driverId), String(lat), String(lng), updatedAt || nowISO()]]);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

function locationsByDriver() {
  var m = {};
  readAll('driver_locations').forEach(function (r) { m[String(r.driver_id)] = r; });
  return m;
}

function saveLocation(user, b) {
  if (!user.driver_id) throw apiError(400, 'Tu usuario no tiene un chofer vinculado');
  if (b.lat === undefined || b.lat === null || b.lng === undefined || b.lng === null) throw apiError(400, 'Faltan coordenadas');
  upsertLocation(user.driver_id, b.lat, b.lng);
  return { ok: true };
}
// Admin/responsables leen la ultima posicion de cada chofer activo. Cruza el
// catalogo (drivers) con la tabla de ubicaciones (driver_locations).
function listLocations() {
  var locs = locationsByDriver();
  return readAll('drivers').filter(function (d) { return d.active !== 0; }).map(function (d) {
    var l = locs[String(d.id)] || {};
    return {
      driver_id: d.id, name: d.name, vehicle: d.vehicle,
      lat: (l.lat === undefined ? '' : l.lat),
      lng: (l.lng === undefined ? '' : l.lng),
      updated_at: l.updated_at || '',
    };
  });
}

function scopeFilter(user, routes) {
  // Los choferes solo ven sus propias rutas. Admins y responsables de cuenta
  // (gestores internos) ven todas.
  if (user.role === 'chofer') return routes.filter(function (r) { return Number(r.driver_id) === Number(user.driver_id); });
  return routes;
}

// El costo es informacion interna: no se envia a los choferes.
function stripCostos(routes) {
  return routes.map(function (r) {
    var o = Object.assign({}, r);
    delete o.costo_transporte;
    delete o.costo_proveedor;
    return o;
  });
}

function getRoutes(user, q) {
  var routes = scopeFilter(user, readAll('routes'));
  // El chofer solo ve de hoy en adelante (no fechas pasadas).
  if (user.role === 'chofer') { var t = todayISO(); routes = routes.filter(function (r) { return r.date >= t; }); }
  if (q.date) routes = routes.filter(function (r) { return r.date === q.date; });
  if (q.from && q.to) routes = routes.filter(function (r) { return r.date >= q.from && r.date <= q.to; });
  if (q.driver_id) routes = routes.filter(function (r) { return Number(r.driver_id) === Number(q.driver_id); });
  if (q.account_id) routes = routes.filter(function (r) { return Number(r.account_id) === Number(q.account_id); });
  routes.sort(function (a, b) { return (a.date + a.hour).localeCompare(b.date + b.hour); });
  var enriched = enrichRoutes(routes, loadCatalogs());
  if (user.role === 'chofer') enriched = stripCostos(enriched);
  return enriched;
}

function getRouteById(user, id) {
  var route = getById('routes', id);
  if (!route) throw apiError(404, 'Ruta no encontrada');
  if (user.role === 'chofer' && Number(route.driver_id) !== Number(user.driver_id)) throw apiError(403, 'No autorizado');
  var one = enrichOne(route);
  return user.role === 'chofer' ? stripCostos([one])[0] : one;
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
    lat: b.lat || '', lng: b.lng || '', proyecto: b.proyecto || '',
    costo_transporte: b.costo_transporte || '', costo_proveedor: b.costo_proveedor || '',
    hora_fin: b.hora_fin || '',
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
    proyecto: def(b.proyecto, ex.proyecto),
    costo_transporte: def(b.costo_transporte, ex.costo_transporte),
    costo_proveedor: def(b.costo_proveedor, ex.costo_proveedor),
    hora_fin: def(b.hora_fin, ex.hora_fin),
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
  var route = ensureOwnRoute(user, id);
  // Evidencia obligatoria: debe haber foto de elementos o guia de remision.
  if ((!route.foto_elementos_url || route.foto_elementos_url === '') && (!route.guia_url || route.guia_url === '')) {
    throw apiError(400, 'Adjunta la foto de elementos o la guia de remision antes de marcar como completado.');
  }
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
    lat: b.lat || '', lng: b.lng || '', proyecto: b.proyecto || '',
    costo_transporte: b.costo_transporte || '', costo_proveedor: b.costo_proveedor || '',
    hora_fin: b.hora_fin || '',
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

// ====== FLOTA (unidades moviles) ======
// Ultimo kilometraje registrado para una unidad (max km del historial).
function unitKmActual(unitId) {
  var rows = readAll('unit_km').filter(function (k) { return String(k.unit_id) === String(unitId); });
  if (!rows.length) return '';
  return rows.reduce(function (m, k) { return Math.max(m, Number(k.km) || 0); }, 0);
}

// Agrega driver_name y km_actual a una unidad.
function enrichUnit(u, driversById) {
  var o = Object.assign({}, u);
  var d = u.driver_id ? driversById[Number(u.driver_id)] : null;
  o.driver_name = d ? d.name : null;
  o.km_actual = unitKmActual(u.id);
  // Proximo mantenimiento por km (si hay intervalo configurado).
  if (u.km_ultimo_mant !== '' && u.km_ultimo_mant != null && u.km_intervalo_mant) {
    o.km_proximo_mant = Number(u.km_ultimo_mant) + Number(u.km_intervalo_mant);
  } else {
    o.km_proximo_mant = '';
  }
  return o;
}

function listUnits() {
  var driversById = {};
  readAll('drivers').forEach(function (d) { driversById[Number(d.id)] = d; });
  var units = readAll('units').map(function (u) { return enrichUnit(u, driversById); });
  units.sort(function (a, b) { return String(a.placa).localeCompare(String(b.placa)); });
  return units;
}

function getUnitDetail(id) {
  var unit = getById('units', id);
  if (!unit) throw apiError(404, 'Unidad no encontrada');
  var driversById = {};
  readAll('drivers').forEach(function (d) { driversById[Number(d.id)] = d; });
  var materiales = readAll('unit_materiales').filter(function (m) { return String(m.unit_id) === String(id); });
  var papeletas = readAll('unit_papeletas').filter(function (p) { return String(p.unit_id) === String(id); });
  papeletas.forEach(function (p) { var d = p.driver_id ? driversById[Number(p.driver_id)] : null; p.driver_name = d ? d.name : null; });
  papeletas.sort(function (a, b) { return String(b.fecha).localeCompare(String(a.fecha)); });
  var km = readAll('unit_km').filter(function (k) { return String(k.unit_id) === String(id); });
  km.sort(function (a, b) { return String(b.fecha).localeCompare(String(a.fecha)); });
  var mantenimiento = readAll('unit_mantenimiento').filter(function (m) { return String(m.unit_id) === String(id); });
  mantenimiento.sort(function (a, b) { return String(b.fecha_ingreso).localeCompare(String(a.fecha_ingreso)); });
  return { unit: enrichUnit(unit, driversById), materiales: materiales, papeletas: papeletas, km: km, mantenimiento: mantenimiento };
}

function unitPatchFromBody(b, ex) {
  ex = ex || {};
  return {
    placa: def(b.placa, ex.placa || ''),
    marca: def(b.marca, ex.marca || ''),
    modelo: def(b.modelo, ex.modelo || ''),
    anio: def(b.anio, ex.anio || ''),
    driver_id: def(b.driver_id, ex.driver_id || ''),
    estado: def(b.estado, ex.estado || 'activa'),
    rev_tt_venc: def(b.rev_tt_venc, ex.rev_tt_venc || ''),
    mant_euro_venc: def(b.mant_euro_venc, ex.mant_euro_venc || ''),
    soat_venc: def(b.soat_venc, ex.soat_venc || ''),
    rtv_venc: def(b.rtv_venc, ex.rtv_venc || ''),
    poliza_venc: def(b.poliza_venc, ex.poliza_venc || ''),
    tarjeta_propiedad: def(b.tarjeta_propiedad, ex.tarjeta_propiedad || ''),
    km_ultimo_mant: def(b.km_ultimo_mant, ex.km_ultimo_mant || ''),
    km_intervalo_mant: def(b.km_intervalo_mant, ex.km_intervalo_mant || ''),
    notas: def(b.notas, ex.notas || ''),
    updated_at: nowISO(),
  };
}

function createUnit(user, b) {
  if (!b.placa) throw apiError(400, 'La placa es requerida');
  var rec = append('units', unitPatchFromBody(b, {}));
  // Sembrar el checklist de materiales obligatorios por defecto.
  DEFAULT_MATERIALES.forEach(function (name) {
    append('unit_materiales', { unit_id: rec.id, material: name, tiene: 1, vencimiento: '', nota: '' });
  });
  return getUnitDetail(rec.id);
}

function updateUnit(id, b) {
  var ex = getById('units', id);
  if (!ex) throw apiError(404, 'Unidad no encontrada');
  updateById('units', id, unitPatchFromBody(b, ex));
  return getUnitDetail(id);
}

function deleteUnit(id) {
  // Cascada: borra materiales, papeletas y kilometraje de la unidad. Antes hacia
  // un readAll completo + un deleteById (lectura de columna + deleteRow + lock) por
  // CADA fila hija — eso disparaba los timeouts. Ahora lee cada tabla una vez y
  // borra todas sus filas en un solo lote.
  var mats = readAll('unit_materiales').filter(function (m) { return String(m.unit_id) === String(id); }).map(function (m) { return m.id; });
  var paps = readAll('unit_papeletas').filter(function (p) { return String(p.unit_id) === String(id); }).map(function (p) { return p.id; });
  var kms = readAll('unit_km').filter(function (k) { return String(k.unit_id) === String(id); }).map(function (k) { return k.id; });
  var mants = readAll('unit_mantenimiento').filter(function (m) { return String(m.unit_id) === String(id); }).map(function (m) { return m.id; });
  deleteRowsByIds('unit_materiales', mats);
  deleteRowsByIds('unit_papeletas', paps);
  deleteRowsByIds('unit_km', kms);
  deleteRowsByIds('unit_mantenimiento', mants);
  deleteById('units', id);
  return true;
}

// Reemplaza todo el checklist de materiales de una unidad con la lista enviada.
function saveMateriales(unitId, b) {
  if (!getById('units', unitId)) throw apiError(404, 'Unidad no encontrada');
  var items = b.items || [];
  var oldIds = readAll('unit_materiales').filter(function (m) { return String(m.unit_id) === String(unitId); }).map(function (m) { return m.id; });
  deleteRowsByIds('unit_materiales', oldIds);
  items.forEach(function (it) {
    if (!it.material) return;
    append('unit_materiales', {
      unit_id: unitId, material: it.material,
      tiene: it.tiene ? 1 : 0, vencimiento: it.vencimiento || '', nota: it.nota || '',
    });
  });
  return getUnitDetail(unitId);
}

function addPapeleta(user, unitId, b) {
  if (!getById('units', unitId)) throw apiError(404, 'Unidad no encontrada');
  if (!b.fecha) throw apiError(400, 'La fecha de la papeleta es requerida');
  var fotoUrl = '';
  if (b.file && b.file.dataBase64) fotoUrl = uploadGuia(b.file.dataBase64, b.file.name, b.file.mimeType);
  append('unit_papeletas', {
    unit_id: unitId, fecha: b.fecha, papeleta_num: b.papeleta_num || '', infraccion: b.infraccion || '',
    monto: b.monto || '', estado: b.estado || 'pendiente', driver_id: b.driver_id || '',
    foto_url: fotoUrl, created_by: user.email, created_at: nowISO(),
  });
  return getUnitDetail(unitId);
}

function updatePapeleta(unitId, papeletaId, b) {
  var ex = getById('unit_papeletas', papeletaId);
  if (!ex || String(ex.unit_id) !== String(unitId)) throw apiError(404, 'Papeleta no encontrada');
  var patch = {};
  if (b.fecha !== undefined) patch.fecha = b.fecha;
  if (b.papeleta_num !== undefined) patch.papeleta_num = b.papeleta_num;
  if (b.infraccion !== undefined) patch.infraccion = b.infraccion;
  if (b.monto !== undefined) patch.monto = b.monto;
  if (b.estado !== undefined) patch.estado = b.estado;
  if (b.driver_id !== undefined) patch.driver_id = b.driver_id;
  if (b.file && b.file.dataBase64) patch.foto_url = uploadGuia(b.file.dataBase64, b.file.name, b.file.mimeType);
  updateById('unit_papeletas', papeletaId, patch);
  return getUnitDetail(unitId);
}

function deletePapeleta(unitId, papeletaId) {
  var ex = getById('unit_papeletas', papeletaId);
  if (!ex || String(ex.unit_id) !== String(unitId)) throw apiError(404, 'Papeleta no encontrada');
  deleteById('unit_papeletas', papeletaId);
  return true;
}

function addKm(user, unitId, b) {
  if (!getById('units', unitId)) throw apiError(404, 'Unidad no encontrada');
  if (b.km === undefined || b.km === null || b.km === '') throw apiError(400, 'Indica el kilometraje');
  append('unit_km', {
    unit_id: unitId, fecha: b.fecha || todayISO(), km: b.km, nota: b.nota || '',
    created_by: user.email, created_at: nowISO(),
  });
  return getUnitDetail(unitId);
}

function deleteKm(unitId, kmId) {
  var ex = getById('unit_km', kmId);
  if (!ex || String(ex.unit_id) !== String(unitId)) throw apiError(404, 'Registro de km no encontrado');
  deleteById('unit_km', kmId);
  return true;
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

// Migracion de una sola vez: copia la ultima ubicacion que hoy vive en el catalogo
// (drivers.last_lat/last_lng/last_loc_at) a la pestana nueva driver_locations, para
// que el mapa en vivo no quede en blanco tras separar la ubicacion. Corre setup()
// primero (crea la pestana) y luego esto. Es seguro re-ejecutarla (upsert por
// chofer). Despues de migrar, las columnas last_* de drivers quedan sin uso.
function migrateLocations() {
  var n = 0;
  readAll('drivers').forEach(function (d) {
    if (d.last_lat !== null && d.last_lat !== '' && d.last_lng !== null && d.last_lng !== '') {
      upsertLocation(d.id, d.last_lat, d.last_lng, d.last_loc_at || '');
      n++;
    }
  });
  return 'Ubicaciones migradas a driver_locations: ' + n;
}

// Carga inicial de la flota desde "Detalles de documentos.xlsx" (12 unidades),
// asignadas por numero de placa. Idempotente: salta las placas que ya existan, y
// a cada unidad nueva le siembra el checklist de materiales por defecto (igual que
// createUnit). Ejecutar UNA vez desde el editor. Mapeo: SOAT<-F.fin SOAT,
// Poliza<-F.Fin Poliza, Mant. Eurorenting<-F.Fin Contrato, Rev. tecnica MTC<-Permiso
// MTC Vigencia (solo APLICA); el resto (contrato/companias/permiso) va en notas.
function seedUnitsDocumentos() {
  var DATA = [
    {"placa": "CDD114", "marca": "TOYOTA", "modelo": "ETIOS 1.5", "soat_venc": "2027-01-06", "poliza_venc": "2026-08-31", "mant_euro_venc": "2028-01-18", "rtv_venc": "", "notas": "Contrato Eurorenting: 2023-01-18 a 2028-01-18. Poliza: RIMAC Todo riesgo. SOAT: RIMAC. Permiso MTC: NO APLICA."},
    {"placa": "CDC549", "marca": "TOYOTA", "modelo": "ETIOS 1.5", "soat_venc": "2027-01-06", "poliza_venc": "2026-08-31", "mant_euro_venc": "2028-01-18", "rtv_venc": "", "notas": "Contrato Eurorenting: 2023-01-18 a 2028-01-18. Poliza: RIMAC Todo riesgo. SOAT: RIMAC. Permiso MTC: NO APLICA."},
    {"placa": "BYW700", "marca": "CHEVROLET", "modelo": "N400", "soat_venc": "2027-04-02", "poliza_venc": "2026-08-31", "mant_euro_venc": "2027-05-02", "rtv_venc": "2027-04-25", "notas": "Contrato Eurorenting: 2024-05-02 a 2027-05-02. Poliza: RIMAC Todo riesgo. SOAT: RIMAC. Permiso MTC: APLICA."},
    {"placa": "BYW716", "marca": "CHEVROLET", "modelo": "N400", "soat_venc": "2027-04-02", "poliza_venc": "2026-08-31", "mant_euro_venc": "2027-05-02", "rtv_venc": "2027-04-25", "notas": "Contrato Eurorenting: 2024-05-02 a 2027-05-02. Poliza: RIMAC Todo riesgo. SOAT: RIMAC. Permiso MTC: APLICA."},
    {"placa": "BYW754", "marca": "CHEVROLET", "modelo": "N400", "soat_venc": "2027-04-02", "poliza_venc": "2026-08-31", "mant_euro_venc": "2027-05-04", "rtv_venc": "2027-04-25", "notas": "Contrato Eurorenting: 2024-05-04 a 2027-05-04. Poliza: RIMAC Todo riesgo. SOAT: RIMAC. Permiso MTC: APLICA."},
    {"placa": "CBU722", "marca": "CHEVROLET", "modelo": "N400 CARGO BASE", "soat_venc": "2026-12-12", "poliza_venc": "2026-08-31", "mant_euro_venc": "2026-09-03", "rtv_venc": "", "notas": "Contrato Eurorenting: 2026-07-30 a 2026-09-03. Poliza: RIMAC Todo riesgo. SOAT: RIMAC. Permiso MTC: NO APLICA."},
    {"placa": "CBT824", "marca": "CHEVROLET", "modelo": "N400 CARGO BASE", "soat_venc": "2026-12-12", "poliza_venc": "2026-08-31", "mant_euro_venc": "2026-09-21", "rtv_venc": "", "notas": "Contrato Eurorenting: 2026-03-02 a 2026-09-21. Poliza: RIMAC Todo riesgo. SOAT: RIMAC. Permiso MTC: NO APLICA."},
    {"placa": "CBZ888", "marca": "CHEVROLET", "modelo": "N400 CARGO", "soat_venc": "2027-01-02", "poliza_venc": "2026-08-31", "mant_euro_venc": "2028-01-14", "rtv_venc": "2028-02-01", "notas": "Contrato Eurorenting: 2025-01-14 a 2028-01-14. Poliza: RIMAC Todo riesgo. SOAT: RIMAC. Permiso MTC: APLICA."},
    {"placa": "CSC436", "marca": "VOLKSWAGEN", "modelo": "POLO HIGHLINE 1.6", "soat_venc": "2027-04-03", "poliza_venc": "2026-08-31", "mant_euro_venc": "2030-04-08", "rtv_venc": "", "notas": "Contrato Eurorenting: 2025-04-08 a 2030-04-08. Poliza: RIMAC Todo riesgo. SOAT: RIMAC. Permiso MTC: NO APLICA."},
    {"placa": "CFM760", "marca": "CHEVROLET", "modelo": "N400 MAX 1.5 CARGO FULL", "soat_venc": "2026-08-27", "poliza_venc": "2026-08-31", "mant_euro_venc": "2028-09-05", "rtv_venc": "", "notas": "Contrato Eurorenting: 2025-09-05 a 2028-09-05. Poliza: RIMAC Todo riesgo. SOAT: RIMAC. Permiso MTC: NO APLICA."},
    {"placa": "CFM856", "marca": "CHEVROLET", "modelo": "N400 MAX 1.5 CARGO FULL", "soat_venc": "2026-08-28", "poliza_venc": "2026-08-31", "mant_euro_venc": "2028-09-05", "rtv_venc": "", "notas": "Contrato Eurorenting: 2025-09-05 a 2028-09-05. Poliza: RIMAC Todo riesgo. SOAT: RIMAC. Permiso MTC: NO APLICA."},
    {"placa": "CFO709", "marca": "CHEVROLET", "modelo": "N400 MAX 1.5 CARGO FULL", "soat_venc": "2026-09-02", "poliza_venc": "2026-08-31", "mant_euro_venc": "2028-09-05", "rtv_venc": "", "notas": "Contrato Eurorenting: 2025-09-05 a 2028-09-05. Poliza: RIMAC Todo riesgo. SOAT: RIMAC. Permiso MTC: NO APLICA."}
  ];
  var existing = {};
  readAll('units').forEach(function (u) { existing[String(u.placa).trim().toUpperCase()] = true; });
  var added = 0, skipped = 0;
  DATA.forEach(function (row) {
    var key = String(row.placa).trim().toUpperCase();
    if (existing[key]) { skipped++; return; }
    var rec = append('units', unitPatchFromBody(row, {}));
    DEFAULT_MATERIALES.forEach(function (name) {
      append('unit_materiales', { unit_id: rec.id, material: name, tiene: 1, vencimiento: '', nota: '' });
    });
    existing[key] = true;
    added++;
  });
  return 'Unidades cargadas. Agregadas: ' + added + '. Ya existian (saltadas): ' + skipped + '. Total ahora: ' + readAll('units').length + '.';
}

// Carga el historial de mantenimiento (importado del taller) en unit_mantenimiento,
// cruzando por placa con las unidades en base. Idempotente: salta duplicados
// (misma unidad + fecha_ingreso + km_ingreso) y placas sin unidad. Escritura en
// lote (una sola setValues). Ejecutar UNA vez desde el editor.
function seedMantenimiento() {
  // Placa(s) a excluir de la carga.
  var EXCLUIR = { 'CSC436': 1 };
  var DATA = [
    {"placa": "BYW700", "taller": "GACSA PERÚ S.A.C.", "km_ingreso": 6060, "km_servicio": 5000, "fecha_ingreso": "2024-08-07", "fecha_salida": "2024-08-07", "descripcion": "Servicio MP de 5000 km"},
    {"placa": "BYW700", "taller": "GACSA PERÚ S.A.C.", "km_ingreso": 10526, "km_servicio": 10000, "fecha_ingreso": "2024-11-09", "fecha_salida": "2024-11-09", "descripcion": "MP 10000"},
    {"placa": "BYW700", "taller": "GACSA PERÚ S.A.C.", "km_ingreso": 18463, "km_servicio": 15000, "fecha_ingreso": "2025-02-03", "fecha_salida": "2025-02-03", "descripcion": "MANTTO PREVENTIVO 15K"},
    {"placa": "BYW700", "taller": "GACSA PERÚ S.A.C.", "km_ingreso": 23940, "km_servicio": 20000, "fecha_ingreso": "2025-04-08", "fecha_salida": "2025-04-08", "descripcion": "Servicio MP de 20000 km"},
    {"placa": "BYW700", "taller": "RENTING S.A.C.", "km_ingreso": 29311, "km_servicio": 30000, "fecha_ingreso": "2025-06-20", "fecha_salida": "2025-06-20", "descripcion": ""},
    {"placa": "BYW700", "taller": "RENTING S.A.C.", "km_ingreso": 34772, "km_servicio": 35000, "fecha_ingreso": "2025-09-03", "fecha_salida": "2025-09-03", "descripcion": ""},
    {"placa": "BYW700", "taller": "RENTING S.A.C.", "km_ingreso": 40638, "km_servicio": 40000, "fecha_ingreso": "2025-11-13", "fecha_salida": "2025-11-14", "descripcion": ""},
    {"placa": "BYW700", "taller": "RENTING S.A.C.", "km_ingreso": 46809, "km_servicio": 45000, "fecha_ingreso": "2026-02-03", "fecha_salida": "2026-02-03", "descripcion": ""},
    {"placa": "BYW700", "taller": "RENTING S.A.C.", "km_ingreso": 52534, "km_servicio": 50000, "fecha_ingreso": "2026-04-13", "fecha_salida": "2026-04-13", "descripcion": ""},
    {"placa": "BYW700", "taller": "RENTING S.A.C.", "km_ingreso": 57914, "km_servicio": 55000, "fecha_ingreso": "2026-07-01", "fecha_salida": "2026-07-02", "descripcion": ""},
    {"placa": "BYW716", "taller": "GACSA PERÚ S.A.C.", "km_ingreso": 6041, "km_servicio": 5000, "fecha_ingreso": "2024-07-25", "fecha_salida": "2024-07-25", "descripcion": "Servicio MP de 5000 km"},
    {"placa": "BYW716", "taller": "GACSA PERÚ S.A.C.", "km_ingreso": 11200, "km_servicio": 10000, "fecha_ingreso": "2024-10-02", "fecha_salida": "2024-10-02", "descripcion": "Servicio MP de 10000 km"},
    {"placa": "BYW716", "taller": "GACSA PERÚ S.A.C.", "km_ingreso": 16123, "km_servicio": 15000, "fecha_ingreso": "2024-11-23", "fecha_salida": "2024-11-23", "descripcion": "MP 15000"},
    {"placa": "BYW716", "taller": "GACSA PERÚ S.A.C.", "km_ingreso": 24442, "km_servicio": 25000, "fecha_ingreso": "2025-02-24", "fecha_salida": "2025-02-24", "descripcion": "SERVICIO MP 25000"},
    {"placa": "BYW716", "taller": "RENTING S.A.C.", "km_ingreso": 29853, "km_servicio": 30000, "fecha_ingreso": "2025-04-14", "fecha_salida": "2025-04-14", "descripcion": ""},
    {"placa": "BYW716", "taller": "RENTING S.A.C.", "km_ingreso": 35929, "km_servicio": 35000, "fecha_ingreso": "2025-07-03", "fecha_salida": "2025-07-03", "descripcion": ""},
    {"placa": "BYW716", "taller": "RENTING S.A.C.", "km_ingreso": 41789, "km_servicio": 40000, "fecha_ingreso": "2025-09-04", "fecha_salida": "2025-09-04", "descripcion": ""},
    {"placa": "BYW716", "taller": "RENTING S.A.C.", "km_ingreso": 47806, "km_servicio": 45000, "fecha_ingreso": "2025-11-14", "fecha_salida": "2025-11-17", "descripcion": ""},
    {"placa": "BYW716", "taller": "RENTING S.A.C.", "km_ingreso": 53587, "km_servicio": 50000, "fecha_ingreso": "2026-01-30", "fecha_salida": "2026-02-02", "descripcion": ""},
    {"placa": "BYW716", "taller": "RENTING S.A.C.", "km_ingreso": 58637, "km_servicio": 55000, "fecha_ingreso": "2026-04-10", "fecha_salida": "2026-04-10", "descripcion": ""},
    {"placa": "BYW716", "taller": "RENTING S.A.C.", "km_ingreso": 63397, "km_servicio": 60000, "fecha_ingreso": "2026-07-02", "fecha_salida": "2026-07-02", "descripcion": ""},
    {"placa": "BYW754", "taller": "GACSA PERÚ S.A.C.", "km_ingreso": 5488, "km_servicio": 5000, "fecha_ingreso": "2024-07-22", "fecha_salida": "2024-07-22", "descripcion": "Servicio MP de 5000 km"},
    {"placa": "BYW754", "taller": "GACSA PERÚ S.A.C.", "km_ingreso": 10547, "km_servicio": 10000, "fecha_ingreso": "2024-11-18", "fecha_salida": "2024-11-18", "descripcion": "MP 10000"},
    {"placa": "BYW754", "taller": "GACSA PERÚ S.A.C.", "km_ingreso": 16272, "km_servicio": 15000, "fecha_ingreso": "2025-04-22", "fecha_salida": "2025-04-22", "descripcion": "Servicio MP de 15000 km"},
    {"placa": "BYW754", "taller": "GACSA PERÚ S.A.C.", "km_ingreso": 21918, "km_servicio": 20000, "fecha_ingreso": "2025-06-23", "fecha_salida": "2025-06-24", "descripcion": "Servicio MP de 20000 km"},
    {"placa": "BYW754", "taller": "RENTING S.A.C.", "km_ingreso": 27574, "km_servicio": 25000, "fecha_ingreso": "2025-08-08", "fecha_salida": "2025-08-08", "descripcion": ""},
    {"placa": "BYW754", "taller": "RENTING S.A.C.", "km_ingreso": 33133, "km_servicio": 30000, "fecha_ingreso": "2025-12-16", "fecha_salida": "2025-12-17", "descripcion": ""},
    {"placa": "BYW754", "taller": "RENTING S.A.C.", "km_ingreso": 38728, "km_servicio": 35000, "fecha_ingreso": "2026-02-02", "fecha_salida": "2026-02-03", "descripcion": ""},
    {"placa": "BYW754", "taller": "RENTING S.A.C.", "km_ingreso": 44028, "km_servicio": 40000, "fecha_ingreso": "2026-03-25", "fecha_salida": "2026-03-25", "descripcion": ""},
    {"placa": "BYW754", "taller": "RENTING S.A.C.", "km_ingreso": 49271, "km_servicio": 50000, "fecha_ingreso": "2026-05-22", "fecha_salida": "2026-05-23", "descripcion": ""},
    {"placa": "CBT824", "taller": "AUTONIZA S.A.C", "km_ingreso": 6415, "km_servicio": 5000, "fecha_ingreso": "2025-07-15", "fecha_salida": "2025-07-16", "descripcion": "Servicio MP de 5000 km"},
    {"placa": "CBT824", "taller": "AUTONIZA S.A.C", "km_ingreso": 13407, "km_servicio": 10000, "fecha_ingreso": "2025-09-18", "fecha_salida": "2025-09-18", "descripcion": "Servicio MP de 10000 km"},
    {"placa": "CBT824", "taller": "SUR MOTRIZ SOCIEDAD COMERCIALDE RESPONSABILIDAD LIMITADA- SURMOTRIZS.R.L.", "km_ingreso": 24121, "km_servicio": 25000, "fecha_ingreso": "2026-01-12", "fecha_salida": "2026-01-12", "descripcion": "Servicio MP de 25000 km"},
    {"placa": "CBT824", "taller": "RENTING S.A.C.", "km_ingreso": 29891, "km_servicio": 30000, "fecha_ingreso": "2026-03-05", "fecha_salida": "", "descripcion": "Servicio de 30000 Km"},
    {"placa": "CBU722", "taller": "GACSA PERÚ S.A.C.", "km_ingreso": 8341, "km_servicio": 5000, "fecha_ingreso": "2025-04-04", "fecha_salida": "2025-04-04", "descripcion": "Servicio MP de 5000 km"},
    {"placa": "CBU722", "taller": "AUTONIZA S.A.C", "km_ingreso": 15117, "km_servicio": 10000, "fecha_ingreso": "2025-07-04", "fecha_salida": "2025-07-04", "descripcion": "Servicio MP de 10000 km"},
    {"placa": "CBU722", "taller": "AUTONIZA S.A.C", "km_ingreso": 15117, "km_servicio": 15117, "fecha_ingreso": "2025-07-04", "fecha_salida": "2025-07-04", "descripcion": "Unidad presenta pastillas delanteras gastadas Cliente asume el cambio"},
    {"placa": "CBU722", "taller": "RENTING S.A.C.", "km_ingreso": 21139, "km_servicio": 20000, "fecha_ingreso": "2025-11-24", "fecha_salida": "2025-11-25", "descripcion": ""},
    {"placa": "CBU722", "taller": "RENTING S.A.C.", "km_ingreso": 27491, "km_servicio": 25000, "fecha_ingreso": "2026-02-05", "fecha_salida": "2026-02-09", "descripcion": ""},
    {"placa": "CBU722", "taller": "RENTING S.A.C.", "km_ingreso": 42269, "km_servicio": 40000, "fecha_ingreso": "2026-06-18", "fecha_salida": "2026-06-18", "descripcion": ""},
    {"placa": "CBZ888", "taller": "AUTONIZA S.A.C", "km_ingreso": 5334, "km_servicio": 5000, "fecha_ingreso": "2025-03-25", "fecha_salida": "2025-03-25", "descripcion": "Servicio MP de 5000 km"},
    {"placa": "CBZ888", "taller": "GACSA PERÚ S.A.C.", "km_ingreso": 10846, "km_servicio": 10000, "fecha_ingreso": "2025-06-10", "fecha_salida": "2025-06-10", "descripcion": "Servicio MP de 10000 km"},
    {"placa": "CBZ888", "taller": "GACSA PERÚ S.A.C.", "km_ingreso": 15547, "km_servicio": 15000, "fecha_ingreso": "2025-08-08", "fecha_salida": "2025-08-08", "descripcion": "Servicio MP de 15000 km"},
    {"placa": "CBZ888", "taller": "RENTING S.A.C.", "km_ingreso": 21677, "km_servicio": 20000, "fecha_ingreso": "2025-11-06", "fecha_salida": "2025-11-07", "descripcion": ""},
    {"placa": "CBZ888", "taller": "RENTING S.A.C.", "km_ingreso": 27068, "km_servicio": 25000, "fecha_ingreso": "2026-01-20", "fecha_salida": "2026-01-21", "descripcion": ""},
    {"placa": "CBZ888", "taller": "RENTING S.A.C.", "km_ingreso": 32893, "km_servicio": 30000, "fecha_ingreso": "2026-03-23", "fecha_salida": "2026-03-24", "descripcion": ""},
    {"placa": "CBZ888", "taller": "RENTING S.A.C.", "km_ingreso": 38088, "km_servicio": 35000, "fecha_ingreso": "2026-06-04", "fecha_salida": "2026-06-05", "descripcion": ""},
    {"placa": "CDC549", "taller": "GRUPO PANA S.A.", "km_ingreso": 5631, "km_servicio": 5000, "fecha_ingreso": "2023-04-15", "fecha_salida": "2023-04-15", "descripcion": "MANTENIMIENTO PREVENTIVO"},
    {"placa": "CDC549", "taller": "GRUPO PANA S.A.", "km_ingreso": 5432, "km_servicio": 5000, "fecha_ingreso": "2023-05-27", "fecha_salida": "2023-05-27", "descripcion": "MANTENIMIENTO PREVENTIVO"},
    {"placa": "CDC549", "taller": "GRUPO PANA S.A.", "km_ingreso": 15999, "km_servicio": 15000, "fecha_ingreso": "2023-07-22", "fecha_salida": "2023-07-22", "descripcion": "MANTENIMIENTO PREVENTIVO"},
    {"placa": "CDC549", "taller": "GRUPO PANA S.A.", "km_ingreso": 20783, "km_servicio": 20000, "fecha_ingreso": "2023-09-26", "fecha_salida": "2023-09-26", "descripcion": "Servicio MP de 20000 km"},
    {"placa": "CDC549", "taller": "GRUPO PANA S.A.", "km_ingreso": 26243, "km_servicio": 25000, "fecha_ingreso": "2023-11-13", "fecha_salida": "2023-11-13", "descripcion": "Servicio MP de 25000 km"},
    {"placa": "CDC549", "taller": "RENTING S.A.C.", "km_ingreso": 31108, "km_servicio": 30000, "fecha_ingreso": "2024-01-13", "fecha_salida": "2024-01-15", "descripcion": ""},
    {"placa": "CDC549", "taller": "RENTING S.A.C.", "km_ingreso": 36064, "km_servicio": 35000, "fecha_ingreso": "2024-04-08", "fecha_salida": "2024-04-10", "descripcion": ""},
    {"placa": "CDC549", "taller": "RENTING S.A.C.", "km_ingreso": 39711, "km_servicio": 40000, "fecha_ingreso": "2024-05-31", "fecha_salida": "2024-06-03", "descripcion": ""},
    {"placa": "CDC549", "taller": "RENTING S.A.C.", "km_ingreso": 45082, "km_servicio": 45000, "fecha_ingreso": "2024-08-15", "fecha_salida": "2024-08-19", "descripcion": ""},
    {"placa": "CDC549", "taller": "RENTING S.A.C.", "km_ingreso": 50016, "km_servicio": 50000, "fecha_ingreso": "2024-10-18", "fecha_salida": "2024-10-21", "descripcion": ""},
    {"placa": "CDC549", "taller": "RENTING S.A.C.", "km_ingreso": 55176, "km_servicio": 55000, "fecha_ingreso": "2025-01-03", "fecha_salida": "2025-01-07", "descripcion": ""},
    {"placa": "CDC549", "taller": "RENTING S.A.C.", "km_ingreso": 60245, "km_servicio": 60000, "fecha_ingreso": "2025-03-07", "fecha_salida": "2025-03-10", "descripcion": ""},
    {"placa": "CDC549", "taller": "RENTING S.A.C.", "km_ingreso": 65298, "km_servicio": 65000, "fecha_ingreso": "2025-05-16", "fecha_salida": "2025-05-19", "descripcion": ""},
    {"placa": "CDC549", "taller": "RENTING S.A.C.", "km_ingreso": 70380, "km_servicio": 70000, "fecha_ingreso": "2025-07-19", "fecha_salida": "2025-07-21", "descripcion": ""},
    {"placa": "CDC549", "taller": "RENTING S.A.C.", "km_ingreso": 75000, "km_servicio": 74714, "fecha_ingreso": "2025-09-19", "fecha_salida": "2025-09-19", "descripcion": ""},
    {"placa": "CDC549", "taller": "RENTING S.A.C.", "km_ingreso": 79974, "km_servicio": 80000, "fecha_ingreso": "2025-11-18", "fecha_salida": "2025-11-21", "descripcion": ""},
    {"placa": "CDC549", "taller": "RENTING S.A.C.", "km_ingreso": 86869, "km_servicio": 85000, "fecha_ingreso": "2026-02-13", "fecha_salida": "2026-02-16", "descripcion": ""},
    {"placa": "CDC549", "taller": "RENTING S.A.C.", "km_ingreso": 93713, "km_servicio": 90000, "fecha_ingreso": "2026-05-19", "fecha_salida": "2026-05-19", "descripcion": ""},
    {"placa": "CDC549", "taller": "RENTING S.A.C.", "km_ingreso": 99631, "km_servicio": 100000, "fecha_ingreso": "2026-07-27", "fecha_salida": "2026-07-27", "descripcion": ""},
    {"placa": "CDD114", "taller": "GRUPO PANA S.A.", "km_ingreso": 5096, "km_servicio": 5000, "fecha_ingreso": "2023-05-22", "fecha_salida": "2023-05-22", "descripcion": "MANTENIMIENTO PREVENTIVO"},
    {"placa": "CDD114", "taller": "GRUPO PANA S.A.", "km_ingreso": 10398, "km_servicio": 10000, "fecha_ingreso": "2023-08-16", "fecha_salida": "2023-08-16", "descripcion": "MANTENIMIENTO PREVENTIVO"},
    {"placa": "CDD114", "taller": "GRUPO PANA S.A.", "km_ingreso": 15600, "km_servicio": 15000, "fecha_ingreso": "2023-11-27", "fecha_salida": "2023-11-27", "descripcion": "Servicio MP de 15000 km"},
    {"placa": "CDD114", "taller": "RENTING S.A.C.", "km_ingreso": 21269, "km_servicio": 25000, "fecha_ingreso": "2024-02-15", "fecha_salida": "2024-02-15", "descripcion": ""},
    {"placa": "CDD114", "taller": "GRUPO PANA S.A.", "km_ingreso": 21027, "km_servicio": 20000, "fecha_ingreso": "2024-02-27", "fecha_salida": "2024-02-27", "descripcion": "Servicio MP de 20000 km"},
    {"placa": "CDD114", "taller": "RENTING S.A.C.", "km_ingreso": 26552, "km_servicio": 25000, "fecha_ingreso": "2024-04-26", "fecha_salida": "2024-04-26", "descripcion": ""},
    {"placa": "CDD114", "taller": "RENTING S.A.C.", "km_ingreso": 30931, "km_servicio": 30000, "fecha_ingreso": "2024-07-30", "fecha_salida": "2024-07-30", "descripcion": ""},
    {"placa": "CDD114", "taller": "RENTING S.A.C.", "km_ingreso": 36005, "km_servicio": 35000, "fecha_ingreso": "2024-10-18", "fecha_salida": "2024-10-21", "descripcion": ""},
    {"placa": "CDD114", "taller": "RENTING S.A.C.", "km_ingreso": 41239, "km_servicio": 40000, "fecha_ingreso": "2025-01-02", "fecha_salida": "2025-01-03", "descripcion": ""},
    {"placa": "CDD114", "taller": "RENTING S.A.C.", "km_ingreso": 47211, "km_servicio": 47000, "fecha_ingreso": "2025-03-17", "fecha_salida": "2025-03-17", "descripcion": ""},
    {"placa": "CDD114", "taller": "RENTING S.A.C.", "km_ingreso": 52470, "km_servicio": 50000, "fecha_ingreso": "2025-05-22", "fecha_salida": "2025-05-22", "descripcion": ""},
    {"placa": "CDD114", "taller": "RENTING S.A.C.", "km_ingreso": 57566, "km_servicio": 55000, "fecha_ingreso": "2025-09-02", "fecha_salida": "2025-09-03", "descripcion": ""},
    {"placa": "CDD114", "taller": "RENTING S.A.C.", "km_ingreso": 63142, "km_servicio": 60000, "fecha_ingreso": "2025-11-21", "fecha_salida": "2025-11-24", "descripcion": ""},
    {"placa": "CDD114", "taller": "RENTING S.A.C.", "km_ingreso": 68653, "km_servicio": 65000, "fecha_ingreso": "2026-01-19", "fecha_salida": "2026-01-20", "descripcion": ""},
    {"placa": "CDD114", "taller": "RENTING S.A.C.", "km_ingreso": 74018, "km_servicio": 75000, "fecha_ingreso": "2026-03-14", "fecha_salida": "2026-04-06", "descripcion": ""},
    {"placa": "CDD114", "taller": "RENTING S.A.C.", "km_ingreso": 79656, "km_servicio": 80000, "fecha_ingreso": "2026-05-18", "fecha_salida": "2026-05-18", "descripcion": ""},
    {"placa": "CDD114", "taller": "PINEDA AUTOMOTRIZ S.A.C.", "km_ingreso": 86642, "km_servicio": 85000, "fecha_ingreso": "2026-08-04", "fecha_salida": "2026-08-04", "descripcion": "MANTTO PREVENTIVO 85K"},
    {"placa": "CFM760", "taller": "GACSA PERÚ S.A.C.", "km_ingreso": 6165, "km_servicio": 5000, "fecha_ingreso": "2025-11-17", "fecha_salida": "2025-11-17", "descripcion": "Servicio MP de 5000 km"},
    {"placa": "CFM760", "taller": "GACSA PERÚ S.A.C.", "km_ingreso": 10468, "km_servicio": 10000, "fecha_ingreso": "2026-01-07", "fecha_salida": "2026-01-07", "descripcion": "Servicio MP de 10000 km"},
    {"placa": "CFM760", "taller": "GACSA PERÚ S.A.C.", "km_ingreso": 15489, "km_servicio": 15000, "fecha_ingreso": "2026-02-20", "fecha_salida": "2026-02-20", "descripcion": "Servicio MP de 15000 km"},
    {"placa": "CFM760", "taller": "GACSA PERÚ S.A.C.", "km_ingreso": 20767, "km_servicio": 20000, "fecha_ingreso": "2026-03-11", "fecha_salida": "2026-03-11", "descripcion": "Servicio MP de 20000 km"},
    {"placa": "CFM760", "taller": "RENTING S.A.C.", "km_ingreso": 26062, "km_servicio": 25000, "fecha_ingreso": "2026-05-25", "fecha_salida": "2026-05-25", "descripcion": ""},
    {"placa": "CFM760", "taller": "RENTING S.A.C.", "km_ingreso": 32317, "km_servicio": 30000, "fecha_ingreso": "2026-08-26", "fecha_salida": "2026-08-26", "descripcion": ""},
    {"placa": "CFM856", "taller": "GACSA PERÚ S.A.C.", "km_ingreso": 5232, "km_servicio": 5000, "fecha_ingreso": "2025-11-11", "fecha_salida": "2025-11-11", "descripcion": "Servicio MP de 5000 km"},
    {"placa": "CFM856", "taller": "GACSA PERÚ S.A.C.", "km_ingreso": 10594, "km_servicio": 10000, "fecha_ingreso": "2026-05-15", "fecha_salida": "2026-05-15", "descripcion": "Servicio MP de 10000 km"},
    {"placa": "CFO709", "taller": "GACSA PERÚ S.A.C.", "km_ingreso": 6238, "km_servicio": 5000, "fecha_ingreso": "2025-11-12", "fecha_salida": "2025-11-12", "descripcion": "Servicio MP de 5000 km"},
    {"placa": "CFO709", "taller": "GACSA PERÚ S.A.C.", "km_ingreso": 10238, "km_servicio": 10000, "fecha_ingreso": "2026-01-21", "fecha_salida": "2026-01-21", "descripcion": "Servicio MP de 10000 km"},
    {"placa": "CFO709", "taller": "GACSA PERÚ S.A.C.", "km_ingreso": 15351, "km_servicio": 15000, "fecha_ingreso": "2026-03-12", "fecha_salida": "2026-03-12", "descripcion": "Servicio MP de 15000 km"},
    {"placa": "CFO709", "taller": "GACSA PERÚ S.A.C.", "km_ingreso": 20575, "km_servicio": 20000, "fecha_ingreso": "2026-05-26", "fecha_salida": "2026-05-26", "descripcion": "Servicio MP de 20000 km"},
    {"placa": "CFO709", "taller": "RENTING S.A.C.", "km_ingreso": 26094, "km_servicio": 25000, "fecha_ingreso": "2026-07-30", "fecha_salida": "2026-08-04", "descripcion": ""},
    {"placa": "CSC436", "taller": "EUROSHOP S.A.", "km_ingreso": 10525, "km_servicio": 10000, "fecha_ingreso": "2026-02-21", "fecha_salida": "2026-02-21", "descripcion": "Servicio MP de 10000 km"}
  ];
  var unitByPlaca = {};
  readAll('units').forEach(function (u) { unitByPlaca[String(u.placa).trim().toUpperCase()] = u.id; });
  var seen = {};
  readAll('unit_mantenimiento').forEach(function (m) { seen[m.unit_id + '|' + m.fecha_ingreso + '|' + m.km_ingreso] = true; });
  var id = nextId('unit_mantenimiento');
  var toWrite = [], added = 0, sinUnidad = 0, dup = 0, excl = 0;
  DATA.forEach(function (r) {
    var key = String(r.placa).trim().toUpperCase();
    if (EXCLUIR[key]) { excl++; return; }
    var uid = unitByPlaca[key];
    if (!uid) { sinUnidad++; return; }
    var dk = uid + '|' + r.fecha_ingreso + '|' + r.km_ingreso;
    if (seen[dk]) { dup++; return; }
    seen[dk] = true;
    toWrite.push(objToRow('unit_mantenimiento', {
      id: id++, unit_id: uid, taller: r.taller, km_ingreso: r.km_ingreso, km_servicio: r.km_servicio,
      fecha_ingreso: r.fecha_ingreso, fecha_salida: r.fecha_salida, descripcion: r.descripcion, created_at: nowISO(),
    }));
    added++;
  });
  if (toWrite.length) {
    var lock = LockService.getScriptLock(); lock.waitLock(30000);
    try {
      var sh = sheet('unit_mantenimiento');
      var start = Math.max(sh.getLastRow() + 1, 2);
      var rng = sh.getRange(start, 1, toWrite.length, SCHEMA.unit_mantenimiento.length);
      rng.setNumberFormat('@');
      rng.setValues(toWrite);
    } finally { lock.releaseLock(); }
  }
  return 'Mantenimiento cargado. Agregados: ' + added + '. Sin unidad en base: ' + sinUnidad + '. Duplicados saltados: ' + dup + '. Excluidos: ' + excl + '.';
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
          var created = append('drivers', { name: u.driver.name, phone: u.driver.phone || '', vehicle: u.driver.vehicle || '', supervisor: u.driver.supervisor || '', active: 1, es_proveedor: u.driver.es_proveedor ? 1 : 0 });
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
    { email: 'rpulido@ttaudit.com', name: 'R. Pulido', role: 'cuenta', password: 'Rpulido2026' },
    { email: 'dolaguibel@ttaudit.com', name: 'D. Olaguibel', role: 'cuenta' },
    { email: 'mcarhuallanqui@ttaudit.com', name: 'M. Carhuallanqui', role: 'cuenta' },
    { email: 'ghidalgo@ttaudit.com', name: 'G. Hidalgo', role: 'cuenta' },
    { email: 'earostegui@ttaudit.com', name: 'E. Arostegui', role: 'cuenta' },
    // Choferes / externos (correo o usuario + contrasena)
    { email: 'cris@ttaudit.com', name: 'Cris', role: 'chofer', password: 'Cris', driver: { name: 'Chris Herrera', vehicle: 'CDC 549', supervisor: 'Pamela' } },
    { email: 'ayronn@ttaudit.com', name: 'Ayronn', role: 'chofer', password: 'Ayronn', driver: { name: 'Ayronn', supervisor: 'Pamela' } },
    { email: 'proveedor1', name: 'Proveedor 1', role: 'chofer', password: 'Proveedor1', driver: { name: 'Proveedor 1', supervisor: 'Pamela', es_proveedor: 1 } },
  ];
}

// Cuentas oficiales. Ejecuta setupAccounts() desde el editor para cargarlas.
// Es idempotente: solo agrega las que falten (compara por nombre). No borra
// cuentas existentes. Los proyectos se crean aparte (varian por cuenta).
function accountDirectory() {
  return ['BAT', 'Alicorp', 'Ilko', 'Casa Europa', 'Edgwell', 'Arca Continental', 'Palmera'];
}

// Limpia los datos de prueba: borra TODAS las rutas y proyectos (eran de
// ejemplo/pruebas) y la cuenta demo "Backus". Conserva usuarios, choferes y las
// cuentas reales. Ejecutala una vez desde el editor cuando quieras empezar limpio.
function limpiarDemo() {
  var borradas = { rutas: 0, proyectos: 0, cuentas: 0 };
  readAll('routes').forEach(function (r) { if (deleteById('routes', r.id)) borradas.rutas++; });
  readAll('projects').forEach(function (p) { if (deleteById('projects', p.id)) borradas.proyectos++; });
  readAll('accounts').forEach(function (a) {
    if (String(a.name).trim().toLowerCase() === 'backus') { if (deleteById('accounts', a.id)) borradas.cuentas++; }
  });
  return 'Limpieza lista. Rutas borradas: ' + borradas.rutas + ', proyectos: ' + borradas.proyectos + ', cuenta Backus: ' + borradas.cuentas + '.';
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
      drivers.push({ id: driverId, name: u.driver.name, phone: u.driver.phone || '', vehicle: u.driver.vehicle || '', supervisor: u.driver.supervisor || '', active: 1, es_proveedor: u.driver.es_proveedor ? 1 : 0 });
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
