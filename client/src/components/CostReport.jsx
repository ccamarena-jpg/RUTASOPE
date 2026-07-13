import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { toISODate } from '../utils/date';

const firstOfMonth = (d) => toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
const lastOfMonth = (d) => toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0));

export default function CostReport() {
  const today = new Date();
  const [from, setFrom] = useState(firstOfMonth(today));
  const [to, setTo] = useState(lastOfMonth(today));
  const [routes, setRoutes] = useState([]);
  const [drivers, setDrivers] = useState([]);

  const load = useCallback(() => {
    api.getRoutes({ from, to }).then(setRoutes).catch(() => setRoutes([]));
    api.getDrivers().then(setDrivers).catch(() => setDrivers([]));
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const m = useMemo(() => {
    const provIds = new Set(drivers.filter((d) => Number(d.es_proveedor) === 1).map((d) => Number(d.id)));
    const nameById = {};
    drivers.forEach((d) => { nameById[Number(d.id)] = d.name; });
    const porProveedor = {};
    const porChofer = {};
    let totalCosto = 0;
    routes.forEach((r) => {
      const did = Number(r.driver_id);
      const nombre = r.driver_name || nameById[did] || ('Chofer ' + did);
      if (!porChofer[did]) porChofer[did] = { nombre, rutas: 0, completadas: 0 };
      porChofer[did].rutas++;
      if (r.status === 'completado') porChofer[did].completadas++;
      if (provIds.has(did)) {
        if (!porProveedor[did]) porProveedor[did] = { nombre, rutas: 0, costo: 0 };
        porProveedor[did].rutas++;
        const c = Number(r.costo_transporte) || 0;
        porProveedor[did].costo += c;
        totalCosto += c;
      }
    });
    return {
      proveedores: Object.values(porProveedor).sort((a, b) => b.costo - a.costo),
      choferes: Object.values(porChofer).sort((a, b) => b.rutas - a.rutas),
      totalCosto,
    };
  }, [routes, drivers]);

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <h2 style={{ fontSize: 17 }}>💰 Reporte de costos y movimientos</h2>
          <div className="toolbar">
            <label style={{ fontSize: 13, color: '#556' }}>Del</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <label style={{ fontSize: 13, color: '#556' }}>al</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            <button className="btn btn-secondary" onClick={() => { setFrom(firstOfMonth(new Date())); setTo(lastOfMonth(new Date())); }}>Este mes</button>
          </div>
        </div>
        <div className="dash-tiles" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div className="dash-tile"><div className="dash-tile-value">S/ {m.totalCosto.toFixed(2)}</div><div className="dash-tile-label">Costo de transporte (proveedores)</div></div>
          <div className="dash-tile"><div className="dash-tile-value">{m.proveedores.length}</div><div className="dash-tile-label">Proveedores con movimiento</div></div>
          <div className="dash-tile"><div className="dash-tile-value">{routes.length}</div><div className="dash-tile-label">Rutas en el periodo</div></div>
        </div>
      </div>

      <div className="card">
        <div className="section-title"><span className="st-icon">🚚</span> Costo por proveedor</div>
        {m.proveedores.length === 0 ? (
          <div className="empty-state" style={{ padding: '16px 0' }}>Sin costos de proveedor en el periodo.</div>
        ) : (
          <table className="simple">
            <thead><tr><th>Proveedor</th><th>Rutas</th><th>Costo de transporte</th></tr></thead>
            <tbody>
              {m.proveedores.map((p) => (
                <tr key={p.nombre}><td>{p.nombre}</td><td>{p.rutas}</td><td><strong>S/ {p.costo.toFixed(2)}</strong></td></tr>
              ))}
              <tr><td><strong>Total</strong></td><td><strong>{m.proveedores.reduce((s, p) => s + p.rutas, 0)}</strong></td><td><strong>S/ {m.totalCosto.toFixed(2)}</strong></td></tr>
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="section-title"><span className="st-icon">📦</span> Movimientos por chofer</div>
        {m.choferes.length === 0 ? (
          <div className="empty-state" style={{ padding: '16px 0' }}>Sin movimientos en el periodo.</div>
        ) : (
          <table className="simple">
            <thead><tr><th>Chofer</th><th>Rutas</th><th>Completadas</th></tr></thead>
            <tbody>
              {m.choferes.map((c) => (
                <tr key={c.nombre}><td>{c.nombre}</td><td>{c.rutas}</td><td>{c.completadas}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
