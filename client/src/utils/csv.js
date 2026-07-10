// Client-side CSV export of routes. Builds a UTF-8 CSV (with BOM so Excel in
// es-PE opens tildes/ñ correctly) and triggers a download, no server needed.

const STATUS_LABEL = {
  pendiente: 'Pendiente',
  en_curso: 'En curso',
  completado: 'Completado',
  no_realizada: 'No realizada',
};

const COLUMNS = [
  ['date', 'Fecha'],
  ['hour', 'Hora'],
  ['driver_name', 'Chofer'],
  ['account_name', 'Cuenta'],
  ['project_name', 'Proyecto'],
  ['destino', 'Destino'],
  ['motivo', 'Motivo'],
  ['status', 'Estado'],
  ['hora_salida', 'Hora salida'],
  ['hora_llegada', 'Hora llegada'],
  ['comentario_chofer', 'Comentario chofer'],
  ['motivo_no_realizada', 'Motivo no realizada'],
  ['tipo_movimiento', 'Tipo de movimiento'],
  ['elementos_trasladados', 'Elementos trasladados'],
  ['cantidad_bultos', 'Cantidad de bultos'],
  ['gr_firmada', 'GR firmada por cliente'],
  ['foto_elementos_url', 'Foto de elementos'],
  ['guia_url', 'Guia de remision'],
];

function escapeCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadRoutesCsv(routes, filename = 'rutas.csv') {
  const header = COLUMNS.map(([, label]) => label).join(',');
  const rows = routes.map((r) =>
    COLUMNS.map(([key]) => {
      if (key === 'status') return escapeCell(STATUS_LABEL[r.status] || r.status);
      return escapeCell(r[key]);
    }).join(',')
  );
  const csv = '﻿' + [header, ...rows].join('\r\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
