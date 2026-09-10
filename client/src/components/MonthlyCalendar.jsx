import React, { useMemo, useState } from 'react';
import { api } from '../api';
import { toISODate, getMonday, addDays } from '../utils/date';
import { useCachedResource } from '../utils/useCachedResource';

const DOW = ['LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB', 'DOM'];
const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const STATUS_LABEL = { pendiente: 'Pendiente', en_curso: 'En curso', completado: 'Completado', no_realizada: 'No realizada' };

export default function MonthlyCalendar() {
  const today = new Date();
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(null);

  const gridStart = getMonday(month);
  const days = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)), [month]);

  const from = toISODate(gridStart);
  const to = toISODate(addDays(gridStart, 41));
  // Cache SWR por mes: cambiar de vista y volver ya no recarga la grilla en blanco.
  const { data: routes = [] } = useCachedResource(
    `routes:range:${from}:${to}`,
    () => api.getRoutes({ from, to }),
    { initialData: [] },
  );

  const byDay = useMemo(() => {
    const map = {};
    routes.forEach((r) => { (map[r.date] = map[r.date] || []).push(r); });
    return map;
  }, [routes]);

  const todayIso = toISODate(today);
  const selRoutes = selected ? (byDay[selected] || []) : [];

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <h2 style={{ fontSize: 17 }}>🗓️ Calendario mensual</h2>
          <div className="toolbar">
            <button className="btn btn-secondary" onClick={() => { setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1)); setSelected(null); }}>&larr; Mes anterior</button>
            <strong style={{ color: 'var(--navy)', minWidth: 150, textAlign: 'center' }}>{MONTHS[month.getMonth()]} {month.getFullYear()}</strong>
            <button className="btn btn-secondary" onClick={() => { setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1)); setSelected(null); }}>Mes siguiente &rarr;</button>
            <button className="btn btn-secondary" onClick={() => { setMonth(new Date(today.getFullYear(), today.getMonth(), 1)); setSelected(null); }}>Hoy</button>
          </div>
        </div>

        <div className="month-grid">
          {DOW.map((d) => <div className="month-dow" key={d}>{d}</div>)}
          {days.map((d) => {
            const iso = toISODate(d);
            const inMonth = d.getMonth() === month.getMonth();
            const list = byDay[iso] || [];
            return (
              <button
                key={iso}
                className={`month-cell ${inMonth ? '' : 'out'} ${iso === todayIso ? 'today' : ''} ${selected === iso ? 'sel' : ''}`}
                onClick={() => setSelected(iso)}
              >
                <div className="month-daynum">{d.getDate()}</div>
                {list.length > 0 && (
                  <>
                    <div className="month-count">{list.length} ruta{list.length > 1 ? 's' : ''}</div>
                    <div className="month-dots">
                      {list.slice(0, 6).map((r, i) => <span key={i} className={`dot ${r.status}`} title={STATUS_LABEL[r.status]} />)}
                      {list.length > 6 && <span className="dot-more">+{list.length - 6}</span>}
                    </div>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {selected && (
        <div className="card">
          <div className="section-title">
            <span className="st-icon">📋</span> Rutas del {new Date(selected + 'T00:00:00').toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
          {selRoutes.length === 0 ? (
            <div className="empty-state" style={{ padding: '16px 0' }}>No hay rutas ese dia.</div>
          ) : (
            <table className="simple">
              <thead><tr><th>Hora</th><th>Chofer</th><th>Cuenta / Proyecto</th><th>Destino</th><th>Estado</th></tr></thead>
              <tbody>
                {selRoutes.slice().sort((a, b) => a.hour.localeCompare(b.hour)).map((r) => (
                  <tr key={r.id}>
                    <td>{r.hour}</td>
                    <td>{r.driver_name}</td>
                    <td>{r.account_name || '-'}{r.project_name ? ` / ${r.project_name}` : ''}</td>
                    <td>{r.destino}</td>
                    <td><span className={`badge ${r.status}`}>{STATUS_LABEL[r.status]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
