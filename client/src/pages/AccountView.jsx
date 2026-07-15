import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { toISODate, addDays, getMonday } from '../utils/date';
import LiveMap from '../components/LiveMap.jsx';
import DashboardTab from '../components/DashboardTab.jsx';
import WeeklyCalendar from '../components/WeeklyCalendar.jsx';
import { downloadRoutesCsv } from '../utils/csv';

const STATUS_LABEL = { pendiente: 'Pendiente', en_curso: 'En curso', completado: 'Completado', no_realizada: 'No realizada' };

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'calendar', label: 'Calendario semanal' },
  { id: 'tracking', label: 'Seguimiento en tiempo real' },
  { id: 'projects', label: 'Proyectos' },
  { id: 'map', label: 'Mapa en vivo' },
];

export default function AccountView() {
  const [tab, setTab] = useState('dashboard');
  return (
    <div>
      <div className="page-head">
        <h1>Panel de responsable de cuenta</h1>
        <p>Consulta el dashboard y el calendario (solo lectura), crea proyectos y sigue las rutas en tiempo real.</p>
      </div>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'calendar' && <CalendarView />}
      {tab === 'tracking' && <TrackingPanel />}
      {tab === 'projects' && <ProjectsPanel />}
      {tab === 'map' && <LiveMap />}
    </div>
  );
}

// Calendario semanal en modo lectura para responsables de cuenta.
function CalendarView() {
  const [drivers, setDrivers] = useState([]);
  const [driverId, setDriverId] = useState(null);
  const [weekStart, setWeekStart] = useState(getMonday(new Date()));
  const [routes, setRoutes] = useState([]);
  const [info, setInfo] = useState(null);

  useEffect(() => { api.getDrivers().then(setDrivers).catch(() => {}); }, []);
  useEffect(() => { if (!driverId && drivers.length) setDriverId(drivers[0].id); }, [drivers, driverId]);

  const load = useCallback(() => {
    if (!driverId) return;
    const from = toISODate(weekStart);
    const to = toISODate(addDays(weekStart, 6));
    api.getRoutes({ from, to, driver_id: driverId }).then(setRoutes).catch(() => {});
  }, [driverId, weekStart]);
  useEffect(() => { load(); }, [load]);

  const driverMeta = drivers.find((d) => d.id === driverId);

  return (
    <div>
      <WeeklyCalendar
        drivers={drivers}
        driverId={driverId}
        onDriverChange={setDriverId}
        weekStart={weekStart}
        onWeekChange={setWeekStart}
        routes={routes}
        onSlotClick={(dateISO, hour, route) => { if (route) setInfo(route); }}
        driverMeta={driverMeta}
      />
      {info && <RouteInfoModal route={info} onClose={() => setInfo(null)} />}
    </div>
  );
}

