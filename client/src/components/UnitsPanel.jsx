import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { toISODate } from '../utils/date';
import { useCachedResource } from '../utils/useCachedResource';

// ====== Semaforo de fechas / km ======
// Umbral en dias para marcar "por vencer".
const UMBRAL_DIAS = 30;
// Umbral en km para avisar del proximo mantenimiento.
const UMBRAL_KM = 1000;

function diasHasta(fechaISO) {
  if (!fechaISO) return null;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const d = new Date(String(fechaISO).slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  return Math.round((d - hoy) / 86400000);
}

function nivelFecha(fechaISO) {
  const dias = diasHasta(fechaISO);
  if (dias === null) return 'none';
  if (dias < 0) return 'vencido';
  if (dias <= UMBRAL_DIAS) return 'proximo';
  return 'ok';
}

function textoFecha(fechaISO) {
  const dias = diasHasta(fechaISO);
  if (dias === null) return 'Sin fecha';
  if (dias < 0) return `Vencido hace ${Math.abs(dias)} d`;
  if (dias === 0) return 'Vence hoy';
  return `En ${dias} d`;
}

function nivelKm(unit) {
  if (unit.km_proximo_mant === '' || unit.km_proximo_mant == null) return 'none';
  if (unit.km_actual === '' || unit.km_actual == null) return 'none';
  const restante = Number(unit.km_proximo_mant) - Number(unit.km_actual);
  if (restante <= 0) return 'vencido';
  if (restante <= UMBRAL_KM) return 'proximo';
  return 'ok';
}

// Los controles de fecha de una unidad, en orden de aparicion.
const CONTROLES = [
  { key: 'rev_tt_venc', label: 'Rev. TT Audit', short: 'TT Audit' },
  { key: 'mant_euro_venc', label: 'Mant. Eurorenting', short: 'Eurorenting' },
  { key: 'soat_venc', label: 'SOAT', short: 'SOAT' },
  { key: 'rtv_venc', label: 'Rev. tecnica (MTC)', short: 'Rev. tecnica' },
  { key: 'poliza_venc', label: 'Poliza / seguro', short: 'Poliza' },
];

const PEOR = { none: 0, ok: 1, proximo: 2, vencido: 3 };
function peorNivel(unit) {
  let peor = 'ok';
  CONTROLES.forEach((c) => { if (PEOR[nivelFecha(unit[c.key])] > PEOR[peor]) peor = nivelFecha(unit[c.key]); });
  const nk = nivelKm(unit);
  if (PEOR[nk] > PEOR[peor]) peor = nk;
  return peor;
}

const ESTADO_LABEL = { activa: 'Activa', inactiva: 'Inactiva', taller: 'En taller' };

// ====== Vista principal ======
export default function UnitsPanel() {
  const [selectedId, setSelectedId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  // Cache SWR: la lista de unidades y el catalogo de choferes ya no se recargan en
  // blanco al entrar/salir de esta pestana.
  const { data: units = [], error: unitsError, revalidate: load } = useCachedResource(
    'units', () => api.getUnits(), { initialData: [] },
  );
  const { data: drivers = [] } = useCachedResource('drivers', () => api.getDrivers(), { initialData: [] });
  const error = unitsError ? (unitsError.message || 'No se pudieron cargar las unidades.') : '';

  if (selectedId) {
    return (
      <UnitDetail
        unitId={selectedId}
        drivers={drivers}
        onBack={() => { setSelectedId(null); load(); }}
      />
    );
  }

  return (
    <div className="card">
      <div className="card-header">
        <h3>🚐 Unidades moviles</h3>
        <div className="toolbar">
          <button className="btn btn-secondary" onClick={load}>Actualizar</button>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Nueva unidad</button>
        </div>
      </div>
      {error && <div className="error-msg">{error}</div>}

      {units.length === 0 ? (
        <div className="empty-state">Aun no hay unidades registradas. Agrega la primera con “+ Nueva unidad”.</div>
      ) : (
        <div className="fleet-grid">
          {units.map((u) => {
            const peor = peorNivel(u);
            const alertas = CONTROLES
              .map((c) => ({ c, nivel: nivelFecha(u[c.key]) }))
              .filter((x) => x.nivel === 'vencido' || x.nivel === 'proximo');
            const nk = nivelKm(u);
            return (
              <div key={u.id} className={`fleet-card ${peor}`} onClick={() => setSelectedId(u.id)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div className="placa">{u.placa || '(sin placa)'}</div>
                    <div className="modelo">{[u.marca, u.modelo, u.anio].filter(Boolean).join(' · ') || 'Sin datos de vehiculo'}</div>
                  </div>
                  <span className={`sem-pill ${peor}`}>{peor === 'vencido' ? 'Vencido' : peor === 'proximo' ? 'Por vencer' : peor === 'ok' ? 'Al dia' : 'Sin fechas'}</span>
                </div>
                <div className="chofer">👤 {u.driver_name || <span style={{ color: '#8894a6' }}>Sin chofer asignado</span>}</div>
                <div className="km">
                  {u.estado && u.estado !== 'activa' ? `${ESTADO_LABEL[u.estado] || u.estado} · ` : ''}
                  Km actual: {u.km_actual !== '' && u.km_actual != null ? Number(u.km_actual).toLocaleString('es-PE') : '—'}
                </div>
                {(alertas.length > 0 || nk === 'vencido' || nk === 'proximo') && (
                  <div className="alerts">
                    {alertas.map(({ c, nivel }) => (
                      <span key={c.key} className={`sem-pill ${nivel}`}><span className={`sem-dot ${nivel}`} />{c.short}: {textoFecha(u[c.key])}</span>
                    ))}
                    {(nk === 'vencido' || nk === 'proximo') && (
                      <span className={`sem-pill ${nk}`}><span className={`sem-dot ${nk}`} />Mant. por km</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showCreate && (
        <UnitFormModal
          drivers={drivers}
          onClose={() => setShowCreate(false)}
          onSaved={(created) => { setShowCreate(false); load(); if (created && created.unit) setSelectedId(created.unit.id); }}
        />
      )}
    </div>
  );
}

// ====== Detalle / ficha de una unidad ======
function UnitDetail({ unitId, drivers, onBack }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [showEdit, setShowEdit] = useState(false);

  const load = useCallback(() => {
    api.getUnit(unitId).then(setData).catch((e) => setError(e.message));
  }, [unitId]);
  useEffect(() => { load(); }, [load]);

  if (!data) return <div className="card"><button className="btn btn-secondary" onClick={onBack}>← Volver</button>{error && <div className="error-msg" style={{ marginTop: 12 }}>{error}</div>}</div>;

  const u = data.unit;

  async function eliminar() {
    if (!confirm(`¿Eliminar la unidad ${u.placa}? Se borraran tambien sus papeletas y kilometraje.`)) return;
    try { await api.deleteUnit(unitId); onBack(); } catch (e) { setError(e.message); }
  }

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={onBack}>← Volver</button>
            <h3 style={{ fontFamily: 'var(--serif)', fontSize: 24, letterSpacing: 1 }}>{u.placa}</h3>
            <span className={`sem-pill ${peorNivel(u)}`}>{peorNivel(u) === 'vencido' ? 'Vencido' : peorNivel(u) === 'proximo' ? 'Por vencer' : 'Al dia'}</span>
          </div>
          <div className="toolbar">
            <button className="btn btn-secondary" onClick={() => setShowEdit(true)}>Editar ficha</button>
            <button className="btn btn-danger" onClick={eliminar}>Eliminar</button>
          </div>
        </div>
        {error && <div className="error-msg">{error}</div>}

        <div className="ficha-grid">
          <div className="ficha-item"><div className="lbl">Vehiculo</div><div className="val">{[u.marca, u.modelo].filter(Boolean).join(' ') || '—'}</div><div className="sub" style={{ color: 'var(--text-soft)' }}>{u.anio ? `Año ${u.anio}` : ''}</div></div>
          <div className="ficha-item"><div className="lbl">Chofer asignado</div><div className="val">{u.driver_name || '—'}</div></div>
          <div className="ficha-item"><div className="lbl">Estado</div><div className="val">{ESTADO_LABEL[u.estado] || u.estado || '—'}</div></div>
          <div className="ficha-item"><div className="lbl">Km actual</div><div className="val">{u.km_actual !== '' && u.km_actual != null ? Number(u.km_actual).toLocaleString('es-PE') : '—'}</div>
            <div className="sub"><KmMantEstado unit={u} /></div>
          </div>
          {CONTROLES.map((c) => {
            const nivel = nivelFecha(u[c.key]);
            return (
              <div key={c.key} className="ficha-item">
                <div className="lbl">{c.label}</div>
                <div className="val">{u[c.key] ? String(u[c.key]).slice(0, 10) : '—'}</div>
                <div className="sub"><span className={`sem-pill ${nivel}`}><span className={`sem-dot ${nivel}`} />{textoFecha(u[c.key])}</span></div>
              </div>
            );
          })}
          <div className="ficha-item"><div className="lbl">Tarjeta de propiedad</div><div className="val" style={{ fontSize: 13 }}>{u.tarjeta_propiedad || '—'}</div></div>
        </div>
        {u.notas && <p style={{ color: 'var(--text-soft)', fontSize: 13.5, marginTop: 14 }}><b>Notas:</b> {u.notas}</p>}
      </div>

      <MaterialesCard unitId={unitId} materiales={data.materiales} onSaved={load} />
      <PapeletasCard unitId={unitId} papeletas={data.papeletas} drivers={drivers} onChanged={load} />
      <KmCard unitId={unitId} km={data.km} unit={u} onChanged={load} />

      {showEdit && (
        <UnitFormModal
          unit={u}
          drivers={drivers}
          onClose={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); load(); }}
        />
      )}
    </div>
  );
}

function KmMantEstado({ unit }) {
  if (unit.km_proximo_mant === '' || unit.km_proximo_mant == null) return <span style={{ color: 'var(--text-soft)' }}>Sin intervalo de mant.</span>;
  const nivel = nivelKm(unit);
  const restante = (unit.km_actual !== '' && unit.km_actual != null) ? Number(unit.km_proximo_mant) - Number(unit.km_actual) : null;
  return (
    <span className={`sem-pill ${nivel}`}>
      <span className={`sem-dot ${nivel}`} />
      Prox. mant. {Number(unit.km_proximo_mant).toLocaleString('es-PE')} km
      {restante != null && (restante <= 0 ? ` (excedido ${Math.abs(restante).toLocaleString('es-PE')})` : ` (faltan ${restante.toLocaleString('es-PE')})`)}
    </span>
  );
}

// ====== Materiales obligatorios ======
function MaterialesCard({ unitId, materiales, onSaved }) {
  const [items, setItems] = useState(materiales.map((m) => ({ ...m, tiene: Number(m.tiene) === 1 })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [nuevo, setNuevo] = useState('');

  useEffect(() => { setItems(materiales.map((m) => ({ ...m, tiene: Number(m.tiene) === 1 }))); }, [materiales]);

  function setItem(i, patch) { setItems((arr) => arr.map((it, idx) => idx === i ? { ...it, ...patch } : it)); }
  function addItem() { if (!nuevo.trim()) return; setItems((arr) => [...arr, { material: nuevo.trim(), tiene: true, vencimiento: '', nota: '' }]); setNuevo(''); }
  function removeItem(i) { setItems((arr) => arr.filter((_, idx) => idx !== i)); }

  async function guardar() {
    setSaving(true); setError('');
    try {
      await api.saveMateriales(unitId, items.map((it) => ({ material: it.material, tiene: it.tiene ? 1 : 0, vencimiento: it.vencimiento || '', nota: it.nota || '' })));
      onSaved();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  const faltan = items.filter((it) => !it.tiene).length;
  const vencidos = items.filter((it) => it.vencimiento && nivelFecha(it.vencimiento) === 'vencido').length;

  return (
    <div className="card">
      <div className="card-header">
        <h3>🧰 Materiales obligatorios</h3>
        <div className="toolbar">
          {faltan > 0 && <span className="sem-pill vencido">{faltan} falta{faltan > 1 ? 'n' : ''}</span>}
          {vencidos > 0 && <span className="sem-pill vencido">{vencidos} vencido{vencidos > 1 ? 's' : ''}</span>}
          {faltan === 0 && vencidos === 0 && <span className="sem-pill ok">Completo</span>}
          <button className="btn btn-primary" onClick={guardar} disabled={saving}>{saving ? 'Guardando...' : 'Guardar checklist'}</button>
        </div>
      </div>
      {error && <div className="error-msg">{error}</div>}
      <table className="simple mat-table">
        <thead><tr><th>Material</th><th>¿Tiene?</th><th>Vence (opcional)</th><th>Nota</th><th></th></tr></thead>
        <tbody>
          {items.map((it, i) => {
            const nivel = it.vencimiento ? nivelFecha(it.vencimiento) : 'none';
            return (
              <tr key={i}>
                <td>{it.material}</td>
                <td>
                  <label className={`check-pill ${it.tiene ? 'on' : ''}`}>
                    <input type="checkbox" checked={it.tiene} onChange={(e) => setItem(i, { tiene: e.target.checked })} />
                    {it.tiene ? 'Sí' : 'No'}
                  </label>
                </td>
                <td>
                  <input className="venc-in" type="date" value={it.vencimiento ? String(it.vencimiento).slice(0, 10) : ''} onChange={(e) => setItem(i, { vencimiento: e.target.value })} />
                  {it.vencimiento && <div style={{ marginTop: 4 }}><span className={`sem-pill ${nivel}`}>{textoFecha(it.vencimiento)}</span></div>}
                </td>
                <td><input value={it.nota || ''} onChange={(e) => setItem(i, { nota: e.target.value })} placeholder="—" style={{ width: '100%' }} /></td>
                <td><button className="btn btn-secondary" style={{ padding: '4px 10px' }} onClick={() => removeItem(i)}>Quitar</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="toolbar" style={{ marginTop: 12 }}>
        <input placeholder="Agregar material (ej: Llave de ruedas)" value={nuevo} onChange={(e) => setNuevo(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }} style={{ minWidth: 260 }} />
        <button className="btn btn-secondary" onClick={addItem}>+ Agregar material</button>
      </div>
    </div>
  );
}

// ====== Papeletas ======
const PAPELETA_ESTADO = { pendiente: 'Pendiente', pagada: 'Pagada' };

function PapeletasCard({ unitId, papeletas, drivers, onChanged }) {
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');

  const totalPend = papeletas.filter((p) => p.estado !== 'pagada').reduce((s, p) => s + (Number(p.monto) || 0), 0);

  async function togglePagada(p) {
    setError('');
    try { await api.updatePapeleta(unitId, p.id, { estado: p.estado === 'pagada' ? 'pendiente' : 'pagada' }); onChanged(); } catch (e) { setError(e.message); }
  }
  async function eliminar(p) {
    if (!confirm('¿Eliminar esta papeleta?')) return;
    setError('');
    try { await api.deletePapeleta(unitId, p.id); onChanged(); } catch (e) { setError(e.message); }
  }

  return (
    <div className="card">
      <div className="card-header">
        <h3>📄 Papeletas</h3>
        <div className="toolbar">
          {totalPend > 0 && <span className="sem-pill proximo">Pendiente: S/ {totalPend.toFixed(2)}</span>}
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>+ Registrar papeleta</button>
        </div>
      </div>
      {error && <div className="error-msg">{error}</div>}
      {papeletas.length === 0 ? (
        <div className="empty-state" style={{ padding: '24px 0' }}>Sin papeletas registradas.</div>
      ) : (
        <table className="simple">
          <thead><tr><th>Fecha</th><th>N°</th><th>Infracción</th><th>Chofer</th><th>Monto</th><th>Estado</th><th>Foto</th><th></th></tr></thead>
          <tbody>
            {papeletas.map((p) => (
              <tr key={p.id}>
                <td>{p.fecha ? String(p.fecha).slice(0, 10) : '—'}</td>
                <td>{p.papeleta_num || '—'}</td>
                <td>{p.infraccion || '—'}</td>
                <td>{p.driver_name || '—'}</td>
                <td>{(p.monto != null && p.monto !== '') ? `S/ ${Number(p.monto).toFixed(2)}` : '—'}</td>
                <td>
                  <button className={`sem-pill ${p.estado === 'pagada' ? 'ok' : 'proximo'}`} style={{ border: 'none', cursor: 'pointer' }} onClick={() => togglePagada(p)} title="Cambiar estado">
                    {PAPELETA_ESTADO[p.estado] || 'Pendiente'}
                  </button>
                </td>
                <td>{p.foto_url ? <a href={p.foto_url} target="_blank" rel="noreferrer">Ver</a> : '—'}</td>
                <td><button className="btn btn-secondary" style={{ padding: '4px 10px' }} onClick={() => eliminar(p)}>Eliminar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {showForm && (
        <PapeletaFormModal
          unitId={unitId}
          drivers={drivers}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); onChanged(); }}
        />
      )}
    </div>
  );
}

function PapeletaFormModal({ unitId, drivers, onClose, onSaved }) {
  const [fecha, setFecha] = useState(toISODate(new Date()));
  const [num, setNum] = useState('');
  const [infraccion, setInfraccion] = useState('');
  const [monto, setMonto] = useState('');
  const [estado, setEstado] = useState('pendiente');
  const [driverId, setDriverId] = useState('');
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      await api.addPapeleta(unitId, { fecha, papeleta_num: num, infraccion, monto, estado, driver_id: driverId || '' }, file);
      onSaved();
    } catch (err) { setError(err.message); setSaving(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Registrar papeleta</h3>
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={submit}>
          <div className="form-row">
            <div className="field"><label>Fecha</label><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required /></div>
            <div className="field"><label>N° de papeleta</label><input value={num} onChange={(e) => setNum(e.target.value)} /></div>
          </div>
          <div className="field"><label>Infracción</label><input value={infraccion} onChange={(e) => setInfraccion(e.target.value)} placeholder="Ej: Exceso de velocidad" /></div>
          <div className="form-row">
            <div className="field"><label>Monto (S/)</label><input type="number" step="0.01" value={monto} onChange={(e) => setMonto(e.target.value)} /></div>
            <div className="field"><label>Estado</label>
              <select value={estado} onChange={(e) => setEstado(e.target.value)}>
                <option value="pendiente">Pendiente</option>
                <option value="pagada">Pagada</option>
              </select>
            </div>
          </div>
          <div className="field"><label>Chofer responsable</label>
            <select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
              <option value="">— Sin asignar —</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}{d.vehicle ? ` (${d.vehicle})` : ''}</option>)}
            </select>
          </div>
          <div className="field"><label>Foto de la papeleta (opcional)</label><input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files[0] || null)} /></div>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ====== Kilometraje ======
function KmCard({ unitId, km, unit, onChanged }) {
  const [fecha, setFecha] = useState(toISODate(new Date()));
  const [valor, setValor] = useState('');
  const [nota, setNota] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function agregar(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try { await api.addKm(unitId, { fecha, km: valor, nota }); setValor(''); setNota(''); onChanged(); } catch (err) { setError(err.message); } finally { setSaving(false); }
  }
  async function eliminar(k) {
    if (!confirm('¿Eliminar esta lectura de kilometraje?')) return;
    setError('');
    try { await api.deleteKm(unitId, k.id); onChanged(); } catch (err) { setError(err.message); }
  }

  return (
    <div className="card">
      <div className="card-header">
        <h3>📟 Kilometraje</h3>
        <KmMantEstado unit={unit} />
      </div>
      {error && <div className="error-msg">{error}</div>}
      <form onSubmit={agregar} className="form-row" style={{ alignItems: 'end', marginBottom: 16 }}>
        <div className="field"><label>Fecha</label><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required /></div>
        <div className="field"><label>Kilometraje</label><input type="number" value={valor} onChange={(e) => setValor(e.target.value)} required placeholder="Ej: 45200" /></div>
        <div className="field"><label>Nota</label><input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Opcional" /></div>
        <button className="btn btn-primary" type="submit" disabled={saving} style={{ height: 38 }}>{saving ? '...' : '+ Registrar'}</button>
      </form>
      {km.length === 0 ? (
        <div className="empty-state" style={{ padding: '20px 0' }}>Sin lecturas de kilometraje.</div>
      ) : (
        <table className="simple">
          <thead><tr><th>Fecha</th><th>Km</th><th>Nota</th><th>Registró</th><th></th></tr></thead>
          <tbody>
            {km.map((k) => (
              <tr key={k.id}>
                <td>{k.fecha ? String(k.fecha).slice(0, 10) : '—'}</td>
                <td>{Number(k.km).toLocaleString('es-PE')}</td>
                <td>{k.nota || '—'}</td>
                <td style={{ fontSize: 12, color: 'var(--text-soft)' }}>{k.created_by || '—'}</td>
                <td><button className="btn btn-secondary" style={{ padding: '4px 10px' }} onClick={() => eliminar(k)}>Eliminar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ====== Formulario de ficha (crear / editar) ======
function UnitFormModal({ unit, drivers, onClose, onSaved }) {
  const isEdit = !!unit;
  const [f, setF] = useState({
    placa: unit?.placa || '', marca: unit?.marca || '', modelo: unit?.modelo || '', anio: unit?.anio || '',
    driver_id: unit?.driver_id || '', estado: unit?.estado || 'activa',
    rev_tt_venc: unit?.rev_tt_venc ? String(unit.rev_tt_venc).slice(0, 10) : '',
    mant_euro_venc: unit?.mant_euro_venc ? String(unit.mant_euro_venc).slice(0, 10) : '',
    soat_venc: unit?.soat_venc ? String(unit.soat_venc).slice(0, 10) : '',
    rtv_venc: unit?.rtv_venc ? String(unit.rtv_venc).slice(0, 10) : '',
    poliza_venc: unit?.poliza_venc ? String(unit.poliza_venc).slice(0, 10) : '',
    tarjeta_propiedad: unit?.tarjeta_propiedad || '',
    km_ultimo_mant: unit?.km_ultimo_mant || '', km_intervalo_mant: unit?.km_intervalo_mant || '',
    notas: unit?.notas || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const payload = { ...f, driver_id: f.driver_id || '' };
      const res = isEdit ? await api.updateUnit(unit.id, payload) : await api.createUnit(payload);
      onSaved(res);
    } catch (err) { setError(err.message); setSaving(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <h3>{isEdit ? 'Editar ficha de unidad' : 'Nueva unidad móvil'}</h3>
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={submit}>
          <div className="form-row">
            <div className="field"><label>Placa *</label><input value={f.placa} onChange={set('placa')} required placeholder="Ej: ABC-123" /></div>
            <div className="field"><label>Estado</label>
              <select value={f.estado} onChange={set('estado')}>
                <option value="activa">Activa</option>
                <option value="taller">En taller</option>
                <option value="inactiva">Inactiva</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="field"><label>Marca</label><input value={f.marca} onChange={set('marca')} placeholder="Ej: Toyota" /></div>
            <div className="field"><label>Modelo</label><input value={f.modelo} onChange={set('modelo')} placeholder="Ej: Hilux" /></div>
          </div>
          <div className="form-row">
            <div className="field"><label>Año</label><input type="number" value={f.anio} onChange={set('anio')} placeholder="Ej: 2021" /></div>
            <div className="field"><label>Chofer asignado</label>
              <select value={f.driver_id} onChange={set('driver_id')}>
                <option value="">— Sin asignar —</option>
                {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}{d.vehicle ? ` (${d.vehicle})` : ''}</option>)}
              </select>
            </div>
          </div>

          <div className="section-title" style={{ marginTop: 8 }}><span className="st-icon">📅</span> Fechas de control</div>
          <div className="form-row">
            <div className="field"><label>Revisión TT Audit</label><input type="date" value={f.rev_tt_venc} onChange={set('rev_tt_venc')} /></div>
            <div className="field"><label>Mantenimiento Eurorenting</label><input type="date" value={f.mant_euro_venc} onChange={set('mant_euro_venc')} /></div>
          </div>
          <div className="form-row">
            <div className="field"><label>SOAT (vence)</label><input type="date" value={f.soat_venc} onChange={set('soat_venc')} /></div>
            <div className="field"><label>Revisión técnica MTC (vence)</label><input type="date" value={f.rtv_venc} onChange={set('rtv_venc')} /></div>
          </div>
          <div className="form-row">
            <div className="field"><label>Póliza / seguro (vence)</label><input type="date" value={f.poliza_venc} onChange={set('poliza_venc')} /></div>
            <div className="field"><label>Tarjeta de propiedad (N°/nota)</label><input value={f.tarjeta_propiedad} onChange={set('tarjeta_propiedad')} /></div>
          </div>

          <div className="section-title" style={{ marginTop: 8 }}><span className="st-icon">📟</span> Mantenimiento por kilometraje</div>
          <div className="form-row">
            <div className="field"><label>Km del último mantenimiento</label><input type="number" value={f.km_ultimo_mant} onChange={set('km_ultimo_mant')} placeholder="Ej: 40000" /></div>
            <div className="field"><label>Intervalo (km)</label><input type="number" value={f.km_intervalo_mant} onChange={set('km_intervalo_mant')} placeholder="Ej: 10000" /></div>
          </div>

          <div className="field"><label>Notas</label><textarea value={f.notas} onChange={set('notas')} style={{ width: '100%', minHeight: 60 }} /></div>

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando...' : (isEdit ? 'Guardar cambios' : 'Crear unidad')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
