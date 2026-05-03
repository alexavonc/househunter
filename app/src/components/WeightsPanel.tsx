import type { Weights } from '../App';

interface Props {
  weights: Weights;
  onWeightsChange: (w: Weights) => void;
  budgetCeiling: number;
  onBudgetChange: (b: number) => void;
}

function Slider({
  label, value, onChange,
}: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 120 }}>
      <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
        <span>{label}</span>
        <strong style={{ color: 'var(--text)' }}>{value}</strong>
      </label>
      <input
        type="range"
        min={0}
        max={5}
        step={0.5}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: '100%' }}
      />
    </div>
  );
}

export default function WeightsPanel({ weights, onWeightsChange, budgetCeiling, onBudgetChange }: Props) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      padding: '16px 20px',
      marginBottom: 16,
    }}>
      <h2 style={{ marginBottom: 14, fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>
        SCORING WEIGHTS &amp; BUDGET
      </h2>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Slider label="MRT Weight" value={weights.mrt} onChange={v => onWeightsChange({ ...weights, mrt: v })} />
        <Slider label="Affordability Weight" value={weights.affordability} onChange={v => onWeightsChange({ ...weights, affordability: v })} />
        <Slider label="Size Weight" value={weights.size} onChange={v => onWeightsChange({ ...weights, size: v })} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Budget Ceiling (S$)</label>
          <input
            type="number"
            value={budgetCeiling}
            min={0}
            step={50000}
            onChange={e => onBudgetChange(Number(e.target.value))}
            style={{ width: 140 }}
          />
        </div>
      </div>
    </div>
  );
}
