import { useEffect, useRef, useState, useCallback } from 'react';

// Cache de lecturas en memoria, a nivel de modulo: sobrevive a que un componente
// se desmonte/remonte al cambiar de pestana (el estado de React se pierde en el
// remonte, este cache no). Patron stale-while-revalidate: al montar entrega AL
// INSTANTE el ultimo valor cacheado para esa clave (si existe) y revalida contra
// el backend en segundo plano; cuando llega la respuesta fresca actualiza cache y
// UI. Asi cambiar de vista es instantaneo y el backend lento (Apps Script) deja de
// sentirse en cada clic, en vez de quedar en blanco y volver a pedir todo.
//
// La clave (key) identifica el recurso + sus parametros (p. ej. `week:3:2026-09-07`).
// Si la key cambia (otra semana, otro chofer, otra fecha) se trata como otro recurso.

const store = new Map(); // key -> { data, at }

// Invalida una entrada (o todo si no se pasa key) para forzar recarga fresca. Se
// usa tras crear/editar/borrar para que la proxima lectura no sirva datos viejos.
export function invalidate(key) {
  if (key == null) store.clear();
  else store.delete(key);
}

// Invalida todas las claves que empiezan con `prefix` (p. ej. "routes:" tras
// crear/editar/borrar una ruta), para que las demas vistas revaliden al abrirse.
export function invalidatePrefix(prefix) {
  for (const k of Array.from(store.keys())) if (String(k).startsWith(prefix)) store.delete(k);
}

export function primeCache(key, data) {
  if (key != null) store.set(key, { data, at: Date.now() });
}

export function useCachedResource(key, fetcher, { enabled = true, initialData = undefined } = {}) {
  const cached = key != null ? store.get(key) : undefined;
  const [data, setData] = useState(cached ? cached.data : initialData);
  const [loading, setLoading] = useState(!cached && enabled);
  const [error, setError] = useState(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const aliveRef = useRef(true);
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);

  const revalidate = useCallback(() => {
    if (key == null || !enabled) return Promise.resolve();
    if (!store.has(key)) setLoading(true); // sin cache -> loading visible; con cache -> silencioso
    return Promise.resolve()
      .then(() => fetcherRef.current())
      .then((fresh) => {
        store.set(key, { data: fresh, at: Date.now() });
        if (aliveRef.current) { setData(fresh); setError(null); }
        return fresh;
      })
      .catch((e) => { if (aliveRef.current) setError(e); throw e; })
      .finally(() => { if (aliveRef.current) setLoading(false); });
  }, [key, enabled]);

  useEffect(() => {
    if (key == null || !enabled) return;
    const hit = store.get(key);
    if (hit) { setData(hit.data); setLoading(false); } // pinta cache al instante
    revalidate().catch(() => {}); // revalida en segundo plano
  }, [key, enabled, revalidate]);

  // setLocal actualiza solo la vista + cache sin ir al backend (updates optimistas).
  const setLocal = useCallback((updater) => {
    setData((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (key != null) store.set(key, { data: next, at: Date.now() });
      return next;
    });
  }, [key]);

  return { data, loading, error, revalidate, setData: setLocal };
}
