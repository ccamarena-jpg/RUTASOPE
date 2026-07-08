import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { toISODate, addDays } from '../utils/date';

const STATUS_LABEL = { pendiente: 'Pendiente', en_curso: 'En curso', completado: 'Completado', no_realizada: 'No realizada' };

export default function DriverView() {
  const [date, setDate] = useState(toISODate(new Date()));
  const [routes, setRoutes] = useState([]);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.getRoutes({ date }).then(setRoutes).catch((e) => setError(e.message));
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const pendientes = routes.filter((r) => r.status === 'pendiente' || r.status === 'en_curso').length;

  return (
    <div>
      <div className="page-head">
        <h1>Mis rutas del dia {pendientes > 0 && <span className="pending-badge" title="Rutas por completar">{pendientes} por completar</span>}</h1>
        <p>Marca tu hora de salida y llegada, deja comentarios y adjunta la guia de remision.</p>
      </div>
      <div className="driver-date-nav">
        <button onClick={() => setDate(toISODate(addDays(new Date(date + 'T00:00:00'), -1)))}>&larr;</button>
        <span className="date-label">{new Date(date + 'T00:00:00').toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        <button onClick={() => setDate(toISODate(addDays(new Date(date + 'T00:00:00'), 1)))}>&rarr;</button>
      </div>
      {error && <div className="error-msg">{error}</div>}
      {routes.length === 0 ? (
        <div className="empty-state">No tienes rutas asignadas para este dia.</div>
      ) : (
        routes.map((r) => <RouteCard key={r.id} route={r} onUpdated={load} />)
      )}
    </div>
  );
}

function RouteCard({ route, onUpdated }) {
  const [comentario, setComentario] = useState(route.comentario_chofer || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showNoReal, setShowNoReal] = useState(false);
  const [motivoNoReal, setMotivoNoReal] = useState('');

  async function marcarSalida() {
    setBusy(true); setError('');
    try {
      await api.driverSalida(route.id, new Date().toTimeString().slice(0, 5));
      onUpdated();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function marcarLlegada() {
    setBusy(true); setError('');
    try {
      await api.driverLlegada(route.id, new Date().toTimeString().slice(0, 5));
      onUpdated();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function guardarComentario() {
    setBusy(true); setError('');
    try {
      await api.driverComentario(route.id, comentario);
      onUpdated();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function marcarNoRealizada() {
    if (!motivoNoReal.trim()) { setError('Indica el motivo por el que no se realizo la ruta.'); return; }
    setBusy(true); setError('');
    try {
      await api.driverNoRealizada(route.id, motivoNoReal.trim());
      setShowNoReal(false); setMotivoNoReal('');
      onUpdated();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function subirGuia(e) {
    const file = e.target.files[0];
    if (!file) return;
    setBusy(true); setError('');
    try {
      await api.driverGuia(route.id, file);
      onUpdated();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="route-card">
      <div className="top-row">
        <div>
          <div className="hour">{route.hour}</div>
          <div className="destino">{route.destino}</div>
          <div className="meta">{route.account_name}{route.project_name ? ` / ${route.project_name}` : ''}{route.motivo ? ` - ${route.motivo}` : ''}</div>
        </div>
        <span className={`badge ${route.status}`}>{STATUS_LABEL[route.status]}</span>
      </div>

      {error && <div className="error-msg">{error}</div>}

      <div className="meta">
        Salida: {route.hora_salida || '-'} &nbsp;|&nbsp; Llegada: {route.hora_llegada || '-'}
      </div>

      {route.status === 'no_realizada' && route.motivo_no_realizada && (
        <div className="meta" style={{ color: 'var(--red)' }}>No realizada: {route.motivo_no_realizada}</div>
      )}

      <div className="actions">
        {route.status === 'pendiente' && (
          <button className="btn btn-primary" disabled={busy} onClick={marcarSalida}>Marcar hora de salida</button>
        )}
        {route.status === 'en_curso' && (
          <button className="btn btn-success" disabled={busy} onClick={marcarLlegada}>Marcar hora de llegada</button>
        )}
        {(route.status === 'pendiente' || route.status === 'en_curso') && !showNoReal && (
          <button className="btn btn-secondary" disabled={busy} onClick={() => setShowNoReal(true)}>Marcar no realizada</button>
        )}
      </div>

      {showNoReal && (
        <div className="no-real-box">
          <textarea
            placeholder="Motivo por el que no se realizo (obligatorio): ej. cliente cerrado, direccion incorrecta..."
            value={motivoNoReal}
            onChange={(e) => setMotivoNoReal(e.target.value)}
          />
          <div className="actions">
            <button className="btn btn-danger" disabled={busy} onClick={marcarNoRealizada}>Confirmar no realizada</button>
            <button className="btn btn-secondary" disabled={busy} onClick={() => { setShowNoReal(false); setMotivoNoReal(''); setError(''); }}>Cancelar</button>
          </div>
        </div>
      )}

      <textarea
        placeholder="Comentarios de la visita..."
        value={comentario}
        onChange={(e) => setComentario(e.target.value)}
      />
      <div className="actions">
        <button className="btn btn-secondary" disabled={busy} onClick={guardarComentario}>Guardar comentario</button>
      </div>

      <div className="actions" style={{ marginTop: 10 }}>
        <label className="btn btn-secondary" style={{ margin: 0 }}>
          Adjuntar guia de remision
          <input type="file" accept="image/*,.pdf" style={{ display: 'none' }} onChange={subirGuia} disabled={busy} />
        </label>
      </div>
      {route.guia_remision_filename && (
        <div className="file-info">
          Cargo adjunto: <a href={`/uploads/${route.guia_remision_filename}`} target="_blank" rel="noreferrer">ver archivo</a>
        </div>
      )}
    </div>
  );
}
