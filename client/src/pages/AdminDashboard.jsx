import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { api } from '../api';
import WeeklyCalendar from '../components/WeeklyCalendar.jsx';
import RouteFormModal from '../components/RouteFormModal.jsx';
import BulkUploadModal from '../components/BulkUploadModal.jsx';
import StatusSummary from '../components/StatusSummary.jsx';
import { getMonday, addDays, toISODate } from '../utils/date';
import { downloadRoutesCsv } from '../utils/csv';

const TABS = [
  { id: 'calendar', label: 'Calendario semanal' },
  { id: 'today', label: 'Rutas de hoy (en vivo)' },
  { id: 'catalog', label: 'Choferes / Cuentas / Proyectos' },
];

export default function AdminDashboard() {
  const [tab, setTab] = useState('calendar');
  const [drivers, setDrivers] = useState([]);
  const [accounts, setAccounts] = useState([]);

  const refreshCatalog = useCallback(() => {
    api.getDrivers().then(setDrivers).catch(() => {});
    api.getAccounts().then(setAccounts).catch(() => {});
  }, []);

  useEffect(() => { refreshCatalog(); }, [refreshCatalog]);

  return (
    <div>
      <div className="page-head">
        <h1>Panel de administracion</h1>
        <p>Asigna choferes, carga rutas diarias y da seguimiento en tiempo real.</p>
      </div>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      {tab === 'calendar' && <CalendarTab drivers={drivers} accounts={accounts} />}
      {tab === 'today' && <TodayTab />}
      {tab === 'catalog' && <CatalogTab drivers={drivers} accounts={accounts} onChange={refreshCatalog} />}
    </div>
  );
}

function CalendarTab({ drivers, accounts }) {
  const [weekStart, setWeekStart] = useState(getMonday(new Date()));
  const [driverId, setDriverId] = useState(null);
  const [routes, setRoutes] = useState([]);
  const [modalState, setModalState] = useState(null); // { initial }
  const [showBulk, setShowBulk] = useState(false);

  useEffect(() => {
    if (!driverId && drivers.length) setDriverId(drivers[0].id);
  }, [drivers, driverId]);

  const load = useCallback(() => {
    if (!driverId) return;
    const from = toISODate(weekStart);
    const to = toISODate(addDays(weekStart, 5));
    api.getRoutes({ from, to, driver_id: driverId }).then(setRoutes).catch(() => {});
  }, [driverId, weekStart]);

  useEffect(() => { load(); }, [load]);

  const driverMeta = useMemo(() => drivers.find((d) => d.id === driverId), [drivers, driverId]);

  function handleSlotClick(dateISO, hour, route) {
    setModalState({ initial: route || { date: dateISO, hour, driver_id: driverId } });
  }

  return (
    <div>
      <div className="card-header">
        <h2 style={{ fontSize: 17 }}>🗺️ Asignacion de rutas diarias</h2>
        <div className="toolbar">
          <button className="btn btn-secondary" onClick={() => setShowBulk(true)}>Carga masiva (CSV)</button>
          <button className="btn btn-primary" onClick={() => setModalState({ initial: { date: toISODate(new Date()), driver_id: driverId } })}>+ Nueva ruta</button>
        </div>
      </div>
      <WeeklyCalendar
        drivers={drivers}
        driverId={driverId}
        onDriverChange={setDriverId}
        weekStart={weekStart}
        onWeekChange={setWeekStart}
        routes={routes}
        onSlotClick={handleSlotClick}
        driverMeta={driverMeta}
      />
      {modalState && (
        <RouteFormModal
          initial={modalState.initial}
          drivers={drivers}
          accounts={accounts}
          onClose={() => setModalState(null)}
          onSaved={() => { setModalState(null); load(); }}
          onDeleted={() => { setModalState(null); load(); }}
        />
      )}
      {showBulk && <BulkUploadModal onClose={() => setShowBulk(false)} onDone={load} />}
    </div>
  );
}

const STATUS_LABEL = { pendiente: 'Pendiente', en_curso: 'En curso', completado: 'Completado', no_realizada: 'No realizada' };