function RouteInfoModal({ route, onClose }) {
  const row = (label, value) => value ? <div className="meta"><b>{label}:</b> {value}</div> : null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{route.destino}</h3>
        {row('Fecha', route.date)}
        {row('Hora', `${route.hour}${route.hora_fin ? ` – ${route.hora_fin}` : ''}`)}
        {row('Chofer', route.driver_name)}
        {row('Cuenta', route.account_name)}
        {row('Proyecto', route.project_name)}
        {row('Estado', STATUS_LABEL[route.status] || route.status)}
        {row('Salida', route.hora_salida)}
        {row('Llegada', route.hora_llegada)}
        {row('Motivo', route.motivo)}
        {row('Comentario', route.comentario_chofer)}
        {row('Costo de transporte', (route.costo_transporte != null && route.costo_transporte !== '') ? `S/ ${Number(route.costo_transporte).toFixed(2)}` : '')}
        {route.guia_url && <div className="file-info">Guia: <a href={route.guia_url} target="_blank" rel="noreferrer">ver</a></div>}
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

function ProjectsPanel() {
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [projects, setProjects] = useState([]);
  const [projectName, setProjectName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.getAccounts().then(setAccounts).catch((e) => setError(e.message)); }, []);

  const loadProjects = useCallback(() => {
    if (!selectedAccount) { setProjects([]); return; }
    api.getProjects(selectedAccount).then(setProjects).catch((e) => setError(e.message));
  }, [selectedAccount]);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  async function addProject(e) {
    e.preventDefault();
    if (!selectedAccount) { setError('Selecciona una cuenta primero'); return; }
    setError(''); setBusy(true);
    try {
      await api.createProject({ name: projectName, account_id: selectedAccount });
      setProjectName('');
      loadProjects();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className="section-title"><span className="st-icon">📁</span> Proyectos por cuenta</div>
      {error && <div className="error-msg">{error}</div>}

      <div className="field" style={{ maxWidth: 360 }}>
        <label>Cuenta / Cliente</label>
        <select value={selectedAccount} onChange={(e) => setSelectedAccount(e.target.value)}>
          <option value="">Selecciona una cuenta...</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      {selectedAccount && (
        <>
          {projects.length === 0 ? (
            <div className="empty-state" style={{ padding: '20px 0' }}>Esta cuenta aun no tiene proyectos.</div>
          ) : (
            <table className="simple" style={{ margin: '12px 0' }}>
              <thead><tr><th>Proyecto</th></tr></thead>
              <tbody>{projects.map((p) => <tr key={p.id}><td>{p.name}</td></tr>)}</tbody>
            </table>
          )}
          <form onSubmit={addProject} className="toolbar" style={{ marginTop: 8 }}>
            <input placeholder="Nombre del nuevo proyecto" value={projectName} onChange={(e) => setProjectName(e.target.value)} required />
            <button className="btn btn-primary" type="submit" disabled={busy}>+ Agregar proyecto</button>
          </form>
        </>
      )}
      {accounts.length === 0 && !error && (
        <div className="empty-state" style={{ padding: '20px 0' }}>
          Aun no hay cuentas creadas. Pide a un administrador que registre la cuenta/cliente.
        </div>
      )}
    </div>
  );
}

function TrackingPanel() {
  const [date, setDate] = useState(toISODate(new Date()));
  const [routes, setRoutes] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [statusFilter, setStatusFilter] = useState('todos');

  const load = useCallback(() => {
    api.getRoutes({ date }).then((r) => { setRoutes(r); setLastUpdated(new Date()); }).catch(() => {});
  }, [date]);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  const visible = statusFilter === 'todos' ? routes : routes.filter((r) => r.status === statusFilter);

  async function descargarTodo() {
    const from = toISODate(addDays(new Date(), -365));
    const to = toISODate(addDays(new Date(), 365));
    try {
      const all = await api.getRoutes({ from, to });
      downloadRoutesCsv(all, `rutas_${toISODate(new Date())}.csv`);
    } catch (e) { /* noop */ }
  }

  return (
    <div className="card">
      <div className="card-header">
        <h2 style={{ fontSize: 17 }}>📍 Rutas en tiempo real</h2>
        <div className="toolbar">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="todos">Todos los estados</option>
            <option value="pendiente">Pendiente</option>
            <option value="en_curso">En curso</option>
            <option value="completado">Completado</option>
            <option value="no_realizada">No realizada</option>
          </select>
          <button className="btn btn-secondary" onClick={load}>Actualizar</button>
          <button className="btn btn-primary" onClick={descargarTodo}>⬇ Descargar CSV</button>
        </div>
      </div>
      {lastUpdated && <div style={{ fontSize: 12, color: '#889', marginBottom: 10 }}>Ultima actualizacion: {lastUpdated.toLocaleTimeString()} (auto cada 15s)</div>}

      {visible.length === 0 ? (
        <div className="empty-state">No hay rutas para mostrar.</div>
      ) : (
        visible.map((r) => (
          <div className="route-card" key={r.id}>
            <div className="top-row">
              <div>
                <div className="hour">{r.hour}</div>
                <div className="destino">{r.destino}</div>
                <div className="meta">Cuenta: {r.account_name} {r.project_name ? `| Proyecto: ${r.project_name}` : ''}</div>
                <div className="meta">Chofer: {r.driver_name}</div>
                {r.motivo && <div className="meta">{r.motivo}</div>}
              </div>
              <span className={`badge ${r.status}`}>{STATUS_LABEL[r.status]}</span>
            </div>
            <div className="meta">Salida: {r.hora_salida || '-'} &nbsp;|&nbsp; Llegada: {r.hora_llegada || '-'}</div>
            {(r.cantidad_bultos || r.gr_firmada) && (
              <div className="meta">
                {r.cantidad_bultos ? `Bultos: ${r.cantidad_bultos}` : ''}
                {r.cantidad_bultos && r.gr_firmada ? ' · ' : ''}
                {r.gr_firmada ? `GR firmada: ${r.gr_firmada}` : ''}
              </div>
            )}
            {(r.costo_transporte != null && r.costo_transporte !== '') && <div className="meta">Costo de transporte: S/ {Number(r.costo_transporte).toFixed(2)}</div>}
            {r.comentario_chofer && <div className="meta">Comentario del chofer: {r.comentario_chofer}</div>}
            {r.motivo_no_realizada && <div className="meta">Motivo no realizada: {r.motivo_no_realizada}</div>}
            {r.foto_elementos_url && (
              <div className="file-info">
                Foto de elementos: <a href={r.foto_elementos_url} target="_blank" rel="noreferrer">ver foto</a>
              </div>
            )}
            {r.guia_url && (
              <div className="file-info">
                Guia de remision: <a href={r.guia_url} target="_blank" rel="noreferrer">ver documento</a>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
