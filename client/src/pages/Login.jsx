import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setSession, getUser } from '../api';

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const existing = getUser();
  if (existing) {
    if (existing.role === 'admin') return (window.location.href = '/admin'), null;
    if (existing.role === 'chofer') return (window.location.href = '/chofer'), null;
    return (window.location.href = '/cuenta'), null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { token, user } = await api.login(email, password);
      setSession(token, user);
      if (user.role === 'admin') navigate('/admin');
      else if (user.role === 'chofer') navigate('/chofer');
      else navigate('/cuenta');
    } catch (err) {
      setError(err.message || 'Error al iniciar sesion');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>Ruteo TT Audit</h1>
        <p className="subtitle">Asignacion y seguimiento de rutas diarias</p>
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Correo</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <div className="field">
            <label>Contrasena</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={loading}>
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>
        <div className="hint-users">
          Usuarios de prueba:<br />
          Admin: <code>admin@ttaudit.com</code> / <code>admin123</code><br />
          Chofer: <code>christian.herrera@ttaudit.com</code> / <code>chofer123</code><br />
          Cuenta: <code>cuenta.alicorp@cliente.com</code> / <code>cuenta123</code>
        </div>
      </div>
    </div>
  );
}
