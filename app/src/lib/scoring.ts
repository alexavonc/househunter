import { MRT_TARGETS, SCORE_1_M, SCORE_5_M } from '../config/mrtTargets';

// ── Geo helpers ──────────────────────────────────────────────────────────────

function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
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

export function closestMrtMetres(lat: number, lng: number): number {
  if (MRT_TARGETS.length === 0) return Infinity;
  return Math.min(...MRT_TARGETS.map(t => haversineMetres(lat, lng, t.lat, t.lng)));
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

// ── Score functions (all return 1-5) ─────────────────────────────────────────

export function mrtScore(distanceMetres: number): number {
  if (!isFinite(distanceMetres)) return 1;
  // Linear mapping: SCORE_5_M → 5, SCORE_1_M → 1
  const ratio = (SCORE_1_M - distanceMetres) / (SCORE_1_M - SCORE_5_M);
  return clamp(Math.round(ratio * 4 + 1), 1, 5);
}

export function affordabilityScore(price: number, budgetCeiling: number): number {
  if (!budgetCeiling || price <= 0) return 1;
  // Price well under budget → 5; at/over budget → 1
  const ratio = price / budgetCeiling;
  if (ratio <= 0.7) return 5;
  if (ratio <= 0.8) return 4;
  if (ratio <= 0.9) return 3;
  if (ratio <= 1.0) return 2;
  return 1;
}

/**
 * Size score: rank-based within the set.
 * Larger is better. Divide into quintiles.
 */
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
  // e.g. "S$1,200,000", "$1.2M", "1,200,000"
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
