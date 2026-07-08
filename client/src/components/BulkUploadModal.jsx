import React, { useState } from 'react';
import { api } from '../api';

const TEMPLATE = `date,hour,driver_name,account_name,project_name,destino,motivo
2026-07-08,08:00,Christian Herrera,Alicorp,Distribucion Lima Norte,Almacen Chiclin,Carga inicial de pedidos
2026-07-08,10:00,Luis Ramirez,Backus,Entrega Canal Moderno,Tienda Backus Surco,Reposicion de stock
`;

export default function BulkUploadModal({ onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function downloadTemplate() {
    const blob = new Blob([TEMPLATE], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plantilla_rutas.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleUpload() {
    if (!file) { setError('Selecciona un archivo CSV'); return; }
    setError('');
    setLoading(true);
    try {
      const res = await api.bulkUpload(file);
      setResult(res);
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Carga masiva de rutas (CSV)</h3>
        <p style={{ fontSize: 13, color: '#556' }}>
          Sube un archivo CSV con las columnas: <code>date, hour, driver_name (o driver_id), account_name (o account_id), project_name (opcional), destino, motivo</code>.
        </p>
        <button className="btn btn-secondary" onClick={downloadTemplate} type="button" style={{ marginBottom: 14 }}>Descargar plantilla</button>
        {error && <div className="error-msg">{error}</div>}
        <div className="field">
          <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files[0])} />
        </div>
        {result && (
          <div style={{ fontSize: 13, marginTop: 10 }}>
            <strong>{result.created}</strong> rutas creadas correctamente.
            {result.errors?.length > 0 && (
              <div style={{ marginTop: 8, color: '#b3261e' }}>
                {result.errors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
          </div>
        )}
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose} type="button">Cerrar</button>
          <button className="btn btn-primary" onClick={handleUpload} disabled={loading} type="button">{loading ? 'Subiendo...' : 'Subir archivo'}</button>
        </div>
      </div>
    </div>
  );
}
