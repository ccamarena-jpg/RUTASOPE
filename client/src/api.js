const BASE = '/api';

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

async function request(path, { method = 'GET', body, isForm = false } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!isForm && body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }

  if (!res.ok) {
    const message = (data && data.error) || `Error ${res.status}`;
    throw new Error(message);
  }
  return data;
}

export const api = {
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),

  getDrivers: () => request('/drivers'),
  createDriver: (payload) => request('/drivers', { method: 'POST', body: payload }),
  updateDriver: (id, payload) => request(`/drivers/${id}`, { method: 'PUT', body: payload }),

  getAccounts: () => request('/accounts'),
  createAccount: (payload) => request('/accounts', { method: 'POST', body: payload }),

  getProjects: (accountId) => request(`/projects${accountId ? `?account_id=${accountId}` : ''}`),
  createProject: (payload) => request('/projects', { method: 'POST', body: payload }),

  getRoutes: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/routes${qs ? `?${qs}` : ''}`);
  },
  createRoute: (payload) => request('/routes', { method: 'POST', body: payload }),
  updateRoute: (id, payload) => request(`/routes/${id}`, { method: 'PUT', body: payload }),
  deleteRoute: (id) => request(`/routes/${id}`, { method: 'DELETE' }),
  bulkUpload: (file) => {
    const form = new FormData();
    form.append('file', file);
    return request('/routes/bulk', { method: 'POST', body: form, isForm: true });
  },

  driverSalida: (id, hora) => request(`/routes/${id}/salida`, { method: 'POST', body: { hora } }),
  driverLlegada: (id, hora) => request(`/routes/${id}/llegada`, { method: 'POST', body: { hora } }),
  driverComentario: (id, comentario) => request(`/routes/${id}/comentario`, { method: 'POST', body: { comentario } }),
  driverNoRealizada: (id, motivo) => request(`/routes/${id}/no-realizada`, { method: 'POST', body: { motivo } }),
  driverGuia: (id, file) => {
    const form = new FormData();
    form.append('guia', file);
    return request(`/routes/${id}/guia`, { method: 'POST', body: form, isForm: true });
  },
};
