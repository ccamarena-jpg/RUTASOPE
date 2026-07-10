import React, { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '../utils/gmaps';

// Campo con autocompletado de direcciones (Google Places). Al elegir una
// sugerencia, entrega { lat, lng, address } al padre.
export default function AddressPicker({ onPick, placeholder = 'Buscar direccion en el mapa...', defaultValue = '' }) {
  const inputRef = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let ac = null;
    loadGoogleMaps().then(() => {
      if (!inputRef.current || !window.google || !window.google.maps.places) return;
      ac = new window.google.maps.places.Autocomplete(inputRef.current, {
        fields: ['geometry', 'formatted_address', 'name'],
        componentRestrictions: { country: 'pe' },
      });
      ac.addListener('place_changed', () => {
        const p = ac.getPlace();
        if (p && p.geometry && p.geometry.location) {
          onPick({
            lat: p.geometry.location.lat(),
            lng: p.geometry.location.lng(),
            address: p.formatted_address || p.name || inputRef.current.value,
          });
        }
      });
    }).catch((e) => setError(e.message));
    return () => { if (ac && window.google) window.google.maps.event.clearInstanceListeners(ac); };
  }, []);

  return (
    <div>
      <input ref={inputRef} defaultValue={defaultValue} placeholder={placeholder} onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} />
      {error && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 4 }}>{error}</div>}
    </div>
  );
}
