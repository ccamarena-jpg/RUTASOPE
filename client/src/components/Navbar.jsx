import React from 'react';
import { useNavigate } from 'react-router-dom';
import { clearSession } from '../api';

const ROLE_LABEL = { admin: 'Administrador', chofer: 'Chofer', cuenta: 'Cuenta / Cliente' };

export default function Navbar({ user }) {
  const navigate = useNavigate();
  function logout() {
    clearSession();
    navigate('/login', { replace: true });
  }
  return (
    <div className="navbar">
      <div className="brand">TT Audit <span>| Ruteo</span></div>
      <div className="userinfo">
        <span>{user.name} &middot; {ROLE_LABEL[user.role] || user.role}</span>
        <button className="logout" onClick={logout}>Salir</button>
      </div>
    </div>
  );
}
