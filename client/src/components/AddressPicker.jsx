import React, { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '../utils/gmaps';

// Autocompletado de direcciones con Places API (New): usa el web component
// google.maps.places.PlaceAutocompleteElement. Al elegir una sugerencia
// entrega { lat, lng, address } al padre.
export default function AddressPicker({ onPick }) {
  const containerRef = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let el = null;
    let handler = null;
    let disposed = false;

    async function handleSelect(event) {
      try {
        let place = event.placePrediction ? event.placePrediction.toPlace() : event.place;
        if (!place) return;
        if (place.fetchFields) await place.fetchFields({ fields: ['location', 'formattedAddress', 'displayName'] });
        const loc = place.location;
        if (!loc) return;
        const lat = typeof loc.lat === 'function' ? loc.lat() : loc.lat;
        const lng = typeof loc.lng === 'function' ? loc.lng() : loc.lng;
        const address = place.formattedAddress ||
          (place.displayName && place.displayName.text) || place.displayName || '';
        onPick({ lat, lng, address });
      } catch (e) {
        setError('No se pudo obtener la ubicacion: ' + e.message);
      }
    }

    loadGoogleMaps()
      .then(() => window.google.maps.importLibrary('places'))
      .then((places) => {
        if (disposed || !containerRef.current) return;
        const Ctor = places.PlaceAutocompleteElement || window.google.maps.places.PlaceAutocompleteElement;
        try {
          el = new Ctor({ includedRegionCodes: ['pe'] });
        } catch (e) {
          el = new Ctor();
        }
        el.style.width = '100%';
        containerRef.current.appendChild(el);
        handler = handleSelect;
        el.addEventListener('gmp-select', handler);
        el.addEventListener('gmp-placeselect', handler);
      })
      .catch((e) => setError(e.message));

    return () => {
      disposed = true;
      if (el && handler) { el.removeEventListener('gmp-select', handler); el.removeEventListener('gmp-placeselect', handler); }
      if (el && el.remove) el.remove();
    };
  }, []);

  return (
    <div>
      <div ref={containerRef} className="place-ac" />
      {error && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 4 }}>{error}</div>}
    </div>
  );
}
