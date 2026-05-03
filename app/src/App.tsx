import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchListings, uploadFile, updateStatus, type Listing, type StoreData } from './lib/api';
import {
  mrtScoreFromWalkMins,
  parseMrtInfo,
  affordabilityScore,
  sizeScores,
  compositeScore,
  parsePrice,
  parseSqft,
} from './lib/scoring';
import { downloadCsv } from './lib/csv';
import { COMMUTE_DESTINATIONS } from './config/commuteDestinations';
import UploadPanel from './components/UploadPanel';
import FilterBar from './components/FilterBar';
import ListingsTable from './components/ListingsTable';
import WeightsPanel from './components/WeightsPanel';

export interface CommuteTimes {
  label: string;
  transitMins: number | null;
}

export interface ScoredListing extends Listing {
  _index: number;
  _priceNum: number;
  _sqftNum: number;
  _mrtDistM: number;
  _mrtName: string;
  _walkMins: number;
  _busMinsToMrt: number | null;   // Google Maps transit to nearest MRT
  _commutes: CommuteTimes[];       // Google Maps transit to each commute destination
  mrtScore: number;
  affordabilityScore: number;
  sizeScore: number;
  compositeScore: number;
}

export interface Weights {
  mrt: number;
  affordability: number;
  size: number;
}

export interface Filters {
  minPrice: string;
  maxPrice: string;
  minSqft: string;
  district: string;
  status: string;
}

const DEFAULT_WEIGHTS: Weights = { mrt: 1, affordability: 1, size: 1 };
const DEFAULT_FILTERS: Filters = { minPrice: '', maxPrice: '', minSqft: '', district: '', status: '' };
const DEFAULT_BUDGET = 2_000_000;

// ── Google Maps proxy helper ─────────────────────────────────────────────────

interface DistResult { durationMins: number | null; distanceM: number | null; }

async function fetchDistances(
  origin: string,
  destinations: string[],
  mode: 'transit' | 'walking' = 'transit',
): Promise<DistResult[]> {
  if (!origin || destinations.length === 0) return destinations.map(() => ({ durationMins: null, distanceM: null }));
  try {
    const params = new URLSearchParams({
      origin: origin.includes('Singapore') ? origin : `${origin}, Singapore`,
      destinations: destinations.join('|'),
      mode,
    });
    const res = await fetch(`/api/distance?${params}`);
    if (!res.ok) return destinations.map(() => ({ durationMins: null, distanceM: null }));
    const data = await res.json() as { results: DistResult[] };
    return data.results ?? destinations.map(() => ({ durationMins: null, distanceM: null }));
  } catch {
    return destinations.map(() => ({ durationMins: null, distanceM: null }));
  }
}

// ── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [storeData, setStoreData] = useState<StoreData | null>(null);
  const [scoredListings, setScoredListings] = useState<ScoredListing[]>([]);
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [budgetCeiling, setBudgetCeiling] = useState<number>(DEFAULT_BUDGET);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transitProgress, setTransitProgress] = useState<string | null>(null);

  // Transit time cache: listing address → { commutes, busMinsToMrt }
  const transitCache = useRef<Map<string, { commutes: CommuteTimes[]; busMinsToMrt: number | null }>>(new Map());

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchListings();
      setStoreData(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Build basic scores whenever data/weights/budget change
  useEffect(() => {
    if (!storeData) return;
    setScoredListings(buildScores(storeData.listings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeData, weights, budgetCeiling]);

  // Fetch Google Maps transit times in the background after data loads
  useEffect(() => {
    if (!storeData || storeData.listings.length === 0) return;
    let cancelled = false;

    (async () => {
      const listings = storeData.listings;
      for (let i = 0; i < listings.length; i++) {
        if (cancelled) break;
        const l = listings[i];
        const addr = l.address || l.title || '';
        if (!addr || transitCache.current.has(addr)) continue;

        setTransitProgress(`Fetching transit times ${i + 1}/${listings.length}…`);

        // Build destination list: commute destinations + nearest MRT (if known)
        const parsed = parseMrtInfo(l.mrtInfo);
        const mrtDest = parsed?.stationName ? `${parsed.stationName}, Singapore` : null;
        const commuteDests = COMMUTE_DESTINATIONS.map(d => d.gmapsQuery);
        const allDests = [...commuteDests, ...(mrtDest ? [mrtDest] : [])];

        const results = await fetchDistances(addr, allDests, 'transit');

        const commutes: CommuteTimes[] = COMMUTE_DESTINATIONS.map((d, j) => ({
          label: d.label,
          transitMins: results[j]?.durationMins ?? null,
        }));
        const busMinsToMrt = mrtDest ? (results[commuteDests.length]?.durationMins ?? null) : null;

        transitCache.current.set(addr, { commutes, busMinsToMrt });

        // Small delay to avoid hammering the API
        await new Promise(r => setTimeout(r, 150));
      }

      if (!cancelled) {
        setTransitProgress(null);
        setScoredListings(buildScores(listings));
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeData]);

  function buildScores(listings: Listing[]): ScoredListing[] {
    const prices = listings.map(l => parsePrice(l.price));
    const sqfts = listings.map(l => parseSqft(l.size));
    const sizeScoreArr = sizeScores(sqfts);

    return listings.map((l, i) => {
      const parsed = parseMrtInfo(l.mrtInfo);
      const mrtDistM = parsed?.distM ?? Infinity;
      const mrtName = parsed?.stationName ?? '—';
      const walkMins = parsed?.walkMins ?? Infinity;

      const addr = l.address || l.title || '';
      const cached = transitCache.current.get(addr);

      const mrt = mrtScoreFromWalkMins(walkMins);
      const afford = affordabilityScore(prices[i], budgetCeiling);
      const sz = sizeScoreArr[i];
      const comp = compositeScore(mrt, afford, sz, weights);

      return {
        ...l,
        _index: i,
        _priceNum: prices[i],
        _sqftNum: sqfts[i],
        _mrtDistM: mrtDistM,
        _mrtName: mrtName,
        _walkMins: walkMins,
        _busMinsToMrt: cached?.busMinsToMrt ?? null,
        _commutes: cached?.commutes ?? COMMUTE_DESTINATIONS.map(d => ({ label: d.label, transitMins: null })),
        mrtScore: mrt,
        affordabilityScore: afford,
        sizeScore: sz,
        compositeScore: comp,
      };
    });
  }

  function applyFilters(listings: ScoredListing[]): ScoredListing[] {
    return listings.filter(l => {
      if (filters.minPrice && l._priceNum > 0 && l._priceNum < Number(filters.minPrice)) return false;
      if (filters.maxPrice && l._priceNum > 0 && l._priceNum > Number(filters.maxPrice)) return false;
      if (filters.minSqft && l._sqftNum > 0 && l._sqftNum < Number(filters.minSqft)) return false;
      if (filters.district && !((l.address || '').toLowerCase().includes(filters.district.toLowerCase()))) return false;
      if (filters.status && l.enquiryStatus !== filters.status) return false;
      return true;
    });
  }

  const filtered = applyFilters(scoredListings)
    .sort((a, b) => b.compositeScore - a.compositeScore);

  async function handleStatusChange(index: number, status: string) {
    try {
      await updateStatus(index, status);
      setScoredListings(prev =>
        prev.map(l => l._index === index ? { ...l, enquiryStatus: status } : l),
      );
      if (storeData) {
        setStoreData({
          ...storeData,
          listings: storeData.listings.map((l, i) =>
            i === index ? { ...l, enquiryStatus: status } : l,
          ),
        });
      }
    } catch (e) {
      alert((e as Error).message);
    }
  }

  function handleExportCsv() {
    const rows = filtered.map(l => {
      const commuteVals: Record<string, string | number> = {};
      l._commutes.forEach(c => {
        commuteVals[`${c.label} transit (min)`] = c.transitMins ?? '';
      });
      return {
        Title: l.title ?? '',
        URL: l.url ?? '',
        Price: l.price ?? '',
        'Price/sqft': l.pricePerSqft ?? '',
        'Size (sqft)': l.size ?? '',
        Address: l.address ?? '',
        Bedrooms: l.bedrooms ?? '',
        Bathrooms: l.bathrooms ?? '',
        'Nearest MRT': l._mrtName,
        'Walk to MRT (min)': isFinite(l._walkMins) ? l._walkMins : '',
        'Bus to MRT (min)': l._busMinsToMrt ?? '',
        ...commuteVals,
        'MRT Score': l.mrtScore,
        'Affordability Score': l.affordabilityScore,
        'Size Score': l.sizeScore,
        'Composite Score': l.compositeScore,
        'Enquiry Status': l.enquiryStatus ?? '',
      };
    });
    downloadCsv(rows, `househunter-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  async function handleUpload(file: File, password: string) {
    transitCache.current.clear();
    await uploadFile(file, password);
    await loadData();
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <header style={{
        background: 'var(--red)', color: '#fff', padding: '14px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <h1 style={{ color: '#fff', fontSize: '1.2rem' }}>Househunter</h1>
          <div style={{ fontSize: '11px', opacity: 0.8 }}>
            {storeData?.uploadedAt
              ? `Last updated ${new Date(storeData.uploadedAt).toLocaleDateString()}`
              : 'No data uploaded yet'}
          </div>
        </div>
        <button className="btn-secondary" style={{ fontSize: '12px', padding: '6px 12px' }}
          onClick={() => setIsAdmin(v => !v)}>
          {isAdmin ? 'Hide Upload' : 'Upload Data'}
        </button>
      </header>

      <main style={{ maxWidth: 1600, margin: '0 auto', padding: '24px 16px' }}>
        {isAdmin && <UploadPanel onUpload={handleUpload} onClose={() => setIsAdmin(false)} />}

        {loading && <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Loading…</div>}
        {error && <div style={{ color: 'var(--red)', padding: 16, background: 'var(--red-light)', borderRadius: 8 }}>{error}</div>}

        {!loading && !error && storeData && (
          <>
            <WeightsPanel weights={weights} onWeightsChange={setWeights}
              budgetCeiling={budgetCeiling} onBudgetChange={setBudgetCeiling} />
            <FilterBar filters={filters} onFiltersChange={setFilters} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                {transitProgress ?? `${filtered.length} of ${scoredListings.length} listings`}
              </div>
              <button className="btn-secondary" onClick={handleExportCsv} style={{ fontSize: 12 }}>
                Export CSV
              </button>
            </div>
            <ListingsTable listings={filtered} onStatusChange={handleStatusChange}
              commuteLabels={COMMUTE_DESTINATIONS.map(d => d.label)} />
          </>
        )}

        {!loading && !error && (!storeData || storeData.listings.length === 0) && (
          <div style={{
            textAlign: 'center', padding: '60px 24px', color: 'var(--text-muted)',
            background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)',
          }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🏠</div>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>No listings yet</div>
            <div style={{ fontSize: 13 }}>Upload your PropertyGuru shortlist JSON using the "Upload Data" button.</div>
          </div>
        )}
      </main>
    </div>
  );
}
