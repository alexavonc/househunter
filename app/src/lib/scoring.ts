import { MRT_TARGETS, SCORE_1_M, SCORE_5_M } from '../config/mrtTargets';

// ── Geo helpers ──────────────────────────────────────────────────────────────

export function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface ClosestMrt {
  distM: number;
  name: string;
  walkMins: number;
  busMins: number;
}

export function closestMrt(lat: number, lng: number): ClosestMrt {
  if (MRT_TARGETS.length === 0) {
    return { distM: Infinity, name: '—', walkMins: Infinity, busMins: Infinity };
  }
  let bestDist = Infinity;
  let bestName = '—';
  for (const t of MRT_TARGETS) {
    const d = haversineMetres(lat, lng, t.lat, t.lng);
    if (d < bestDist) { bestDist = d; bestName = t.name; }
  }
  return {
    distM: bestDist,
    name: bestName,
    walkMins: walkingMinutes(bestDist),
    busMins: busMinutes(bestDist),
  };
}

// Walking at 80 m/min (~4.8 km/h)
export function walkingMinutes(distM: number): number {
  if (!isFinite(distM)) return Infinity;
  return Math.round(distM / 80);
}

// Estimated bus: 3 min walk to stop + 5 min wait + travel at ~20 km/h with 1.5× road factor
// Minimum 8 min.
export function busMinutes(distM: number): number {
  if (!isFinite(distM)) return Infinity;
  const travel = (distM * 1.5) / (20000 / 60); // metres → minutes at 20 km/h
  return Math.max(8, Math.round(3 + 5 + travel));
}

export interface TravelTimes {
  walkMins: number;
  busMins: number;
}

export function travelTimes(fromLat: number, fromLng: number, toLat: number, toLng: number): TravelTimes {
  const distM = haversineMetres(fromLat, fromLng, toLat, toLng);
  return { walkMins: walkingMinutes(distM), busMins: busMinutes(distM) };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

// ── Score functions (all return 1-5) ─────────────────────────────────────────

export function mrtScore(distanceMetres: number): number {
  if (!isFinite(distanceMetres)) return 1;
  const ratio = (SCORE_1_M - distanceMetres) / (SCORE_1_M - SCORE_5_M);
  return clamp(Math.round(ratio * 4 + 1), 1, 5);
}

/**
 * Parse PropertyGuru's MRT info string, e.g.:
 *   "180 m (2 mins) from NE16/STC Sengkang MRT"
 *   "350 m (5 mins) from Orchard MRT"
 */
export interface ParsedMrt {
  distM: number;       // metres
  walkMins: number;    // minutes
  stationName: string; // e.g. "Sengkang MRT"
}

export function parseMrtInfo(mrtInfo: string | null): ParsedMrt | null {
  if (!mrtInfo) return null;
  // Match distance in metres
  const distMatch = mrtInfo.match(/(\d[\d,]*)\s*m\b/i);
  const distM = distMatch ? parseInt(distMatch[1].replace(/,/g, ''), 10) : NaN;
  // Match walk minutes
  const minsMatch = mrtInfo.match(/\((\d+)\s*min/i);
  const walkMins = minsMatch ? parseInt(minsMatch[1], 10) : NaN;
  // Match station name — everything after "from" up to end
  const stationMatch = mrtInfo.match(/from\s+(?:[A-Z0-9\/]+\s+)?(.+)/i);
  const stationName = stationMatch ? stationMatch[1].trim() : '';

  if (!stationName) return null;
  return {
    distM: isNaN(distM) ? walkMins * 80 : distM, // estimate metres if missing
    walkMins: isNaN(walkMins) ? Math.round((isNaN(distM) ? Infinity : distM) / 80) : walkMins,
    stationName,
  };
}

export function mrtScoreFromWalkMins(walkMins: number): number {
  if (!isFinite(walkMins)) return 1;
  // ≤5 min → 5, ≤8 → 4, ≤12 → 3, ≤20 → 2, >20 → 1
  if (walkMins <= 5) return 5;
  if (walkMins <= 8) return 4;
  if (walkMins <= 12) return 3;
  if (walkMins <= 20) return 2;
  return 1;
}

export function affordabilityScore(price: number, budgetCeiling: number): number {
  if (!budgetCeiling || price <= 0) return 1;
  const ratio = price / budgetCeiling;
  if (ratio <= 0.7) return 5;
  if (ratio <= 0.8) return 4;
  if (ratio <= 0.9) return 3;
  if (ratio <= 1.0) return 2;
  return 1;
}

export function sizeScores(sqftValues: number[]): number[] {
  const valid = sqftValues.filter(v => v > 0 && isFinite(v));
  if (valid.length === 0) return sqftValues.map(() => 1);
  const sorted = [...valid].sort((a, b) => a - b);
  const n = sorted.length;
  return sqftValues.map(v => {
    if (!v || v <= 0 || !isFinite(v)) return 1;
    const rank = sorted.findIndex(s => s >= v);
    const percentile = rank / n;
    return clamp(Math.ceil(percentile * 5) || 1, 1, 5);
  });
}

export function compositeScore(
  mrt: number,
  afford: number,
  size: number,
  weights: { mrt: number; affordability: number; size: number },
): number {
  const total = weights.mrt + weights.affordability + weights.size;
  if (total === 0) return 1;
  const weighted =
    (mrt * weights.mrt + afford * weights.affordability + size * weights.size) / total;
  return Math.round(weighted * 10) / 10;
}

// ── Parse price string from PropertyGuru ────────────────────────────────────
export function parsePrice(priceStr: string | null): number {
  if (!priceStr) return 0;
  const cleaned = priceStr.replace(/[^0-9.KkMm]/g, '');
  const lower = cleaned.toLowerCase();
  if (lower.includes('m')) return parseFloat(lower) * 1_000_000;
  if (lower.includes('k')) return parseFloat(lower) * 1_000;
  return parseFloat(cleaned.replace(/,/g, '')) || 0;
}

export function parseSqft(sizeStr: string | null): number {
  if (!sizeStr) return 0;
  const cleaned = sizeStr.replace(/[^0-9.]/g, '');
  return parseFloat(cleaned) || 0;
}
