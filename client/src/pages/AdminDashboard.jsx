import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { api } from '../api';
import WeeklyCalendar from '../components/WeeklyCalendar.jsx';
import RouteFormModal from '../components/RouteFormModal.jsx';
import BulkUploadModal from '../components/BulkUploadModal.jsx';
import LiveMap from '../components/LiveMap.jsx';
import MovimientoPicker from '../components/MovimientoPicker.jsx';
import AddressPicker from '../components/AddressPicker.jsx';
import DashboardTab from '../components/DashboardTab.jsx';
import StatusSummary from '../components/StatusSummary.jsx';
import { getMonday, addDays, toISODate } from '../utils/date';
import { downloadRoutesCsv } from '../utils/csv';

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'calendar', label: 'Calendario semanal' },
  { id: 'today', label: 'Rutas de hoy (en vivo)' },
  { id: 'map', label: 'Mapa en vivo' },
  { id: 'catalog', label: 'Choferes / Cuentas / Proyectos' },
];

export default function AdminDashboard() {
  const [tab, setTab] = useState('dashboard');
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
      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'calendar' && <CalendarTab drivers={drivers} accounts={accounts} />}
      {tab === 'today' && <TodayTab />}
      {tab === 'map' && <LiveMap />}
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
  const [showViaje, setShowViaje] = useState(false);

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
          <button className="btn btn-secondary" onClick={() => setShowViaje(true)}>+ Registrar viaje</button>
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
      {showViaje && (
        <ViajeModal
          drivers={drivers}
          defaultDriverId={driverId}
          onClose={() => setShowViaje(false)}
          onSaved={() => { setShowViaje(false); load(); }}
        />
      )}
    </div>
  );
}

