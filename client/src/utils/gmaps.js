// Cargador unico de Google Maps (con la libreria Places para autocompletar
// direcciones). Se asegura de cargar el script una sola vez para toda la app.
export const MAPS_KEY =
  (import.meta.env && import.meta.env.VITE_GOOGLE_MAPS_API_KEY) ||
  'AIzaSyC07b6izx5TdLMceKwmw8-G9UhFfoVNEyU';

let promise = null;

export function loadGoogleMaps() {
  if (!MAPS_KEY) return Promise.reject(new Error('Falta la API key de Google Maps (VITE_GOOGLE_MAPS_API_KEY).'));
  if (typeof window !== 'undefined' && window.google && window.google.maps && window.google.maps.places) return Promise.resolve();
  if (promise) return promise;
  promise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.id = 'gmaps-script';
    s.async = true;
    s.defer = true;
    s.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}&libraries=places`;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('No se pudo cargar Google Maps. Revisa la API key.'));
    document.head.appendChild(s);
  });
  return promise;
}
