import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

const MAPS_KEY = (import.meta.env && import.meta.env.VITE_GOOGLE_MAPS_API_KEY) || '';
const LIMA = { lat: -12.0464, lng: -77.0428 };

function loadMaps() {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.maps) return resolve();
    const id = 'gmaps-script';
    const existing = document.getElementById(id);
    if (existing) { existing.addEventListener('load', () => resolve()); return; }
    const s = document.createElement('script');
    s.id = id;
    s.async = true;
    s.defer = true;
    s.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}`;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('No se pudo cargar Google Maps. Revisa la API key.'));
    document.head.appendChild(s);
  });
}

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
  const [locs, setLocs] = useState([]);
  const [lastRefresh, setLastRefresh] = useState(null);

  useEffect(() => {
    if (!MAPS_KEY) { setError('Falta configurar la API key de Google Maps (VITE_GOOGLE_MAPS_API_KEY).'); return; }
    let cancelled = false;
    loadMaps().then(() => {
      if (cancelled || !mapEl.current) return;
      mapObj.current = new window.google.maps.Map(mapEl.current, { center: LIMA, zoom: 11, mapTypeControl: false, streetViewControl: false });
      setReady(true);
    }).catch((e) => setError(e.message));
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(() => {
    api.getLocations().then((d) => { setLocs(d); setLastRefresh(new Date()); }).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
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
