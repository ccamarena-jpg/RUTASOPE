import React from 'react';

// Selector de tipo de movimiento (Entrega / Recojo). Permite uno o ambos.
// El valor es un string tipo "Entrega" | "Recojo" | "Entrega, Recojo".
export default function MovimientoPicker({ value, onChange }) {
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
