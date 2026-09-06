export type PhotoTimestampLocation = {
  capturedAt: Date;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  addressLine: string;
  cityLine: string;
  source: 'gps_reverse_geocode' | 'gps_job_address' | 'job_address_only';
};

type JobLocationLike = {
  address?: string | null;
  city?: string | null;
  zip?: string | null;
};

function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported on this device.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    });
  });
}

function clean(value: unknown) {
  return String(value ?? '').trim();
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .replace(/(^|\s|[-'])\p{L}/gu, (match) => match.toUpperCase());
}

function formatCityLine(city: string, state: string, zip: string) {
  const cityPart = titleCase(clean(city));
  const statePart = clean(state).toUpperCase();
  const zipPart = clean(zip);
  const stateZip = [statePart, zipPart].filter(Boolean).join(' ');
  return [cityPart, stateZip].filter(Boolean).join(', ');
}

async function reverseGeocode(latitude: number, longitude: number) {
  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('lat', String(latitude));
  url.searchParams.set('lon', String(longitude));
  url.searchParams.set('zoom', '18');
  url.searchParams.set('addressdetails', '1');

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'en',
    },
  });
  if (!response.ok) throw new Error(`Reverse geocoding failed (${response.status}).`);
  const data = await response.json();
  const address = data?.address ?? {};
  const road = clean(address.road || address.pedestrian || address.footway || address.path);
  const houseNumber = clean(address.house_number);
  const addressLine = [houseNumber, road].filter(Boolean).join(' ');
  const city = clean(address.city || address.town || address.village || address.hamlet || address.municipality || address.county);
  const state = clean(address.state_code || address['ISO3166-2-lvl4']?.split('-')?.[1] || 'FL');
  const zip = clean(address.postcode);
  return { addressLine, city, state, zip };
}

export async function buildPhotoTimestampLocation(job: JobLocationLike): Promise<PhotoTimestampLocation> {
  const capturedAt = new Date();
  const fallbackAddress = clean(job.address);
  const fallbackCityLine = formatCityLine(clean(job.city), 'FL', clean(job.zip));

  try {
    const position = await getCurrentPosition();
    const latitude = position.coords.latitude;
    const longitude = position.coords.longitude;
    const accuracyMeters = Number.isFinite(position.coords.accuracy)
      ? Math.round(position.coords.accuracy)
      : null;

    try {
      const resolved = await reverseGeocode(latitude, longitude);
      return {
        capturedAt,
        latitude,
        longitude,
        accuracyMeters,
        addressLine: resolved.addressLine || fallbackAddress,
        cityLine: formatCityLine(
          resolved.city || clean(job.city),
          resolved.state || 'FL',
          resolved.zip || clean(job.zip),
        ) || fallbackCityLine,
        source: 'gps_reverse_geocode',
      };
    } catch {
      return {
        capturedAt,
        latitude,
        longitude,
        accuracyMeters,
        addressLine: fallbackAddress,
        cityLine: fallbackCityLine,
        source: 'gps_job_address',
      };
    }
  } catch {
    return {
      capturedAt,
      latitude: null,
      longitude: null,
      accuracyMeters: null,
      addressLine: fallbackAddress,
      cityLine: fallbackCityLine,
      source: 'job_address_only',
    };
  }
}

export function formatPhotoTimestampDate(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(date);
}
