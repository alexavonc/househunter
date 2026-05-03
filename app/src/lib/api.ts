const BASE = '/api';

export interface Listing {
  listingId: string | null;
  title: string | null;
  url: string | null;
  imageUrl: string | null;
  price: string | null;
  pricePerSqft: string | null;
  size: string | null;
  address: string | null;
  bedrooms: string | null;
  bathrooms: string | null;
  mrtInfo: string | null;
  enquiryStatus?: string;
}

export interface StoreData {
  exportedAt: string | null;
  uploadedAt: string | null;
  count: number;
  listings: Listing[];
}

export async function fetchListings(): Promise<StoreData> {
  const res = await fetch(`${BASE}/listings`);
  if (!res.ok) throw new Error('Failed to load listings');
  return res.json() as Promise<StoreData>;
}

export async function uploadFile(file: File, password: string): Promise<{ count: number }> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/upload`, {
    method: 'POST',
    headers: { 'x-upload-password': password },
    body: form,
  });
  if (!res.ok) {
    const err = (await res.json()) as { error: string };
    throw new Error(err.error || 'Upload failed');
  }
  return res.json() as Promise<{ count: number }>;
}

export async function updateStatus(index: number, status: string): Promise<void> {
  const res = await fetch(`${BASE}/listings/${index}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error('Status update failed');
}
