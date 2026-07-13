// Cliente de la API. El backend es un Web App de Google Apps Script
// (ver apps-script/Code.gs). Todas las llamadas van por POST con
// Content-Type text/plain para que el navegador NO haga preflight de CORS.
//
// Pon la URL del Web App aqui, o definela como VITE_APPS_SCRIPT_URL en las
// variables de entorno (recomendado en Vercel). La de entorno tiene prioridad.
const APPS_SCRIPT_URL =
  (import.meta.env && import.meta.env.VITE_APPS_SCRIPT_URL) ||
  'https://script.google.com/macros/s/AKfycbxvLT7giDNxKdqlcLbtKCoh90StW4RpiWnH2tuTdbqVFcmsYBjW8kCzJvcmSuFHv5OP/exec';

function getToken() {
  return localStorage.getItem('ruteo_token');
}

export function getUser() {
  const raw = localStorage.getItem('ruteo_user');
  return raw ? JSON.parse(raw) : null;
}

export function setSession(token, user) {
  localStorage.setItem('ruteo_token', token);
  localStorage.setItem('ruteo_user', JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem('ruteo_token');
  localStorage.removeItem('ruteo_user');
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result);
      const i = s.indexOf(',');
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });
}

async function call(path, { method = 'GET', body = null, query = null, file = null } = {}) {
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL === 'PEGA_AQUI_LA_URL_DEL_WEB_APP') {
    throw new Error('Falta configurar la URL del Web App (VITE_APPS_SCRIPT_URL).');
  }

  const envelope = { path, method, token: getToken() || '', query: query || {}, body: body || {} };
  if (file) {
    const dataBase64 = await fileToBase64(file);
    envelope.body = { ...(body || {}), file: { name: file.name, mimeType: file.type || 'application/octet-stream', dataBase64 } };
  }

  let res;
  try {
    res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(envelope),
      redirect: 'follow',
    });
  } catch (e) {
    throw new Error('No se pudo conectar con el servidor. Revisa la URL del Web App y tu conexion.');
  }

  let payload = null;
  try { payload = await res.json(); } catch (e) { /* respuesta no JSON */ }

  if (!payload || payload.ok === false) {
    const err = new Error((payload && payload.error) || `Error ${(payload && payload.status) || res.status}`);
    err.status = payload && payload.status;
    throw err;
  }
  return payload.data;
}

export const api = {
  login: (email, password) => call('/auth/login', { method: 'POST', body: { email, password } }),
  googleLogin: (idToken) => call('/auth/google', { method: 'POST', body: { id_token: idToken } }),

  getDrivers: () => call('/drivers'),
  createDriver: (payload) => call('/drivers', { method: 'POST', body: payload }),
  updateDriver: (id, payload) => call(`/drivers/${id}`, { method: 'PUT', body: payload }),
  deleteDriver: (id) => call(`/drivers/${id}`, { method: 'DELETE' }),

  getUsers: () => call('/users'),
  updateUser: (id, payload) => call(`/users/${id}`, { method: 'PUT', body: payload }),

  sendLocation: (lat, lng) => call('/location', { method: 'POST', body: { lat, lng } }),
  getLocations: () => call('/locations'),

  getAccounts: () => call('/accounts'),
  createAccount: (payload) => call('/accounts', { method: 'POST', body: payload }),

  getProjects: (accountId) => call('/projects', { query: accountId ? { account_id: accountId } : {} }),
  createProject: (payload) => call('/projects', { method: 'POST', body: payload }),

  getRoutes: (params = {}) => call('/routes', { query: params }),
  createRoute: (payload) => call('/routes', { method: 'POST', body: payload }),
  updateRoute: (id, payload) => call(`/routes/${id}`, { method: 'PUT', body: payload }),
  deleteRoute: (id) => call(`/routes/${id}`, { method: 'DELETE' }),
  bulkUpload: (file) => call('/routes/bulk', { method: 'POST', file }),
  registrarViaje: (payload) => call('/routes/viaje', { method: 'POST', body: payload }),

  driverSalida: (id, hora) => call(`/routes/${id}/salida`, { method: 'POST', body: { hora } }),
  driverLlegada: (id, hora) => call(`/routes/${id}/llegada`, { method: 'POST', body: { hora } }),
  driverComentario: (id, comentario) => call(`/routes/${id}/comentario`, { method: 'POST', body: { comentario } }),
  driverNoRealizada: (id, motivo) => call(`/routes/${id}/no-realizada`, { method: 'POST', body: { motivo } }),
  driverEntrega: (id, payload) => call(`/routes/${id}/entrega`, { method: 'POST', body: payload }),
  driverFotoElementos: (id, file) => call(`/routes/${id}/foto-elementos`, { method: 'POST', file }),
  driverGuia: (id, file) => call(`/routes/${id}/guia`, { method: 'POST', file }),
};
