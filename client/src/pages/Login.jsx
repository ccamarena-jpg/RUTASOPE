import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setSession, getUser } from '../api';

const GOOGLE_CLIENT_ID = (import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID) || '850065266017-3tvj9u512flo9dbfpk88gnn3mofbtt8s.apps.googleusercontent.com';

function loadGis() {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.accounts && window.google.accounts.id) return resolve();
    const existing = document.getElementById('gis-script');
    if (existing) { existing.addEventListener('load', () => resolve()); return; }
    const s = document.createElement('script');
    s.id = 'gis-script';
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('No se pudo cargar Google Sign-In'));
    document.head.appendChild(s);
  });
}

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const googleBtnRef = useRef(null);

  const existing = getUser();
  if (existing) {
    if (existing.role === 'admin') return (window.location.href = '/admin'), null;
    if (existing.role === 'chofer') return (window.location.href = '/chofer'), null;
    return (window.location.href = '/cuenta'), null;
  }

  function routeByRole(role) {
    if (role === 'admin') navigate('/admin');
    else if (role === 'chofer') navigate('/chofer');
    else navigate('/cuenta');
  }

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    let cancelled = false;
    loadGis().then(() => {
      if (cancelled || !window.google || !googleBtnRef.current) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (resp) => {
          setError('');
          setLoading(true);
          try {
            const { token, user } = await api.googleLogin(resp.credential);
            setSession(token, user);
            routeByRole(user.role);
          } catch (err) {
            setError(err.message || 'No se pudo iniciar sesion con Google');
          } finally {
            setLoading(false);
          }
        },
      });
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        theme: 'outline', size: 'large', width: 330, text: 'continue_with',
      });
    }).catch((e) => setError(e.message));
    return () => { cancelled = true; };
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { token, user } = await api.login(email, password);
      setSession(token, user);
      routeByRole(user.role);
    } catch (err) {
      setError(err.message || 'Error al iniciar sesion');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">TT</div>
        <h1>Ruteo TT Audit</h1>
        <p className="subtitle">Asignacion y seguimiento de rutas diarias</p>
        {error && <div className="error-msg">{error}</div>}

        {GOOGLE_CLIENT_ID ? (
          <>
            <div className="google-signin">
              <div className="gis-hint">Personal TT Audit</div>
              <div ref={googleBtnRef} />
            </div>
            <div className="login-divider"><span>o chofer con contrasena</span></div>
          </>
        ) : null}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Correo</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          </div>
          <div className="field">
            <label>Contrasena</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={loading}>
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>

        <div className="hint-users">
          Personal (admin y responsables): usa <b>Continuar con Google</b>.<br />
          Choferes: correo y contrasena (ej: <code>cris@ttaudit.com</code>).
        </div>
      </div>
    </div>
  );
}
