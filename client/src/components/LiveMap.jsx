import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { loadGoogleMaps, MAPS_KEY } from '../utils/gmaps';
import { useCachedResource } from '../utils/useCachedResource';

const LIMA = { lat: -12.0464, lng: -77.0428 };

function fmt(dt) {
  if (!dt) return 'sin datos';
  try { return new Date(dt).toLocaleString('es-PE'); } catch (e) { return String(dt); }
}

export default function LiveMap() {
  const mapEl = useRef(null);
  const mapObj = useRef(null);
  const markers = useRef({});
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);

  useEffect(() => {
    if (!MAPS_KEY) { setError('Falta configurar la API key de Google Maps (VITE_GOOGLE_MAPS_API_KEY).'); return; }
    let cancelled = false;
    loadGoogleMaps().then(() => {
      if (cancelled || !mapEl.current) return;
      mapObj.current = new window.google.maps.Map(mapEl.current, { center: LIMA, zoom: 11, mapTypeControl: false, streetViewControl: false });
      setReady(true);
    }).catch((e) => setError(e.message));
    return () => { cancelled = true; };
  }, []);

  // Cache SWR: al volver al Mapa muestra las ultimas posiciones al instante y
  // revalida; ademas auto-refresca cada 30s mientras la vista este montada.
  const { data: locs = [], error: locsError, revalidate: load } = useCachedResource(
    'locations', () => api.getLocations(), { initialData: [] },
  );
  useEffect(() => { if (locsError) setError(locsError.message || 'No se pudieron cargar las ubicaciones.'); }, [locsError]);
  useEffect(() => { if (locs && locs.length) setLastRefresh(new Date()); }, [locs]);
  useEffect(() => {
    const id = setInterval(() => load(), 30000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!ready || !mapObj.current || !window.google) return;
    const withPos = locs.filter((l) => l.lat != null && l.lng != null && l.lat !== '' && l.lng !== '');
    const bounds = new window.google.maps.LatLngBounds();
    withPos.forEach((l) => {
      const pos = { lat: Number(l.lat), lng: Number(l.lng) };
      bounds.extend(pos);
      if (markers.current[l.driver_id]) {
        markers.current[l.driver_id].setPosition(pos);
      } else {
        markers.current[l.driver_id] = new window.google.maps.Marker({ position: pos, map: mapObj.current, title: `${l.name} (${fmt(l.updated_at)})` });
      }
    });
    if (withPos.length === 1) mapObj.current.setCenter(bounds.getCenter());
    else if (withPos.length > 1) mapObj.current.fitBounds(bounds);
  }, [locs, ready]);

  return (
    <div className="card">
      <div className="card-header">
        <h2 style={{ fontSize: 17 }}>🗺️ Mapa en vivo de choferes</h2>
        {lastRefresh && <span style={{ fontSize: 12, color: '#889' }}>Actualizado {lastRefresh.toLocaleTimeString()} (auto cada 30s)</span>}
      </div>
      {error && <div className="error-msg">{error}</div>}
      <div ref={mapEl} className="live-map" />
      <table className="simple" style={{ marginTop: 12 }}>
        <thead><tr><th>Chofer</th><th>Vehiculo</th><th>Ultima ubicacion</th></tr></thead>
        <tbody>
          {locs.map((l) => (
            <tr key={l.driver_id}>
              <td>{l.name}</td>
              <td>{l.vehicle || '-'}</td>
              <td>{l.lat != null && l.lat !== '' ? fmt(l.updated_at) : <span style={{ color: '#8894a6' }}>sin ubicacion compartida</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
