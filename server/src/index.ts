import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const app = express();
const PORT = process.env.PORT || 3001;
const UPLOAD_PASSWORD = process.env.UPLOAD_PASSWORD || 'changeme';

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Commute destinations (keep in sync with app/src/config/commuteDestinations.ts) ──
const COMMUTE_DESTINATIONS = [
  { label: 'Newton MRT',         gmapsQuery: 'Newton MRT Station, Singapore' },
  { label: '817 Tampines St 81', gmapsQuery: '817 Tampines Street 81, Singapore' },
];

// ── Types ────────────────────────────────────────────────────────────────────

interface TransitTimes {
  commutes: { label: string; transitMins: number | null }[];
  busMinsToMrt: number | null;
}

interface Listing {
  listingId: string | null;
  title: string | null;
  url: string | null;
  imageUrl?: string | null;
  price: string | null;
  pricePerSqft: string | null;
  size: string | null;
  address: string | null;
  bedrooms: string | null;
  bathrooms: string | null;
  mrtInfo: string | null;
  enquiryStatus?: string;
  _transitTimes?: TransitTimes | null;
  [key: string]: unknown;
}

interface Store {
  exportedAt: string | null;
  uploadedAt: string;
  count: number;
  listings: Listing[];
}

// ── Store helpers ────────────────────────────────────────────────────────────

function readStore(): Store | null {
  try {
    if (!fs.existsSync(STORE_PATH)) return null;
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')) as Store;
  } catch {
    return null;
  }
}

function writeStore(store: Store): void {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function listingKey(l: Listing): string {
  return l.url || l.listingId || l.title || '';
}

// ── MRT station name parser (mirrors app/src/lib/scoring.ts parseMrtInfo) ───

function parseMrtStation(mrtInfo: string | null): string | null {
  if (!mrtInfo) return null;
  const m = mrtInfo.match(/from\s+(?:[A-Z0-9/]+\s+)?(.+)/i);
  return m ? m[1].trim() : null;
}

// ── Google Maps Distance Matrix call ────────────────────────────────────────

async function fetchTransitTimes(listing: Listing): Promise<TransitTimes | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  const origin = listing.address || listing.title || '';
  if (!origin) return null;

  const mrtStation = parseMrtStation(listing.mrtInfo);
  const destinations = [
    ...COMMUTE_DESTINATIONS.map(d => d.gmapsQuery),
    ...(mrtStation ? [`${mrtStation}, Singapore`] : []),
  ];

  try {
    const params = new URLSearchParams({
      origins: origin.includes('Singapore') ? origin : `${origin}, Singapore`,
      destinations: destinations.join('|'),
      mode: 'transit',
      region: 'sg',
      key: apiKey,
    });
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/distancematrix/json?${params}`,
    );
    const data = await res.json() as {
      status: string;
      rows: { elements: { status: string; duration: { value: number } }[] }[];
    };

    if (data.status !== 'OK') return null;
    const elements = data.rows[0]?.elements ?? [];

    const commutes = COMMUTE_DESTINATIONS.map((d, i) => ({
      label: d.label,
      transitMins: elements[i]?.status === 'OK'
        ? Math.round(elements[i].duration.value / 60)
        : null,
    }));
    const busMinsToMrt = mrtStation && elements[COMMUTE_DESTINATIONS.length]?.status === 'OK'
      ? Math.round(elements[COMMUTE_DESTINATIONS.length].duration.value / 60)
      : null;

    return { commutes, busMinsToMrt };
  } catch {
    return null;
  }
}

// ── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/json' || file.originalname.endsWith('.json')) cb(null, true);
    else cb(new Error('Only JSON files are accepted'));
  },
});

function requirePassword(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const provided = req.headers['x-upload-password'] || req.body?.password;
  if (provided !== UPLOAD_PASSWORD) { res.status(401).json({ error: 'Unauthorized' }); return; }
  next();
}

// ── API ──────────────────────────────────────────────────────────────────────

app.get('/api/listings', (_req, res) => {
  const store = readStore();
  res.json(store ?? { listings: [], uploadedAt: null, count: 0 });
});

// POST /api/upload
// - Deduplicates by URL (first occurrence wins within the new file)
// - Merges enquiry status and transit times from existing store by URL
// - Calls Google Maps for any listing that doesn't yet have transit times
app.post('/api/upload', requirePassword, upload.single('file'), async (req, res) => {
  if (!req.file) { res.status(400).json({ error: 'No file provided' }); return; }

  let parsed: { exportedAt?: string; listings: Listing[] };
  try {
    parsed = JSON.parse(req.file.buffer.toString('utf8'));
  } catch {
    res.status(400).json({ error: 'Invalid JSON' }); return;
  }
  if (!Array.isArray(parsed.listings)) {
    res.status(400).json({ error: 'JSON must have a "listings" array' }); return;
  }

  // Build lookup maps from existing store
  const existing = readStore();
  const existingByKey = new Map<string, Listing>();
  if (existing) {
    for (const l of existing.listings) {
      const k = listingKey(l);
      if (k) existingByKey.set(k, l);
    }
  }

  // Deduplicate incoming listings by URL (first occurrence wins)
  const seenKeys = new Set<string>();
  const deduped: Listing[] = [];
  for (const l of parsed.listings) {
    const k = listingKey(l);
    if (k && seenKeys.has(k)) continue;
    if (k) seenKeys.add(k);
    const prev = existingByKey.get(k);
    deduped.push({
      ...l,
      enquiryStatus: prev?.enquiryStatus || l.enquiryStatus || 'Not Contacted',
      _transitTimes: prev?._transitTimes ?? null, // carry over cached transit times
    });
  }

  // Fetch Google Maps transit times for listings that don't have them yet
  const hasApiKey = !!process.env.GOOGLE_MAPS_API_KEY;
  if (hasApiKey) {
    for (let i = 0; i < deduped.length; i++) {
      if (deduped[i]._transitTimes) continue; // already cached
      deduped[i]._transitTimes = await fetchTransitTimes(deduped[i]);
      if (i < deduped.length - 1) await new Promise(r => setTimeout(r, 150));
    }
  }

  const store: Store = {
    exportedAt: parsed.exportedAt ?? null,
    uploadedAt: new Date().toISOString(),
    count: deduped.length,
    listings: deduped,
  };
  writeStore(store);
  res.json({ success: true, count: deduped.length });
});

// PATCH /api/listings/:index/status
app.patch('/api/listings/:index/status', (req, res) => {
  const idx = parseInt(req.params.index, 10);
  const { status } = req.body as { status: string };
  const VALID = ['Not Contacted','Enquired','Viewing Scheduled','Viewed','Offer Made','Rejected','Shortlisted'];
  if (!VALID.includes(status)) { res.status(400).json({ error: 'Invalid status' }); return; }

  const store = readStore();
  if (!store) { res.status(404).json({ error: 'No data uploaded yet' }); return; }
  if (idx < 0 || idx >= store.listings.length) { res.status(404).json({ error: 'Listing not found' }); return; }

  store.listings[idx].enquiryStatus = status;
  writeStore(store);
  res.json({ success: true });
});

// Serve React build
const clientDist = path.join(__dirname, '..', 'app', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
} else {
  app.get('*', (_req, res) =>
    res.status(503).send('React build not found. Run "npm run build" in /app first.'));
}

app.listen(PORT, () => console.log(`Househunter server running on port ${PORT}`));
export default app;
