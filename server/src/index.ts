import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const app = express();
const PORT = process.env.PORT || 3001;
const UPLOAD_PASSWORD = process.env.UPLOAD_PASSWORD || 'changeme';

// Data directory — Railway ephemeral FS, or local dev
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ── Store helpers ────────────────────────────────────────────────────────────

interface Listing {
  listingId: string | null;
  title: string | null;
  url: string | null;
  price: string | null;
  pricePerSqft: string | null;
  size: string | null;
  address: string | null;
  bedrooms: string | null;
  bathrooms: string | null;
  mrtInfo: string | null;
  enquiryStatus?: string;
  [key: string]: unknown;
}

interface Store {
  exportedAt: string | null;
  uploadedAt: string;
  count: number;
  listings: Listing[];
}

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

// ── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());

// Multer — memory storage, 10 MB limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/json' || file.originalname.endsWith('.json')) {
      cb(null, true);
    } else {
      cb(new Error('Only JSON files are accepted'));
    }
  },
});

// Auth middleware for write endpoints
function requirePassword(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const provided = req.headers['x-upload-password'] || req.body?.password;
  if (provided !== UPLOAD_PASSWORD) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

// ── API routes ───────────────────────────────────────────────────────────────

// GET /api/listings — return current store
app.get('/api/listings', (_req, res) => {
  const store = readStore();
  if (!store) {
    res.json({ listings: [], uploadedAt: null });
    return;
  }
  res.json(store);
});

// POST /api/upload — upload new JSON export (password protected)
app.post('/api/upload', requirePassword, upload.single('file'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file provided' });
    return;
  }
  let parsed: Store;
  try {
    parsed = JSON.parse(req.file.buffer.toString('utf8')) as Store;
  } catch {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }

  if (!Array.isArray(parsed.listings)) {
    res.status(400).json({ error: 'JSON must have a "listings" array' });
    return;
  }

  // Preserve existing enquiryStatus values keyed by listing URL or id
  const existing = readStore();
  const statusMap = new Map<string, string>();
  if (existing) {
    for (const l of existing.listings) {
      const key = l.url || l.listingId || l.title || '';
      if (key && l.enquiryStatus) statusMap.set(key, l.enquiryStatus);
    }
  }

  const listings: Listing[] = parsed.listings.map((l: Listing) => {
    const key = l.url || l.listingId || l.title || '';
    return {
      ...l,
      enquiryStatus: statusMap.get(key) || l.enquiryStatus || 'Not Contacted',
    };
  });

  const store: Store = {
    exportedAt: parsed.exportedAt || null,
    uploadedAt: new Date().toISOString(),
    count: listings.length,
    listings,
  };
  writeStore(store);
  res.json({ success: true, count: listings.length });
});

// PATCH /api/listings/:index/status — update enquiry status for one listing
app.patch('/api/listings/:index/status', (req, res) => {
  const idx = parseInt(req.params.index, 10);
  const { status } = req.body as { status: string };

  const VALID_STATUSES = [
    'Not Contacted',
    'Enquired',
    'Viewing Scheduled',
    'Viewed',
    'Offer Made',
    'Rejected',
    'Shortlisted',
  ];

  if (!VALID_STATUSES.includes(status)) {
    res.status(400).json({ error: 'Invalid status' });
    return;
  }

  const store = readStore();
  if (!store) {
    res.status(404).json({ error: 'No data uploaded yet' });
    return;
  }
  if (idx < 0 || idx >= store.listings.length) {
    res.status(404).json({ error: 'Listing not found' });
    return;
  }

  store.listings[idx].enquiryStatus = status;
  writeStore(store);
  res.json({ success: true });
});

// Serve React build in production
// __dirname = /app/dist (compiled server), React build copied to /app/app/dist by Dockerfile
const clientDist = path.join(__dirname, '..', 'app', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  app.get('*', (_req, res) => {
    res.status(503).send('React build not found. Run "npm run build" in /app first.');
  });
}

app.listen(PORT, () => {
  console.log(`Househunter server running on port ${PORT}`);
});

export default app;
