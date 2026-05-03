import { useState } from 'react';
import type { ScoredListing } from '../App';

const STATUSES = [
  'Not Contacted',
  'Enquired',
  'Viewing Scheduled',
  'Viewed',
  'Offer Made',
  'Rejected',
  'Shortlisted',
] as const;

type Status = typeof STATUSES[number];

const STATUS_COLORS: Record<Status, { bg: string; color: string }> = {
  'Not Contacted':     { bg: '#f0f0f0', color: '#555' },
  'Enquired':          { bg: '#e3f0ff', color: '#1a5fb4' },
  'Viewing Scheduled': { bg: '#fff3cd', color: '#856404' },
  'Viewed':            { bg: '#d0f0fd', color: '#007ba7' },
  'Offer Made':        { bg: '#ffeeba', color: '#6d4c00' },
  'Rejected':          { bg: '#ffd6d6', color: '#cc0000' },
  'Shortlisted':       { bg: '#d4edda', color: '#1a7a1a' },
};

function scoreColor(score: number): string {
  // 1 → red, 3 → yellow, 5 → green
  if (score >= 4.5) return '#1a7a1a';
  if (score >= 3.5) return '#5a8a00';
  if (score >= 2.5) return '#a07000';
  if (score >= 1.5) return '#c04000';
  return '#cc0000';
}

function scoreBg(score: number): string {
  if (score >= 4.5) return '#e8f5e9';
  if (score >= 3.5) return '#f1f8e9';
  if (score >= 2.5) return '#fffde7';
  if (score >= 1.5) return '#fff3e0';
  return '#ffeaea';
}

function ScoreCell({ score }: { score: number }) {
  return (
    <td style={{
      textAlign: 'center',
      background: scoreBg(score),
      color: scoreColor(score),
      fontWeight: 700,
      fontSize: 13,
      padding: '6px 8px',
    }}>
      {score}
    </td>
  );
}

type SortKey = keyof ScoredListing | null;

interface Props {
  listings: ScoredListing[];
  onStatusChange: (index: number, status: string) => Promise<void>;
}

