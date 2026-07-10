import React, { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps, MAPS_KEY } from '../utils/gmaps';

const LIMA = { lat: -12.0464, lng: -77.0428 };

// Mapa con las rutas (paradas) que tengan coordenadas. `routes` es la lista de
// rutas; usa route.lat / route.lng. Numera los marcadores por hora.
export default function RoutesMap({ routes }) {
  const mapEl = useRef(null);
  const mapObj = useRef(null);
  const markers = useRef([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!MAPS_KEY) { setError('Falta la API key de Google Maps.'); return; }
    let cancelled = false;
    loadGoogleMaps().then(() => {
      if (cancelled || !mapEl.current) return;
      mapObj.current = new window.google.maps.Map(mapEl.current, { center: LIMA, zoom: 11, mapTypeControl: false, streetViewControl: false });
      setReady(true);
    }).catch((e) => setError(e.message));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready || !mapObj.current || !window.google) return;
    markers.current.forEach((m) => m.setMap(null));
    markers.current = [];
    const withPos = (routes || []).filter((r) => r.lat != null && r.lat !== '' && r.lng != null && r.lng !== '');
    const bounds = new window.google.maps.LatLngBounds();
    withPos.forEach((r, i) => {
      const pos = { lat: Number(r.lat), lng: Number(r.lng) };
      bounds.extend(pos);
      const mk = new window.google.maps.Marker({
        position: pos, map: mapObj.current, label: String(i + 1),
        title: `${r.hour} - ${r.destino}`,
      });
      markers.current.push(mk);
    });
    if (withPos.length === 1) { mapObj.current.setCenter(bounds.getCenter()); mapObj.current.setZoom(14); }
    else if (withPos.length > 1) mapObj.current.fitBounds(bounds);
  }, [routes, ready]);

  const conCoords = (routes || []).filter((r) => r.lat != null && r.lat !== '').length;

  return (
    <div>
      {error && <div className="error-msg">{error}</div>}
      <div ref={mapEl} className="live-map" style={{ height: 320 }} />
      {conCoords === 0 && !error && (
        <div style={{ fontSize: 12.5, color: '#8894a6', marginTop: 8 }}>
          Ninguna parada de hoy tiene ubicacion en el mapa todavia. El administrador la agrega al crear la ruta.
        </div>
      )}
    </div>
  );
}