function ViajeModal({ drivers, defaultDriverId, onClose, onSaved }) {
  const [driverId, setDriverId] = useState(defaultDriverId || drivers[0]?.id || '');
  const [tipoMovimiento, setTipoMovimiento] = useState('');
  const [destino, setDestino] = useState('');
  const [elementos, setElementos] = useState('');
  const [cantidadBultos, setCantidadBultos] = useState('');
  const [lat, setLat] = useState(null);
  const [lng, setLng] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function handlePick({ lat: la, lng: ln, address }) {
    setLat(la); setLng(ln);
    if (!destino) setDestino(address);
  }

  async function submit(e) {
    e.preventDefault();
    if (!driverId) { setError('Selecciona el chofer'); return; }
    if (!destino.trim()) { setError('Indica el destino del viaje'); return; }
    setSaving(true); setError('');
    try {
      await api.registrarViaje({
        driver_id: Number(driverId), destino: destino.trim(), tipo_movimiento: tipoMovimiento,
        elementos_trasladados: elementos, cantidad_bultos: cantidadBultos, lat, lng,
      });
      onSaved();
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Registrar viaje</h3>
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label>Chofer</label>
            <select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}{d.vehicle ? ` (${d.vehicle})` : ''}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Tipo de movimiento</label>
            <MovimientoPicker value={tipoMovimiento} onChange={setTipoMovimiento} />
          </div>
          <div className="field">
            <label>Ubicacion (buscar en el mapa)</label>
            <AddressPicker onPick={handlePick} />
            <div style={{ fontSize: 12, color: lat != null ? 'var(--green)' : 'var(--text-soft)', marginTop: 4 }}>
              {lat != null ? `📍 Ubicacion cargada (${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)})` : 'Opcional: elige una sugerencia para ubicar el viaje en el mapa.'}
            </div>
          </div>
          <div className="field">
            <label>Destino</label>
            <input value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="Ej: Almacen Chiclin" required />
          </div>
          <div className="field">
            <label>Elementos trasladados (detalle de la mercancia)</label>
            <textarea value={elementos} onChange={(e) => setElementos(e.target.value)} placeholder="Detalle de la mercancia..." />
          </div>
          <div className="field">
            <label>Cantidad de bultos (paquetes/cajas)</label>
            <input type="number" min="0" inputMode="numeric" value={cantidadBultos} onChange={(e) => setCantidadBultos(e.target.value)} placeholder="Ej: 5" />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando...' : 'Registrar viaje'}</button>
          </div>
        </form>
      </div>
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
              <th>Hora</th><th>Chofer</th><th>Cuenta / Proyecto</th><th>Destino</th><th>Estado</th><th>Salida</th><th>Llegada</th><th>Bultos</th><th>GR</th><th>Foto</th><th>Guia</th>
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
                <td>{r.cantidad_bultos || '-'}</td>
                <td>{r.gr_firmada || '-'}</td>
                <td>{r.foto_elementos_url ? <a href={r.foto_elementos_url} target="_blank" rel="noreferrer">Ver</a> : '-'}</td>
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
  const [users, setUsers] = useState([]);
  const [editing, setEditing] = useState(null);

  const loadUsers = useCallback(() => { api.getUsers().then(setUsers).catch(() => {}); }, []);
  useEffect(() => { loadUsers(); }, [loadUsers]);

  const choferUsers = users.filter((u) => u.role === 'chofer');
  const driverIds = new Set(drivers.map((d) => Number(d.id)));
  const userByDriverId = {};
  choferUsers.forEach((u) => { if (u.driver_id) userByDriverId[Number(u.driver_id)] = u; });

  async function add(e) {
    e.preventDefault();
    setError('');
    try {
      await api.createDriver({ name, phone, vehicle, supervisor });
      setName(''); setPhone(''); setVehicle(''); setSupervisor('');
      onChange();
    } catch (err) { setError(err.message); }
  }

  async function relink(userId, driverId) {
    setError('');
    try {
      await api.updateUser(userId, { driver_id: driverId ? Number(driverId) : '' });
      loadUsers();
    } catch (err) { setError(err.message); }
  }

  async function saveDriver(patch) {
    setError('');
    try {
      await api.updateDriver(editing.id, patch);
      setEditing(null);
      onChange();
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="card">
      <div className="card-header"><h3>🚚 Choferes y accesos</h3></div>
      {error && <div className="error-msg">{error}</div>}

      <table className="simple" style={{ marginBottom: 14 }}>
        <thead><tr><th>Nombre</th><th>Telefono</th><th>Vehiculo</th><th>Supervisor</th><th>Login vinculado</th><th></th></tr></thead>
        <tbody>
          {drivers.map((d) => {
            const u = userByDriverId[Number(d.id)];
            return (
              <tr key={d.id}>
                <td>{d.name}</td><td>{d.phone}</td><td>{d.vehicle}</td><td>{d.supervisor}</td>
                <td>{u ? u.email : <span style={{ color: '#8894a6' }}>— sin login —</span>}</td>
                <td><button className="btn btn-secondary" style={{ padding: '4px 10px' }} onClick={() => setEditing(d)}>Editar</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <form onSubmit={add} className="form-row" style={{ alignItems: 'end' }}>
        <div className="field"><label>Nombre</label><input value={name} onChange={(e) => setName(e.target.value)} required /></div>
        <div className="field"><label>Telefono</label><input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div className="field"><label>Vehiculo / Movil</label><input value={vehicle} onChange={(e) => setVehicle(e.target.value)} /></div>
        <div className="field"><label>Supervisor</label><input value={supervisor} onChange={(e) => setSupervisor(e.target.value)} /></div>
        <button className="btn btn-primary" type="submit" style={{ height: 38 }}>+ Agregar chofer</button>
      </form>

      <div className="section-title" style={{ marginTop: 22 }}><span className="st-icon">🔗</span> Accesos de chofer (login → chofer)</div>
      <p style={{ color: '#8894a6', fontSize: 13, marginTop: -8 }}>
        Cada login de chofer debe apuntar a un chofer de la lista de arriba. Si ves ⚠️, ese login quedo sin chofer valido (por ejemplo si borraste el chofer). Selecciona el correcto.
      </p>
      {choferUsers.length === 0 ? (
        <div className="empty-state" style={{ padding: '16px 0' }}>No hay usuarios con rol chofer.</div>
      ) : (
        <table className="simple">
          <thead><tr><th>Login (correo)</th><th>Nombre</th><th>Chofer vinculado</th></tr></thead>
          <tbody>
            {choferUsers.map((u) => {
              const missing = u.driver_id && !driverIds.has(Number(u.driver_id));
              return (
                <tr key={u.id}>
                  <td>{u.email}</td>
                  <td>{u.name}</td>
                  <td>
                    {missing && <span title="El chofer vinculado ya no existe" style={{ color: 'var(--red)', marginRight: 6 }}>⚠️</span>}
                    <select value={missing ? '' : (u.driver_id || '')} onChange={(e) => relink(u.id, e.target.value)}>
                      <option value="">— sin asignar —</option>
                      {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}{d.vehicle ? ` (${d.vehicle})` : ''}</option>)}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {editing && <DriverEditModal driver={editing} onCancel={() => setEditing(null)} onSave={saveDriver} />}
    </div>
  );
}

function DriverEditModal({ driver, onCancel, onSave }) {
  const [name, setName] = useState(driver.name || '');
  const [phone, setPhone] = useState(driver.phone || '');
  const [vehicle, setVehicle] = useState(driver.vehicle || '');
  const [supervisor, setSupervisor] = useState(driver.supervisor || '');

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Editar chofer</h3>
        <div className="field"><label>Nombre</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="form-row">
          <div className="field"><label>Telefono</label><input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <div className="field"><label>Vehiculo / Movil</label><input value={vehicle} onChange={(e) => setVehicle(e.target.value)} /></div>
        </div>
        <div className="field"><label>Supervisor</label><input value={supervisor} onChange={(e) => setSupervisor(e.target.value)} /></div>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onCancel}>Cancelar</button>
          <button className="btn btn-primary" onClick={() => onSave({ name, phone, vehicle, supervisor })}>Guardar</button>
        </div>
      </div>
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
