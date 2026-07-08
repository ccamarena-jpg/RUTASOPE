import React from 'react';
import { useNavigate } from 'react-router-dom';
import { clearSession } from '../api';

const ROLE_LABEL = { admin: 'Administrador', chofer: 'Chofer', cuenta: 'Cuenta / Cliente' };

export default function Navbar({ user, children }) {
  const navigate = useNavigate();
  function logout() {
    clearSession();
    navigate('/login', { replace: true });
  }
  const firstName = (user.name || '').split(' ')[0] || user.name;
  return (
    <div className="navbar">
      <div className="brand">
        <div className="logo-badge">TT</div>
        <div className="brand-text">
          <b>TT AUDIT</b>
          <small>Ruteo</small>
        </div>
      </div>
      <div className="nav-links">{children}</div>
      <div className="spacer" />
      <div className="userinfo">
        <span className="user-pill" title={`${user.name} · ${ROLE_LABEL[user.role] || user.role}`}>{firstName}</span>
        <button className="btn-logout" onClick={logout}>Salir</button>
        <span className="status-dot">Sistema activo</span>
      </div>
    </div>
  );
}
