import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { HOURS } from '../utils/date';

export default function RouteFormModal({ initial, drivers, accounts, onClose, onSaved, onDeleted }) {
  const isEdit = Boolean(initial?.id);
  const [date, setDate] = useState(initial?.date || '');
  const [hour, setHour] = useState(initial?.hour || HOURS[0]);
  const [driverId, setDriverId] = useState(initial?.driver_id || drivers[0]?.id || '');
  const [accountId, setAccountId] = useState(initial?.account_id || accounts[0]?.id || '');
  const [projectId, setProjectId] = useState(initial?.project_id || '');
  const [projects, setProjects] = useState([]);
  const [destino, setDestino] = useState(initial?.destino || '');
  const [motivo, setMotivo] = useState(initial?.motivo || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!accountId) { setProjects([]); return; }
    api.getProjects(accountId).then(setProjects).catch(() => setProjects([]));
  }, [accountId]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!date || !hour || !driverId || !accountId || !destino) {
      setError('Completa fecha, hora, chofer, cuenta y destino');
      return;
    }
    setSaving(true);
    try {
      const payload = { date, hour, driver_id: Number(driverId), account_id: Number(accountId), project_id: projectId ? Number(projectId) : null, destino, motivo };
      if (isEdit) await api.updateRoute(initial.id, payload);
      else await api.createRoute(payload);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Eliminar esta ruta?')) return;
    try {
      await api.deleteRoute(initial.id);
      onDeleted();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{isEdit ? 'Editar ruta' : 'Nueva ruta'}</h3>
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="field">
              <label>Fecha</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div className="field">
              <label>Hora</label>
              <select value={hour} onChange={(e) => setHour(e.target.value)}>
                {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
          </div>
          <div className="field">
            <label>Chofer</label>
            <select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.vehicle})</option>)}
            </select>
          </div>
          <div className="form-row">
            <div className="field">
              <label>Cuenta</label>
              <select value={accountId} onChange={(e) => { setAccountId(e.target.value); setProjectId(''); }}>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Proyecto</label>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">Sin proyecto</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div className="field">
            <label>Destino</label>
            <input value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="Ej: Almacen Chiclin - Cliente Alicorp SJL" required />
          </div>
          <div className="field">
            <label>Motivo / detalle de la visita</label>
            <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} placeholder="Ej: Entrega de pedido #4521" />
          </div>
          <div className="modal-actions">
            {isEdit && <button type="button" className="btn btn-danger" onClick={handleDelete}>Eliminar</button>}
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
