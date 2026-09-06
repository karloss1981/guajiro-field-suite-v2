export type LiveWeather = {
  latitude: number;
  longitude: number;
  temperatureF: number;
  apparentTemperatureF: number;
  precipitationIn: number;
  windMph: number;
  weatherCode: number;
  labelEn: string;
  labelEs: string;
  updatedAt: string;
};

export type SevereWeatherAlert = {
  id: string;
  event: string;
  severity: string;
  urgency: string;
  headline: string;
  description: string;
  instruction: string;
  onset?: string;
  expires?: string;
};

const weatherCodeLabels: Record<number, [string, string]> = {
  0: ['Clear', 'Despejado'],
  1: ['Mostly clear', 'Mayormente despejado'],
  2: ['Partly cloudy', 'Parcialmente nublado'],
  3: ['Overcast', 'Nublado'],
  45: ['Fog', 'Niebla'],
  48: ['Freezing fog', 'Niebla helada'],
  51: ['Light drizzle', 'Llovizna ligera'],
  53: ['Drizzle', 'Llovizna'],
  55: ['Heavy drizzle', 'Llovizna intensa'],
  61: ['Light rain', 'Lluvia ligera'],
  63: ['Rain', 'Lluvia'],
  65: ['Heavy rain', 'Lluvia intensa'],
  80: ['Rain showers', 'Chubascos'],
  81: ['Heavy showers', 'Chubascos intensos'],
  82: ['Violent showers', 'Chubascos violentos'],
  95: ['Thunderstorm', 'Tormenta eléctrica'],
  96: ['Thunderstorm with hail', 'Tormenta con granizo'],
  99: ['Severe thunderstorm with hail', 'Tormenta severa con granizo'],
};

const ACTIONABLE_ALERT_KEYWORDS = [
  'tornado',
  'severe thunderstorm',
  'flash flood',
  'hurricane',
  'tropical storm',
  'storm surge',
  'extreme wind',
  'high wind',
  'flood warning',
];

export function describeWeatherCode(code: number) {
  return weatherCodeLabels[code] || ['Changing conditions', 'Condiciones variables'];
}

export function isStormWeatherCode(code: number) {
  return [65, 82, 95, 96, 99].includes(Number(code));
}

function isExpired(expires?: string) {
  if (!expires) return false;
  const time = new Date(expires).getTime();
  return Number.isFinite(time) && time <= Date.now();
}

export function isActionableSevereWeatherAlert(alert: SevereWeatherAlert) {
  if (isExpired(alert.expires)) return false;
  const text = `${alert.event || ''} ${alert.headline || ''}`.toLowerCase();
  const severe = ['extreme', 'severe'].includes(String(alert.severity || '').toLowerCase());
  return severe && ACTIONABLE_ALERT_KEYWORDS.some((keyword) => text.includes(keyword));
}

export async function fetchLiveWeather(latitude: number, longitude: number): Promise<LiveWeather> {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
    timezone: 'auto',
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
  if (!response.ok) throw new Error(`Weather API ${response.status}`);
  const json = await response.json();
  const current = json.current || {};
  const labels = describeWeatherCode(Number(current.weather_code || 0));
  return {
    latitude,
    longitude,
    temperatureF: Number(current.temperature_2m || 0),
    apparentTemperatureF: Number(current.apparent_temperature || 0),
    precipitationIn: Number(current.precipitation || 0),
    windMph: Number(current.wind_speed_10m || 0),
    weatherCode: Number(current.weather_code || 0),
    labelEn: labels[0],
    labelEs: labels[1],
    updatedAt: current.time || new Date().toISOString(),
  };
}

export async function fetchSevereWeatherAlerts(latitude: number, longitude: number): Promise<SevereWeatherAlert[]> {
  const response = await fetch(`https://api.weather.gov/alerts/active?point=${latitude.toFixed(4)},${longitude.toFixed(4)}`, {
    headers: { Accept: 'application/geo+json' },
  });
  if (!response.ok) return [];
  const json = await response.json();
  const alerts = (json.features || []).map((feature: any) => ({
    id: feature.id || feature.properties?.id || `${feature.properties?.event}-${feature.properties?.sent}`,
    event: feature.properties?.event || 'Weather alert',
    severity: feature.properties?.severity || 'Unknown',
    urgency: feature.properties?.urgency || 'Unknown',
    headline: feature.properties?.headline || feature.properties?.event || 'Weather alert',
    description: feature.properties?.description || '',
    instruction: feature.properties?.instruction || '',
    onset: feature.properties?.onset,
    expires: feature.properties?.expires,
  })) as SevereWeatherAlert[];

  const unique = new Map<string, SevereWeatherAlert>();
  alerts.filter(isActionableSevereWeatherAlert).forEach((alert) => unique.set(String(alert.id), alert));
  return [...unique.values()];
}
