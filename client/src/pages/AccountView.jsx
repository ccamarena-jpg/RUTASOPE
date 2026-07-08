import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { toISODate } from '../utils/date';

const STATUS_LABEL = { pendiente: 'Pendiente', en_curso: 'En curso', completado: 'Completado' };

export default function AccountView() {
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

  return (
    <div className="card">
      <div className="card-header">
        <h2 style={{ fontSize: 16 }}>Seguimiento de rutas en tiempo real</h2>
        <div className="toolbar">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="todos">Todos los estados</option>
            <option value="pendiente">Pendiente</option>
            <option value="en_curso">En curso</option>
            <option value="completado">Completado</option>
          </select>
          <button className="btn btn-secondary" onClick={load}>Actualizar</button>
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
                <div className="meta">Chofer: {r.driver_name} {r.project_name ? `| Proyecto: ${r.project_name}` : ''}</div>
                {r.motivo && <div className="meta">{r.motivo}</div>}
              </div>
              <span className={`badge ${r.status}`}>{STATUS_LABEL[r.status]}</span>
            </div>
            <div className="meta">Salida: {r.hora_salida || '-'} &nbsp;|&nbsp; Llegada: {r.hora_llegada || '-'}</div>
            {r.comentario_chofer && <div className="meta">Comentario del chofer: {r.comentario_chofer}</div>}
            {r.guia_remision_filename && (
              <div className="file-info">
                Guia de remision: <a href={`/uploads/${r.guia_remision_filename}`} target="_blank" rel="noreferrer">ver documento</a>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
