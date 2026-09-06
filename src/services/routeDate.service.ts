export const ROUTE_ROLLOVER_HOUR = 23; // 7:00 PM local time

function toLocalIsoDate(date: Date) {
  return date.toLocaleDateString('en-CA');
}

export function addDaysIso(dateIso: string, days: number) {
  const [year, month, day] = String(dateIso).split('-').map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  date.setDate(date.getDate() + days);
  return toLocalIsoDate(date);
}

export function getTodayRouteDate(now = new Date()) {
  return toLocalIsoDate(now);
}

export function getDefaultImportRouteDate(now = new Date()) {
  const target = new Date(now);
  if (target.getHours() >= ROUTE_ROLLOVER_HOUR) target.setDate(target.getDate() + 1);
  return toLocalIsoDate(target);
}

export function getRouteUploadWindowLabel(lang = 'en', now = new Date()) {
  const target = getDefaultImportRouteDate(now);
  const today = getTodayRouteDate(now);
  const tomorrow = addDaysIso(today, 1);
  if (target === tomorrow) {
    return lang === 'es'
      ? `Después de las 7 PM, las rutas importadas se guardan para mañana (${target}) y NO se borran a medianoche.`
      : `After 7 PM, imported routes are saved for tomorrow (${target}) and will NOT disappear at midnight.`;
  }
  return lang === 'es'
    ? `Antes de las 7 PM, la ruta se guarda para hoy (${target}). Puedes cambiar la fecha antes de importar.`
    : `Before 7 PM, the route is saved for today (${target}). You can change the date before importing.`;
}
