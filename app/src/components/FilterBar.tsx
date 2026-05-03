import type { Filters } from '../App';

const STATUSES = [
  'Not Contacted', 'Enquired', 'Viewing Scheduled', 'Viewed',
  'Offer Made', 'Rejected', 'Shortlisted',
];

interface Props {
  filters: Filters;
  onFiltersChange: (f: Filters) => void;
}

export default function FilterBar({ filters, onFiltersChange }: Props) {
  function set(key: keyof Filters, value: string) {
    onFiltersChange({ ...filters, [key]: value });
  }

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      padding: '14px 20px',
      marginBottom: 16,
      display: 'flex',
      gap: 12,
      flexWrap: 'wrap',
      alignItems: 'flex-end',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Min Price (S$)</label>
        <input
          type="number" placeholder="e.g. 800000" value={filters.minPrice}
          onChange={e => set('minPrice', e.target.value)} style={{ width: 130 }}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Max Price (S$)</label>
        <input
          type="number" placeholder="e.g. 2000000" value={filters.maxPrice}
          onChange={e => set('maxPrice', e.target.value)} style={{ width: 130 }}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Min Size (sqft)</label>
        <input
          type="number" placeholder="e.g. 800" value={filters.minSqft}
          onChange={e => set('minSqft', e.target.value)} style={{ width: 110 }}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>District / Area</label>
        <input
          type="text" placeholder="e.g. Bishan" value={filters.district}
          onChange={e => set('district', e.target.value)} style={{ width: 130 }}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Enquiry Status</label>
        <select value={filters.status} onChange={e => set('status', e.target.value)} style={{ width: 160 }}>
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <button
        className="btn-secondary"
        style={{ height: 32, fontSize: 12 }}
        onClick={() => onFiltersChange({ minPrice: '', maxPrice: '', minSqft: '', district: '', status: '' })}
      >
        Clear
      </button>
    </div>
  );
}
