'use client';

import Image from 'next/image';
import type { SearchSuggestion } from '@chirawa/types';
import { formatPaise } from '@/lib/format';

// Autocomplete dropdown under the search input: a "search for …" row plus
// product suggestions (click → PDP).
export function SuggestDropdown({
  query,
  suggestions,
  onSubmitQuery,
  onPickProduct,
}: {
  query: string;
  suggestions: SearchSuggestion[];
  onSubmitQuery: (q: string) => void;
  onPickProduct: (productId: string) => void;
}) {
  return (
    <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-hairline bg-surface shadow-soft">
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onSubmitQuery(query)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-primary hover:bg-primary-light"
      >
        <span aria-hidden>🔍</span>
        <span className="truncate">&lsquo;{query}&rsquo; खोजें</span>
      </button>

      {suggestions.map((s) => (
        <button
          key={s.id}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPickProduct(s.id)}
          className="flex w-full items-center gap-3 border-t border-divider px-4 py-2 text-left hover:bg-surface-alt"
        >
          <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-md bg-surface-alt">
            {s.imageUrl ? (
              <Image src={s.imageUrl} alt="" fill sizes="36px" className="object-contain" />
            ) : (
              <span className="grid h-full place-items-center text-lg" aria-hidden>
                🛍️
              </span>
            )}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-ink">{s.name}</span>
          <span className="text-xs font-bold text-ink-muted">{formatPaise(s.pricePaise)}</span>
        </button>
      ))}
    </div>
  );
}
