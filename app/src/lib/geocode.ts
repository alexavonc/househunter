// OneMap Singapore geocoding API

interface OneMapResult {
  LATITUDE: string;
  LONGITUDE: string;
  ADDRESS: string;
  SEARCHVAL: string;
}

interface OneMapResponse {
  found: number;
  totalNumPages: number;
  results: OneMapResult[];
}

const cache = new Map<string, { lat: number; lng: number } | null>();

export async function geocodeAddress(
  address: string,
): Promise<{ lat: number; lng: number } | null> {
  const key = address.toLowerCase().trim();
  if (cache.has(key)) return cache.get(key)!;

  try {
    const url = `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${encodeURIComponent(
      address,
    )}&returnGeom=Y&getAddrDetails=N&pageNum=1`;
    const res = await fetch(url);
    if (!res.ok) {
      cache.set(key, null);
      return null;
    }
    const data = (await res.json()) as OneMapResponse;
    if (data.found === 0 || !data.results[0]) {
      cache.set(key, null);
      return null;
    }
    const { LATITUDE, LONGITUDE } = data.results[0];
    const result = { lat: parseFloat(LATITUDE), lng: parseFloat(LONGITUDE) };
    cache.set(key, result);
    return result;
  } catch {
    cache.set(key, null);
    return null;
  }
}
