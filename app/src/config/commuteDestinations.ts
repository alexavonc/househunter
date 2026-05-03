/**
 * Fixed destinations to show commute time columns for.
 * - Provide lat/lng directly for well-known locations (no geocoding needed).
 * - Provide address to geocode via OneMap (geocoded once at app startup).
 */
export interface CommuteDestination {
  label: string;       // Column header label
  lat?: number;
  lng?: number;
  address?: string;    // Used when lat/lng not provided
}

export const COMMUTE_DESTINATIONS: CommuteDestination[] = [
  {
    label: 'Newton MRT',
    lat: 1.3132,
    lng: 103.8380,
  },
  {
    label: '817 Tampines St 81',
    address: '817 Tampines Street 81',
  },
];
