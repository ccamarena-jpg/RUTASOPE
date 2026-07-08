export const HOURS = ['08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00'];
export const DAY_LABELS = ['LUNES','MARTES','MIERCOLES','JUEVES','VIERNES','SABADO'];

export function toISODate(d) {
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 10);
}

export function getMonday(date) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function formatShort(date) {
  const d = new Date(date);
  const day = d.getDate();
  const month = d.toLocaleDateString('es-PE', { month: 'short' }).replace('.', '');
  return `${day}-${month.charAt(0).toUpperCase() + month.slice(1)}`;
}