export default function ListingsTable({ listings, onStatusChange }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('compositeScore');
  const [sortAsc, setSortAsc] = useState(false);
  const [updatingIdx, setUpdatingIdx] = useState<number | null>(null);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(v => !v);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  }

  const sorted = [...listings].sort((a, b) => {
    if (!sortKey) return 0;
    const av = a[sortKey];
    const bv = b[sortKey];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av).localeCompare(String(bv));
    return sortAsc ? cmp : -cmp;
  });

  async function handleStatus(listingIndex: number, status: string) {
    setUpdatingIdx(listingIndex);
    try {
      await onStatusChange(listingIndex, status);
    } finally {
      setUpdatingIdx(null);
    }
  }

  function SortTh({ label, k, title }: { label: string; k: SortKey; title?: string }) {
    return (
      <th
        title={title}
        onClick={() => handleSort(k)}
        style={{
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          padding: '10px 8px',
          background: sortKey === k ? '#fff5f5' : '#fafafa',
          userSelect: 'none',
          borderBottom: '2px solid var(--border)',
          fontWeight: 600,
          fontSize: 12,
          color: sortKey === k ? 'var(--red)' : 'var(--text-muted)',
        }}
      >
        {label} {sortKey === k ? (sortAsc ? '↑' : '↓') : ''}
      </th>
    );
  }

  if (listings.length === 0) {
    return (
      <div style={{
        textAlign: 'center', padding: '40px 24px',
        background: 'var(--surface)', borderRadius: 'var(--radius)',
        border: '1px solid var(--border)', color: 'var(--text-muted)',
      }}>
        No listings match your filters.
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface)', fontSize: 13 }}>
        <thead>
          <tr>
            <SortTh label="#" k={null} />
            <SortTh label="Title / Project" k="title" />
            <SortTh label="Price" k="_priceNum" />
            <SortTh label="$/sqft" k="pricePerSqft" />
            <SortTh label="Size" k="_sqftNum" />
            <SortTh label="Beds" k="bedrooms" />
            <SortTh label="Baths" k="bathrooms" />
            <SortTh label="Address" k="address" />
            <SortTh label="MRT" k="mrtInfo" />
            <SortTh label="MRT Score" k="mrtScore" title="1–5: proximity to target MRT stations" />
            <SortTh label="Afford." k="affordabilityScore" title="1–5: affordability relative to your budget" />
            <SortTh label="Size Score" k="sizeScore" title="1–5: size relative to other listings" />
            <SortTh label="★ Score" k="compositeScore" title="Weighted composite score" />
            <th style={{
              padding: '10px 8px', background: '#fafafa',
              borderBottom: '2px solid var(--border)', fontWeight: 600,
              fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap',
            }}>
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((listing, rowIdx) => {
            const status = (listing.enquiryStatus as Status) || 'Not Contacted';
            const statusStyle = STATUS_COLORS[status] ?? { bg: '#f0f0f0', color: '#555' };
            const isUpdating = updatingIdx === listing._index;

            return (
              <tr
                key={listing._index}
                style={{
                  borderBottom: '1px solid var(--border)',
                  background: rowIdx % 2 === 0 ? 'var(--surface)' : '#fbfbfb',
                }}
              >
                {/* Row number */}
                <td style={{ padding: '8px 8px', color: 'var(--text-muted)', textAlign: 'center', fontSize: 12 }}>
                  {rowIdx + 1}
                </td>

                {/* Title */}
                <td style={{ padding: '8px 10px', maxWidth: 220, minWidth: 160 }}>
                  {listing.url ? (
                    <a href={listing.url} target="_blank" rel="noreferrer"
                      style={{ fontWeight: 600, display: 'block', marginBottom: 2 }}>
                      {listing.title || '(no title)'}
                    </a>
                  ) : (
                    <span style={{ fontWeight: 600 }}>{listing.title || '(no title)'}</span>
                  )}
                </td>

                {/* Price */}
                <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', fontWeight: 600 }}>
                  {listing.price || '—'}
                </td>

                {/* Price/sqft */}
                <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                  {listing.pricePerSqft || '—'}
                </td>

                {/* Size */}
                <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                  {listing.size || '—'}
                </td>

                {/* Beds */}
                <td style={{ padding: '8px 8px', textAlign: 'center' }}>
                  {listing.bedrooms || '—'}
                </td>

                {/* Baths */}
                <td style={{ padding: '8px 8px', textAlign: 'center' }}>
                  {listing.bathrooms || '—'}
                </td>

                {/* Address */}
                <td style={{ padding: '8px 10px', color: 'var(--text-muted)', maxWidth: 200 }}>
                  {listing.address || '—'}
                </td>

                {/* MRT info */}
                <td style={{ padding: '8px 10px', color: 'var(--text-muted)', whiteSpace: 'nowrap', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {listing.mrtInfo || (
                    isFinite(listing._mrtDistM)
                      ? `~${Math.round(listing._mrtDistM)}m`
                      : '—'
                  )}
                </td>

                {/* MRT Score */}
                <ScoreCell score={listing.mrtScore} />

                {/* Affordability Score */}
                <ScoreCell score={listing.affordabilityScore} />

                {/* Size Score */}
                <ScoreCell score={listing.sizeScore} />

                {/* Composite Score */}
                <td style={{
                  textAlign: 'center', padding: '6px 8px',
                  background: scoreBg(listing.compositeScore),
                  color: scoreColor(listing.compositeScore),
                  fontWeight: 700, fontSize: 14,
                }}>
                  {listing.compositeScore.toFixed(1)}
                </td>

                {/* Enquiry Status */}
                <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: 12,
                      fontSize: 11,
                      fontWeight: 600,
                      background: statusStyle.bg,
                      color: statusStyle.color,
                      whiteSpace: 'nowrap',
                    }}>
                      {status}
                    </span>
                    <select
                      value={status}
                      disabled={isUpdating}
                      onChange={e => handleStatus(listing._index, e.target.value)}
                      style={{ fontSize: 11, padding: '2px 4px', border: '1px solid var(--border)', borderRadius: 4, background: '#fff' }}
                    >
                      {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