function TodayTab() {
  const [date, setDate] = useState(toISODate(new Date()));
  const [routes, setRoutes] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [search, setSearch] = useState('');
  const [driverFilter, setDriverFilter] = useState('todos');
  const [accountFilter, setAccountFilter] = useState('todos');
  const [statusFilter, setStatusFilter] = useState('todos');

  const load = useCallback(() => {
    api.getRoutes({ date }).then((r) => { setRoutes(r); setLastUpdated(new Date()); }).catch(() => {});
  }, [date]);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  const driverNames = useMemo(() => [...new Set(routes.map((r) => r.driver_name))].sort(), [routes]);
  const accountNames = useMemo(() => [...new Set(routes.map((r) => r.account_name))].sort(), [routes]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return routes.filter((r) => {
      if (driverFilter !== 'todos' && r.driver_name !== driverFilter) return false;
      if (accountFilter !== 'todos' && r.account_name !== accountFilter) return false;
      if (statusFilter !== 'todos' && r.status !== statusFilter) return false;
      if (q) {
        const hay = `${r.destino} ${r.motivo || ''} ${r.driver_name} ${r.account_name} ${r.project_name || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [routes, search, driverFilter, accountFilter, statusFilter]);

  function exportCsv() {
    downloadRoutesCsv(visible, `rutas_${date}.csv`);
  }

  return (
    <div className="card">
      <div className="card-header">
        <h3>🕒 Rutas del dia (en vivo)</h3>
        <div className="toolbar">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <button className="btn btn-secondary" onClick={load}>Actualizar</button>
          <button className="btn btn-secondary" onClick={exportCsv} disabled={visible.length === 0}>⬇ Exportar CSV</button>
          {lastUpdated && <span style={{ fontSize: 12, color: '#889' }}>Actualizado {lastUpdated.toLocaleTimeString()}</span>}
        </div>
      </div>

      <StatusSummary routes={routes} />

      <div className="toolbar filters-row">
        <input
          type="search"
          placeholder="Buscar destino, motivo, chofer..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 220, flex: 1 }}
        />
        <select value={driverFilter} onChange={(e) => setDriverFilter(e.target.value)}>
          <option value="todos">Todos los choferes</option>
          {driverNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
          <option value="todos">Todas las cuentas</option>
          {accountNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="todos">Todos los estados</option>
          <option value="pendiente">Pendiente</option>
          <option value="en_curso">En curso</option>
          <option value="completado">Completado</option>
          <option value="no_realizada">No realizada</option>
        </select>
      </div>

      {visible.length === 0 ? (
        <div className="empty-state">{routes.length === 0 ? 'No hay rutas programadas para esta fecha.' : 'Ninguna ruta coincide con los filtros.'}</div>
      ) : (
        <table className="simple">
          <thead>
            <tr>
              <th>Hora</th><th>Chofer</th><th>Cuenta / Proyecto</th><th>Destino</th><th>Estado</th><th>Salida</th><th>Llegada</th><th>Guia</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id}>
                <td>{r.hour}</td>
                <td>{r.driver_name}</td>
                <td>{r.account_name}{r.project_name ? ` / ${r.project_name}` : ''}</td>
                <td>{r.destino}{r.motivo ? <div style={{ color: '#889', fontSize: 12 }}>{r.motivo}</div> : null}
                  {r.status === 'no_realizada' && r.motivo_no_realizada ? <div style={{ color: 'var(--red)', fontSize: 12 }}>No realizada: {r.motivo_no_realizada}</div> : null}</td>
                <td><span className={`badge ${r.status}`}>{STATUS_LABEL[r.status]}</span></td>
                <td>{r.hora_salida || '-'}</td>
                <td>{r.hora_llegada || '-'}</td>
                <td>{r.guia_url ? <a href={r.guia_url} target="_blank" rel="noreferrer">Ver</a> : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function CatalogTab({ drivers, accounts, onChange }) {
  return (
    <div>
      <DriversPanel drivers={drivers} onChange={onChange} />
      <AccountsPanel accounts={accounts} onChange={onChange} />
    </div>
  );
}

function DriversPanel({ drivers, onChange }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [supervisor, setSupervisor] = useState('');
  const [error, setError] = useState('');

  async function add(e) {
    e.preventDefault();
    setError('');
    try {
      await api.createDriver({ name, phone, vehicle, supervisor });
      setName(''); setPhone(''); setVehicle(''); setSupervisor('');
      onChange();
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="card">
      <div className="card-header"><h3>🚚 Choferes</h3></div>
      {error && <div className="error-msg">{error}</div>}
      <table className="simple" style={{ marginBottom: 14 }}>
        <thead><tr><th>Nombre</th><th>Telefono</th><th>Vehiculo</th><th>Supervisor</th></tr></thead>
        <tbody>
          {drivers.map((d) => (
            <tr key={d.id}><td>{d.name}</td><td>{d.phone}</td><td>{d.vehicle}</td><td>{d.supervisor}</td></tr>
          ))}
        </tbody>
      </table>
      <form onSubmit={add} className="form-row" style={{ alignItems: 'end' }}>
        <div className="field"><label>Nombre</label><input value={name} onChange={(e) => setName(e.target.value)} required /></div>
        <div className="field"><label>Telefono</label><input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div className="field"><label>Vehiculo / Movil</label><input value={vehicle} onChange={(e) => setVehicle(e.target.value)} /></div>
        <div className="field"><label>Supervisor</label><input value={supervisor} onChange={(e) => setSupervisor(e.target.value)} /></div>
        <button className="btn btn-primary" type="submit" style={{ height: 38 }}>+ Agregar chofer</button>
      </form>
    </div>
  );
}

function AccountsPanel({ accounts, onChange }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [selectedAccount, setSelectedAccount] = useState('');
  const [projects, setProjects] = useState([]);
  const [projectName, setProjectName] = useState('');

  useEffect(() => {
    if (selectedAccount) api.getProjects(selectedAccount).then(setProjects).catch(() => {});
    else setProjects([]);
  }, [selectedAccount, accounts]);

  async function addAccount(e) {
    e.preventDefault();
    setError('');
    try {
      await api.createAccount({ name });
      setName('');
      onChange();
    } catch (err) { setError(err.message); }
  }

  async function addProject(e) {
    e.preventDefault();
    if (!selectedAccount) return;
    try {
      await api.createProject({ name: projectName, account_id: selectedAccount });
      setProjectName('');
      api.getProjects(selectedAccount).then(setProjects);
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="card">
      <div className="card-header"><h3>🏢 Cuentas y proyectos</h3></div>
      {error && <div className="error-msg">{error}</div>}
      <table className="simple" style={{ marginBottom: 14 }}>
        <thead><tr><th>Cuenta</th></tr></thead>
        <tbody>{accounts.map((a) => <tr key={a.id}><td>{a.name}</td></tr>)}</tbody>
      </table>
      <form onSubmit={addAccount} className="toolbar" style={{ marginBottom: 20 }}>
        <input placeholder="Nueva cuenta (ej: Nestle)" value={name} onChange={(e) => setName(e.target.value)} required />
        <button className="btn btn-primary" type="submit">+ Agregar cuenta</button>
      </form>

      <h4 style={{ marginBottom: 8, color: '#333' }}>Proyectos por cuenta</h4>
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <select value={selectedAccount} onChange={(e) => setSelectedAccount(e.target.value)}>
          <option value="">Selecciona una cuenta...</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      {selectedAccount && (
        <>
          <table className="simple" style={{ marginBottom: 12 }}>
            <thead><tr><th>Proyecto</th></tr></thead>
            <tbody>{projects.map((p) => <tr key={p.id}><td>{p.name}</td></tr>)}</tbody>
          </table>
          <form onSubmit={addProject} className="toolbar">
            <input placeholder="Nuevo proyecto" value={projectName} onChange={(e) => setProjectName(e.target.value)} required />
            <button className="btn btn-primary" type="submit">+ Agregar proyecto</button>
          </form>
        </>
      )}
    </div>
  );
}
