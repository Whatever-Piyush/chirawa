'use client';

import type { SearchSort } from '@chirawa/types';

// Filter state the search page keeps in the URL. Prices are held in ₹ here
// (converted to paise only when calling the API).
export interface UiFilters {
  category?: string;
  inStock?: boolean;
  sort?: SearchSort;
  minRupees?: number;
  maxRupees?: number;
}

const SORTS: { value: SearchSort; label: string }[] = [
  { value: 'relevance', label: 'प्रासंगिकता' },
  { value: 'priceLow', label: 'कीमत: कम → ज़्यादा' },
  { value: 'priceHigh', label: 'कीमत: ज़्यादा → कम' },
  { value: 'rating', label: 'रेटिंग' },
];

export function Filters({
  value,
  onChange,
  categories,
}: {
  value: UiFilters;
  onChange: (next: UiFilters) => void;
  categories: string[];
}) {
  const set = (patch: Partial<UiFilters>) => onChange({ ...value, ...patch });

  return (
    <div className="mt-3 space-y-2">
      {/* Category chips */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Chip active={!value.category} onClick={() => set({ category: undefined })}>
          सभी
        </Chip>
        {categories.map((c) => (
          <Chip key={c} active={value.category === c} onClick={() => set({ category: c })}>
            {c}
          </Chip>
        ))}
      </div>

      {/* Stock / price / sort row */}
      <div className="flex flex-wrap items-center gap-2">
        <Chip active={!!value.inStock} onClick={() => set({ inStock: value.inStock ? undefined : true })}>
          सिर्फ़ उपलब्ध
        </Chip>

        <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
          ₹
          <input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="कम से कम"
            value={value.minRupees ?? ''}
            onChange={(e) =>
              set({ minRupees: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })
            }
            className="w-20 rounded-lg border border-hairline bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-primary"
          />
          –
          <input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="ज़्यादा से ज़्यादा"
            value={value.maxRupees ?? ''}
            onChange={(e) =>
              set({ maxRupees: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })
            }
            className="w-24 rounded-lg border border-hairline bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-primary"
          />
        </span>

        <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-ink-muted">
          क्रमबद्ध करें
          <select
            value={value.sort ?? 'relevance'}
            onChange={(e) => set({ sort: e.target.value as SearchSort })}
            className="rounded-lg border border-hairline bg-surface px-2 py-1.5 text-xs font-semibold text-ink outline-none focus:border-primary"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
        active
          ? 'border-primary bg-primary text-white'
          : 'border-hairline bg-surface text-ink-muted hover:border-primary hover:text-primary'
      }`}
    >
      {children}
    </button>
  );
}
