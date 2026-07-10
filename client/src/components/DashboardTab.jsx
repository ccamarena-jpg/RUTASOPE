import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { getMonday, addDays, toISODate, formatShort } from '../utils/date';

const STATUS_LABEL = { pendiente: 'Pendiente', en_curso: 'En curso', completado: 'Completado', no_realizada: 'No realizada' };

function minutesBetween(salida, llegada) {
  if (!salida || !llegada) return null;
  const a = String(salida).split(':').map(Number);
  const b = String(llegada).split(':').map(Number);
  if (a.length < 2 || b.length < 2 || a.some(isNaN) || b.some(isNaN)) return null;
  let d = (b[0] * 60 + b[1]) - (a[0] * 60 + a[1]);
  if (d < 0) d += 24 * 60;
  return d;
}

function fmtDur(min) {
  if (min == null) return '-';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function Bars({ data, color = 'var(--navy)' }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (data.length === 0) return <div className="empty-state" style={{ padding: '16px 0' }}>Sin datos en el periodo.</div>;
  return (
    <div className="bar-list">
      {data.map((d) => (
        <div className="bar-row" key={d.label}>
          <div className="bar-label" title={d.label}>{d.label}</div>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${(d.value / max) * 100}%`, background: color }} /></div>
          <div className="bar-value">{d.value}</div>
        </div>
      ))}
    </div>
  );
}

export default function DashboardTab() {
  const [from, setFrom] = useState(toISODate(getMonday(new Date())));
  const [to, setTo] = useState(toISODate(addDays(getMonday(new Date()), 6)));
  const [routes, setRoutes] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.getRoutes({ from, to }).then(setRoutes).catch(() => setRoutes([])).finally(() => setLoading(false));
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const m = useMemo(() => {
    const byStatus = { pendiente: 0, en_curso: 0, completado: 0, no_realizada: 0 };
    const byAccount = {};
    const byDay = {};
    const byWeek = {};
    const durations = [];
    let costoT = 0;

    routes.forEach((r) => {
      costoT += Number(r.costo_transporte) || 0;
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      const acc = r.account_name || 'Sin cuenta';
      byAccount[acc] = (byAccount[acc] || 0) + 1;
      byDay[r.date] = (byDay[r.date] || 0) + 1;

      const wk = toISODate(getMonday(new Date(r.date + 'T00:00:00')));
      if (!byWeek[wk]) byWeek[wk] = { total: 0, completado: 0, dur: [] };
      byWeek[wk].total += 1;
      if (r.status === 'completado') byWeek[wk].completado += 1;

      const d = minutesBetween(r.hora_salida, r.hora_llegada);
      if (d != null) { durations.push(d); byWeek[wk].dur.push(d); }
    });

    const avg = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null);

    const accountBars = Object.entries(byAccount).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    const days = [];
    for (let d = new Date(from + 'T00:00:00'); toISODate(d) <= to; d = addDays(d, 1)) {
      const iso = toISODate(d);
      days.push({ label: formatShort(d), value: byDay[iso] || 0 });
    }
    const weeks = Object.entries(byWeek).sort().map(([wk, v]) => ({
      wk, label: `Semana del ${formatShort(new Date(wk + 'T00:00:00'))}`,
      total: v.total, completado: v.completado,
      efectividad: v.total ? Math.round((v.completado / v.total) * 100) : 0,
      dur: avg(v.dur),
    }));

    return { byStatus, total: routes.length, accountBars, days, weeks, avgDur: avg(durations), durCount: durations.length, costoT };
  }, [routes, from, to]);

  const tiles = [
    { key: 'total', label: 'Rutas totales', value: m.total, cls: '' },
    { key: 'completado', label: 'Completadas', value: m.byStatus.completado, cls: 'completado' },
    { key: 'en_curso', label: 'En curso', value: m.byStatus.en_curso, cls: 'en_curso' },
    { key: 'pendiente', label: 'Pendientes', value: m.byStatus.pendiente, cls: 'pendiente' },
    { key: 'no_realizada', label: 'No realizadas', value: m.byStatus.no_realizada, cls: 'no_realizada' },
    { key: 'dur', label: 'Tiempo prom. entrega', value: fmtDur(m.avgDur), cls: '' },
  ];

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <h2 style={{ fontSize: 17 }}>📊 Dashboard de operaciones</h2>
          <div className="toolbar">
            <label style={{ fontSize: 13, color: '#556' }}>Del</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <label style={{ fontSize: 13, color: '#556' }}>al</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            <button className="btn btn-secondary" onClick={() => { setFrom(toISODate(getMonday(new Date()))); setTo(toISODate(addDays(getMonday(new Date()), 6))); }}>Esta semana</button>
          </div>
        </div>

        <div className="dash-tiles">
          {tiles.map((t) => (
            <div className={`dash-tile ${t.cls}`} key={t.key}>
              <div className="dash-tile-value">{t.value}</div>
              <div className="dash-tile-label">{t.label}</div>
            </div>
          ))}
        </div>
        {loading && <div style={{ fontSize: 12, color: '#889', marginTop: 8 }}>Cargando...</div>}
        {m.durCount > 0 && <div style={{ fontSize: 12, color: '#889', marginTop: 8 }}>Tiempo de entrega calculado sobre {m.durCount} ruta(s) con salida y llegada marcadas.</div>}
        {m.costoT > 0 && (
          <div style={{ marginTop: 12 }}>
            <span style={{ fontSize: 12.5, color: 'var(--text-soft)' }}>Costo de transporte del periodo (proveedores): </span>
            <strong style={{ color: 'var(--navy)' }}>S/ {m.costoT.toFixed(2)}</strong>
          </div>
        )}
      </div>

      <div className="dash-grid">
        <div className="card">
          <div className="section-title"><span className="st-icon">🏢</span> Movimientos por cuenta</div>
          <Bars data={m.accountBars} />
        </div>
        <div className="card">
          <div className="section-title"><span className="st-icon">📅</span> Rutas por dia</div>
          <Bars data={m.days} color="var(--blue-accent)" />
        </div>
      </div>

      <div className="card">
        <div className="section-title"><span className="st-icon">📈</span> Consolidado semanal</div>
        {m.weeks.length === 0 ? (
          <div className="empty-state" style={{ padding: '16px 0' }}>Sin datos en el periodo.</div>
        ) : (
          <table className="simple">
            <thead><tr><th>Semana</th><th>Rutas</th><th>Completadas</th><th>Efectividad</th><th>Tiempo prom.</th></tr></thead>
            <tbody>
              {m.weeks.map((w) => (
                <tr key={w.wk}>
                  <td>{w.label}</td>
                  <td>{w.total}</td>
                  <td>{w.completado}</td>
                  <td><span className={`badge ${w.efectividad >= 80 ? 'completado' : w.efectividad >= 50 ? 'en_curso' : 'no_realizada'}`}>{w.efectividad}%</span></td>
                  <td>{fmtDur(w.dur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
