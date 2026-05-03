/**
 * Fixed destinations to show transit time columns for.
 * gmapsQuery is passed directly to Google Maps Distance Matrix API as the destination.
 * Add or remove entries freely — the table columns update automatically.
 */
export interface CommuteDestination {
  label: string;       // Column header label
  gmapsQuery: string;  // Google Maps-resolvable address / place name
}

export const COMMUTE_DESTINATIONS: CommuteDestination[] = [
  { label: 'Newton MRT',       gmapsQuery: 'Newton MRT Station, Singapore' },
  { label: '817 Tampines St 81', gmapsQuery: '817 Tampines Street 81, Singapore' },
];
