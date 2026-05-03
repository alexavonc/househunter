import { useState, useEffect, useCallback } from 'react';
import { fetchListings, uploadFile, updateStatus, type Listing, type StoreData } from './lib/api';
import { geocodeAddress } from './lib/geocode';
import {
  closestMrtMetres,
  mrtScore,
  affordabilityScore,
  sizeScores,
  compositeScore,
  parsePrice,
  parseSqft,
} from './lib/scoring';
import { downloadCsv } from './lib/csv';
import UploadPanel from './components/UploadPanel';
import FilterBar from './components/FilterBar';
import ListingsTable from './components/ListingsTable';
import WeightsPanel from './components/WeightsPanel';

export interface ScoredListing extends Listing {
  _index: number;
  _priceNum: number;
  _sqftNum: number;
  _mrtDistM: number;
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

export default function App() {
  const [storeData, setStoreData] = useState<StoreData | null>(null);
  const [scoredListings, setScoredListings] = useState<ScoredListing[]>([]);
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [budgetCeiling, setBudgetCeiling] = useState<number>(DEFAULT_BUDGET);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeProgress, setGeocodeProgress] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Geocode cache keyed by address
  const [geoCache, setGeoCache] = useState<Map<string, number>>(new Map());

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

  // Geocode all listings whenever storeData changes
  useEffect(() => {
    if (!storeData || storeData.listings.length === 0) {
      setScoredListings([]);
      return;
    }

    let cancelled = false;
    setGeocoding(true);
    setGeocodeProgress(0);

    (async () => {
      const listings = storeData.listings;
      const distMap = new Map<string, number>(geoCache);
      let done = 0;

      for (const listing of listings) {
        if (cancelled) break;
        const addr = listing.address || listing.title || '';
        if (addr && !distMap.has(addr)) {
          const coords = await geocodeAddress(addr);
          if (coords) {
            distMap.set(addr, closestMrtMetres(coords.lat, coords.lng));
          } else {
            distMap.set(addr, Infinity);
          }
        }
        done++;
        setGeocodeProgress(Math.round((done / listings.length) * 100));
      }

      if (!cancelled) {
        setGeoCache(new Map(distMap));
        rebuildScores(listings, distMap);
        setGeocoding(false);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeData]);

  // Rebuild scores when weights/budget change
  useEffect(() => {
    if (!storeData) return;
    rebuildScores(storeData.listings, geoCache);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weights, budgetCeiling, geoCache]);

  function rebuildScores(listings: Listing[], distMap: Map<string, number>) {
    const prices = listings.map(l => parsePrice(l.price));
    const sqfts = listings.map(l => parseSqft(l.size));
    const sizeScoreArr = sizeScores(sqfts);

    const scored: ScoredListing[] = listings.map((l, i) => {
      const addr = l.address || l.title || '';
      const distM = distMap.get(addr) ?? Infinity;
      const mrt = mrtScore(distM);
      const afford = affordabilityScore(prices[i], budgetCeiling);
      const sz = sizeScoreArr[i];
      const comp = compositeScore(mrt, afford, sz, weights);
      return {
        ...l,
        _index: i,
        _priceNum: prices[i],
        _sqftNum: sqfts[i],
        _mrtDistM: distM,
        mrtScore: mrt,
        affordabilityScore: afford,
        sizeScore: sz,
        compositeScore: comp,
      };
    });
    setScoredListings(scored);
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
    const rows = filtered.map(l => ({
      Title: l.title ?? '',
      URL: l.url ?? '',
      Price: l.price ?? '',
      'Price/sqft': l.pricePerSqft ?? '',
      'Size (sqft)': l.size ?? '',
      Address: l.address ?? '',
      Bedrooms: l.bedrooms ?? '',
      Bathrooms: l.bathrooms ?? '',
      MRT: l.mrtInfo ?? '',
      'MRT Score': l.mrtScore,
      'Affordability Score': l.affordabilityScore,
      'Size Score': l.sizeScore,
      'Composite Score': l.compositeScore,
      'Enquiry Status': l.enquiryStatus ?? '',
    }));
    downloadCsv(rows, `househunter-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  async function handleUpload(file: File, password: string) {
    await uploadFile(file, password);
    await loadData();
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <header style={{
        background: 'var(--red)',
        color: '#fff',
        padding: '14px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <h1 style={{ color: '#fff', fontSize: '1.2rem' }}>Househunter</h1>
          <div style={{ fontSize: '11px', opacity: 0.8 }}>
            {storeData?.uploadedAt
              ? `Last updated ${new Date(storeData.uploadedAt).toLocaleDateString()}`
              : 'No data uploaded yet'}
          </div>
        </div>
        <button
          className="btn-secondary"
          style={{ fontSize: '12px', padding: '6px 12px' }}
          onClick={() => setIsAdmin(v => !v)}
        >
          {isAdmin ? 'Hide Upload' : 'Upload Data'}
        </button>
      </header>

      <main style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 16px' }}>
        {isAdmin && (
          <UploadPanel onUpload={handleUpload} onClose={() => setIsAdmin(false)} />
        )}

        {loading && <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Loading…</div>}
        {error && <div style={{ color: 'var(--red)', padding: 16, background: 'var(--red-light)', borderRadius: 8 }}>{error}</div>}

        {!loading && !error && storeData && (
          <>
            <WeightsPanel
              weights={weights}
              onWeightsChange={setWeights}
              budgetCeiling={budgetCeiling}
              onBudgetChange={setBudgetCeiling}
            />

            <FilterBar filters={filters} onFiltersChange={setFilters} />

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                {geocoding
                  ? `Geocoding… ${geocodeProgress}%`
                  : `${filtered.length} of ${scoredListings.length} listings`}
              </div>
              <button className="btn-secondary" onClick={handleExportCsv} style={{ fontSize: 12 }}>
                Export CSV
              </button>
            </div>

            <ListingsTable
              listings={filtered}
              onStatusChange={handleStatusChange}
            />
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
