import React from 'react';
import { HOURS, DAY_LABELS, toISODate, addDays, formatShort } from '../utils/date';

export default function WeeklyCalendar({ drivers, driverId, onDriverChange, weekStart, onWeekChange, routes, onSlotClick, driverMeta }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekEnd = days[days.length - 1];

  const routesBySlot = {};
  for (const r of routes) {
    const key = `${r.date}_${r.hour}`;
    if (!routesBySlot[key]) routesBySlot[key] = [];
    routesBySlot[key].push(r);
  }

  // Horas ocupadas (bloqueadas) entre la hora inicio y la hora fin de cada ruta.
  const blockedBySlot = {};
  for (const r of routes) {
    if (!r.hora_fin) continue;
    const s = HOURS.indexOf(r.hour);
    const e = HOURS.indexOf(r.hora_fin);
    if (s === -1 || e === -1) continue;
    for (let i = s + 1; i < e; i++) blockedBySlot[`${r.date}_${HOURS[i]}`] = r;
  }

  return (
    <div>
      <div className="toolbar" style={{ marginBottom: 10, justifyContent: 'space-between' }}>
        <div className="toolbar">
          <label style={{ fontSize: 13, fontWeight: 600, color: '#556' }}>Chofer:</label>
          <select value={driverId || ''} onChange={(e) => onDriverChange(Number(e.target.value))}>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div className="toolbar">
          <button className="btn btn-secondary" onClick={() => onWeekChange(addDays(weekStart, -7))}>&larr; Semana anterior</button>
          <button className="btn btn-secondary" onClick={() => onWeekChange(addDays(weekStart, 7))}>Semana siguiente &rarr;</button>
        </div>
      </div>

      <div className="calendar-header-bar">
        <h2>CONTROL SEMANAL DE RECORRIDO</h2>
        <div className="sub">TT Audit | Area de Operaciones / Logistica</div>
      </div>
      <div className="calendar-meta">
        <div className="cell"><span className="label">Chofer:</span>{driverMeta?.name || '-'}</div>
        <div className="cell"><span className="label">Vehiculo / Movil:</span>{driverMeta?.vehicle || '-'}</div>
        <div className="cell"><span className="label">Semana del:</span>{formatShort(weekStart)}</div>
        <div className="cell"><span className="label">al:</span>{formatShort(weekEnd)}</div>
        <div className="cell"><span className="label">Supervisor:</span>{driverMeta?.supervisor || '-'}</div>
        <div className="cell"><span className="label">Area:</span>Operaciones</div>
        <div className="cell"></div>
        <div className="cell"></div>
      </div>

      <div className="calendar-scroll">
        <table className="calendar">
          <thead>
            <tr>
              <th>HORA</th>
              {days.map((d, i) => (
                <th key={i}>{DAY_LABELS[i]}<br />{formatShort(d)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {HOURS.map((hour) => (
              <tr key={hour}>
                <td className="hour-col">{hour}</td>
                {days.map((d) => {
                  const dateISO = toISODate(d);
                  const slotRoutes = routesBySlot[`${dateISO}_${hour}`] || [];
                  const route = slotRoutes[0];
                  const blocked = !route ? blockedBySlot[`${dateISO}_${hour}`] : null;
                  const cls = route ? `filled ${route.status}` : blocked ? `filled ${blocked.status} slot-cont` : '';
                  return (
                    <td key={dateISO}>
                      <button
                        className={`slot ${cls}`}
                        onClick={() => onSlotClick(dateISO, hour, route || blocked || null)}
                        title={route ? `${route.destino} - ${route.motivo || ''}` : blocked ? `Ocupado: ${blocked.destino}` : 'Agregar ruta'}
                      >
                        {route ? (
                          <>
                            <span className="destino">{route.destino}</span>
                            <span className="motivo">{route.account_name}{route.hora_fin ? ` · hasta ${route.hora_fin}` : ''}{route.motivo ? ` - ${route.motivo}` : ''}</span>
                          </>
                        ) : blocked ? (
                          <span className="motivo">⋯ {blocked.destino} (ocupado)</span>
                        ) : (
                          <span className="empty-hint">+ agregar</span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
