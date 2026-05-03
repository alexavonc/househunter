/**
 * Target MRT stations for scoring.
 * Edit this list to change which stations are considered "close".
 * Coordinates are WGS84 (lat, lng).
 * The MRT Score is based on straight-line distance to the NEAREST station in this list.
 */
export interface MrtTarget {
  name: string;
  lat: number;
  lng: number;
}

export const MRT_TARGETS: MrtTarget[] = [
  { name: 'Tanjong Pagar MRT', lat: 1.2765, lng: 103.8458 },
  { name: 'Raffles Place MRT', lat: 1.2830, lng: 103.8513 },
  { name: 'Marina Bay MRT', lat: 1.2762, lng: 103.8554 },
  { name: 'Orchard MRT', lat: 1.3040, lng: 103.8318 },
  { name: 'Novena MRT', lat: 1.3204, lng: 103.8438 },
  { name: 'Bishan MRT', lat: 1.3511, lng: 103.8485 },
];

// Scoring thresholds (metres)
// Distance ≤ SCORE_5_M → score 5, linear interpolation down to SCORE_1_M → score 1
export const SCORE_5_M = 400;   // within 400m = excellent
export const SCORE_1_M = 2000;  // beyond 2km = poor
