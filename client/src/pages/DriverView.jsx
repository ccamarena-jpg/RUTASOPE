import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { toISODate, addDays } from '../utils/date';

const STATUS_LABEL = { pendiente: 'Pendiente', en_curso: 'En curso', completado: 'Completado', no_realizada: 'No realizada' };

export default function DriverView() {
  const [date, setDate] = useState(toISODate(new Date()));
  const [routes, setRoutes] = useState([]);
  const [error, setError] = useState('');
  const [showViaje, setShowViaje] = useState(false);

  const load = useCallback(() => {
    api.getRoutes({ date }).then(setRoutes).catch((e) => setError(e.message));
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const pendientes = routes.filter((r) => r.status === 'pendiente' || r.status === 'en_curso').length;

  return (
    <div>
      <div className="page-head">
        <h1>Mis rutas del dia {pendientes > 0 && <span className="pending-badge" title="Rutas por completar">{pendientes} por completar</span>}</h1>
        <p>Toca una parada para registrar salida, llegada, datos de entrega y adjuntar la guia.</p>
      </div>

      <div className="toolbar" style={{ marginBottom: 14, justifyContent: 'flex-end' }}>
        <button className="btn btn-primary" onClick={() => setShowViaje(true)}>+ Registrar viaje</button>
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

      {showViaje && <ViajeModal onClose={() => setShowViaje(false)} onSaved={() => { setShowViaje(false); load(); }} />}
    </div>
  );
}

function RouteCard({ route, onUpdated }) {
  const [expanded, setExpanded] = useState(false);
  const [comentario, setComentario] = useState(route.comentario_chofer || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showNoReal, setShowNoReal] = useState(false);
  const [motivoNoReal, setMotivoNoReal] = useState('');
  const [cantidadBultos, setCantidadBultos] = useState(route.cantidad_bultos || '');
  const [grFirmada, setGrFirmada] = useState(route.gr_firmada || '');
  const [tipoMovimiento, setTipoMovimiento] = useState(route.tipo_movimiento || '');
  const [elementos, setElementos] = useState(route.elementos_trasladados || '');

  async function run(fn, { collapse = false } = {}) {
    setBusy(true); setError('');
    try {
      await fn();
      if (collapse) setExpanded(false);
      onUpdated();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const marcarSalida = () => run(() => api.driverSalida(route.id, new Date().toTimeString().slice(0, 5)));
  const marcarLlegada = () => run(() => api.driverLlegada(route.id, new Date().toTimeString().slice(0, 5)), { collapse: true });
  const guardarComentario = () => run(() => api.driverComentario(route.id, comentario));

  function guardarEntrega() {
    run(() => api.driverEntrega(route.id, {
      cantidad_bultos: cantidadBultos, gr_firmada: grFirmada,
      tipo_movimiento: tipoMovimiento, elementos_trasladados: elementos,
    }), { collapse: true });
  }

  async function marcarNoRealizada() {
    if (!motivoNoReal.trim()) { setError('Indica el motivo por el que no se realizo la ruta.'); return; }
    await run(async () => {
      await api.driverNoRealizada(route.id, motivoNoReal.trim());
      setShowNoReal(false); setMotivoNoReal('');
    }, { collapse: true });
  }

  function subirFotoElementos(e) {
    const file = e.target.files[0];
    if (!file) return;
    run(() => api.driverFotoElementos(route.id, file));
  }
  function subirGuia(e) {
    const file = e.target.files[0];
    if (!file) return;
    run(() => api.driverGuia(route.id, file));
  }

  return (
    <div className="route-card">
      <button className="route-head" onClick={() => setExpanded((v) => !v)}>
        <div>
          <div className="hour">{route.hour}</div>
          <div className="destino">{route.destino}</div>
          <div className="meta">{route.account_name || 'Sin cuenta'}{route.project_name ? ` / ${route.project_name}` : ''}{route.tipo_movimiento ? ` · ${route.tipo_movimiento}` : ''}</div>
          <div className="meta">Salida: {route.hora_salida || '-'} | Llegada: {route.hora_llegada || '-'}</div>
        </div>
        <div className="route-head-right">
          <span className={`badge ${route.status}`}>{STATUS_LABEL[route.status]}</span>
          <span className="chevron">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {expanded && (
        <div className="route-body">
          {error && <div className="error-msg">{error}</div>}

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

          <div className="entrega-box">
            <div className="entrega-title">Datos de entrega</div>
            <div className="field">
              <label>Tipo de movimiento</label>
              <MovimientoPicker value={tipoMovimiento} onChange={setTipoMovimiento} />
            </div>
            <div className="field">
              <label>Elementos trasladados (detalle de la mercancia)</label>
              <textarea value={elementos} onChange={(e) => setElementos(e.target.value)} placeholder="Detalle de la mercancia..." />
            </div>
            <div className="form-row">
              <div className="field">
                <label>Cantidad de bultos (paquetes/cajas)</label>
                <input type="number" min="0" inputMode="numeric" value={cantidadBultos} onChange={(e) => setCantidadBultos(e.target.value)} placeholder="Ej: 5" />
              </div>
              <div className="field">
                <label>¿GR firmada por cliente?</label>
                <select value={grFirmada} onChange={(e) => setGrFirmada(e.target.value)}>
                  <option value="">Seleccionar...</option>
                  <option value="Si">Si</option>
                  <option value="No">No</option>
                  <option value="Pendiente">Pendiente</option>
                </select>
              </div>
            </div>
            <div className="actions">
              <button className="btn btn-primary" disabled={busy} onClick={guardarEntrega}>Guardar datos de entrega</button>
            </div>

            <div className="actions" style={{ marginTop: 10 }}>
              <label className="btn btn-secondary" style={{ margin: 0 }}>
                Foto de elementos entregados/recogidos
                <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={subirFotoElementos} disabled={busy} />
              </label>
            </div>
            {route.foto_elementos_url && (
              <div className="file-info">Foto de elementos: <a href={route.foto_elementos_url} target="_blank" rel="noreferrer">ver foto</a></div>
            )}
          </div>

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
          {route.guia_url && (
            <div className="file-info">Cargo adjunto: <a href={route.guia_url} target="_blank" rel="noreferrer">ver archivo</a></div>
          )}
        </div>
      )}
    </div>
  );
}

// Selector de tipo de movimiento (Entrega / Recojo), permite uno o ambos.
function MovimientoPicker({ value, onChange }) {
  const set = new Set((value || '').split(',').map((s) => s.trim()).filter(Boolean));
  function toggle(opt) {
    const next = new Set(set);
    if (next.has(opt)) next.delete(opt); else next.add(opt);
    onChange(['Entrega', 'Recojo'].filter((o) => next.has(o)).join(', '));
  }
  return (
    <div className="check-row">
      {['Entrega', 'Recojo'].map((opt) => (
        <label key={opt} className={`check-pill ${set.has(opt) ? 'on' : ''}`}>
          <input type="checkbox" checked={set.has(opt)} onChange={() => toggle(opt)} />
          {opt}
        </label>
      ))}
    </div>
  );
}

function ViajeModal({ onClose, onSaved }) {
  const [tipoMovimiento, setTipoMovimiento] = useState('');
  const [destino, setDestino] = useState('');
  const [elementos, setElementos] = useState('');
  const [cantidadBultos, setCantidadBultos] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!destino.trim()) { setError('Indica el destino del viaje'); return; }
    setSaving(true); setError('');
    try {
      await api.registrarViaje({
        destino: destino.trim(), tipo_movimiento: tipoMovimiento,
        elementos_trasladados: elementos, cantidad_bultos: cantidadBultos,
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
            <label>Tipo de movimiento</label>
            <MovimientoPicker value={tipoMovimiento} onChange={setTipoMovimiento} />
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
