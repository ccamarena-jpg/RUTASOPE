import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { getUser } from './api';
import Login from './pages/Login.jsx';
import AdminDashboard from './pages/AdminDashboard.jsx';
import DriverView from './pages/DriverView.jsx';
import AccountView from './pages/AccountView.jsx';
import Navbar from './components/Navbar.jsx';

function HomeRedirect() {
  const user = getUser();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'admin') return <Navigate to="/admin" replace />;
  if (user.role === 'chofer') return <Navigate to="/chofer" replace />;
  return <Navigate to="/cuenta" replace />;
}

function Protected({ roles, children }) {
  const user = getUser();
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return (
    <div className="app-shell">
      <Navbar user={user} />
      <div className="main-content">{children}</div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/admin/*" element={<Protected roles={['admin']}><AdminDashboard /></Protected>} />
        <Route path="/chofer" element={<Protected roles={['chofer']}><DriverView /></Protected>} />
        <Route path="/cuenta" element={<Protected roles={['cuenta']}><AccountView /></Protected>} />
        <Route path="/" element={<HomeRedirect />} />
        <Route path="*" element={<HomeRedirect />} />
      </Routes>
    </BrowserRouter>
  );
}
