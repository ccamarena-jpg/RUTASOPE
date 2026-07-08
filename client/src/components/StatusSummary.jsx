import React from 'react';

// Counts bar shown above route lists: total + one chip per status + % completado.
const ITEMS = [
  { key: 'pendiente', label: 'Pendiente' },
  { key: 'en_curso', label: 'En curso' },
  { key: 'completado', label: 'Completado' },
  { key: 'no_realizada', label: 'No realizada' },
];

export default function StatusSummary({ routes }) {
  const total = routes.length;
  const counts = { pendiente: 0, en_curso: 0, completado: 0, no_realizada: 0 };
  for (const r of routes) counts[r.status] = (counts[r.status] || 0) + 1;
  const pct = total ? Math.round((counts.completado / total) * 100) : 0;

  return (
    <div className="status-summary">
      <div className="stat total">
        <span className="num">{total}</span>
        <span className="lbl">Total rutas</span>
      </div>
      {ITEMS.map((it) => (
        <div key={it.key} className={`stat ${it.key}`}>
          <span className="num">{counts[it.key] || 0}</span>
          <span className="lbl">{it.label}</span>
        </div>
      ))}
      <div className="stat pct">
        <span className="num">{pct}%</span>
        <span className="lbl">Completado</span>
      </div>
    </div>
  );
}
