export const SESSION_TIMEOUT = 5 * 60;
export const SESSION_WARN = 60;

export const GEO_CACHE_KEY = 'geo_cache_v1';
export const AUTH_STORAGE_KEY = 'gfs_auth';

// First operational date used by default history searches.
// Keeps history filters from starting only 30/120 days back.
export const APP_FIRST_DATE = '2026-05-18';

// Technician location tracking window, local device time.
export const FIELD_TRACKING_START_HOUR = 7;
export const FIELD_TRACKING_END_HOUR = 19;

export function isFieldTrackingWindow(date = new Date()) {
  const hour = date.getHours();
  return hour >= FIELD_TRACKING_START_HOUR && hour < FIELD_TRACKING_END_HOUR;
}

export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
export const FL_ZIP_GEOJSON_URL =
  'https://raw.githubusercontent.com/OpenDataDE/State-zip-code-GeoJSON/master/fl_florida_zip_codes_geo.min.json';

export const MAP_DEFAULT_CENTER: [number, number] = [25.77, -80.19];
export const MAP_DEFAULT_ZOOM = 11;

export const SMS_MSG = `Hi! This is your Comcast technician. I am scheduled to perform the underground Internet cable installation at your property today. Please be aware that access to your backyard or garden might be needed to complete the work. Kindly make sure pets are kept in a safe area. Thank you for your patience, and see you soon!

¡Hola! Soy su técnico de Comcast. Tengo programada para hoy la instalación del cable subterráneo de internet en su propiedad. Tenga en cuenta que podríamos necesitar acceso a su patio o jardín para completar el trabajo. Por favor, mantenga sus mascotas en un lugar seguro. ¡Gracias por su paciencia y hasta pronto!`;

// Visible build stamp so the running version is never a mystery.
import pkg from '../../package.json';
export const APP_VERSION = (pkg as any).version || 'unknown';
export const APP_VERSION_LABEL = `Guajiro Field Suite v${APP_VERSION}`;
