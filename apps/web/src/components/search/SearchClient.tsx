'use client';

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { SearchFilters, SearchSort } from '@chirawa/types';
import { browserApi } from '@/lib/api/browser';
import { catalog } from '@/lib/catalog-types';
import { useDebounce } from '@/hooks/useDebounce';
import { SuggestDropdown } from '@/components/search/SuggestDropdown';
import { Filters, type UiFilters } from '@/components/search/Filters';
import { ResultsGrid } from '@/components/search/ResultsGrid';

const SORT_VALUES: SearchSort[] = ['relevance', 'priceLow', 'priceHigh', 'rating'];

// The URL is the single source of truth for the submitted query + filters
// (sharable/back-button-safe); only the raw input text is local state.
function parseUrl(sp: URLSearchParams): { q: string; ui: UiFilters } {
  const num = (v: string | null) => {
    const n = Number(v);
    return v !== null && Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  const sort = sp.get('sort') as SearchSort | null;
  return {
    q: sp.get('q')?.trim() ?? '',
    ui: {
      category: sp.get('category') ?? undefined,
      inStock: sp.get('inStock') === '1' ? true : undefined,
      sort: sort && SORT_VALUES.includes(sort) ? sort : undefined,
      minRupees: num(sp.get('min')),
      maxRupees: num(sp.get('max')),
    },
  };
}

function toApiFilters(ui: UiFilters): SearchFilters {
  return {
    ...(ui.category ? { category: ui.category } : {}),
    ...(ui.inStock ? { inStock: true } : {}),
    ...(ui.sort && ui.sort !== 'relevance' ? { sort: ui.sort } : {}),
    ...(ui.minRupees !== undefined ? { minPrice: Math.round(ui.minRupees * 100) } : {}),
    ...(ui.maxRupees !== undefined ? { maxPrice: Math.round(ui.maxRupees * 100) } : {}),
  };
}

export function SearchClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const { q: submittedQ, ui } = useMemo(() => parseUrl(new URLSearchParams(searchParams.toString())), [searchParams]);

  const [input, setInput] = useState(submittedQ);
  const [focused, setFocused] = useState(false);
  const debouncedInput = useDebounce(input.trim(), 300);

  const write = (q: string, f: UiFilters) => {
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    if (f.category) next.set('category', f.category);
    if (f.inStock) next.set('inStock', '1');
    if (f.sort && f.sort !== 'relevance') next.set('sort', f.sort);
    if (f.minRupees !== undefined) next.set('min', String(f.minRupees));
    if (f.maxRupees !== undefined) next.set('max', String(f.maxRupees));
    router.replace(`/search?${next.toString()}`, { scroll: false });
  };

  const submit = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setInput(trimmed);
    setFocused(false);
    write(trimmed, ui);
  };

  // Suggest-as-you-type (≥2 chars, only while the input differs from what's
  // already been searched).
  const suggestEnabled = focused && debouncedInput.length >= 2 && debouncedInput !== submittedQ;
  const { data: suggestData } = useQuery({
    queryKey: ['suggest', debouncedInput],
    queryFn: () => browserApi.suggest(debouncedInput),
    enabled: suggestEnabled,
    staleTime: 60_000,
  });

  // Filter changes re-query only after they settle briefly (price typing).
  const apiFilters = useDebounce(useMemo(() => toApiFilters(ui), [ui]), 350);
  const { data: result, isFetching } = useQuery({
    queryKey: ['search', submittedQ, apiFilters],
    queryFn: () => browserApi.search(submittedQ, apiFilters),
    enabled: submittedQ.length > 0,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => catalog.categories(browserApi),
    staleTime: 5 * 60_000,
  });

  const showSuggest =
    suggestEnabled && !!suggestData && (suggestData.suggestions.length > 0 || debouncedInput.length >= 2);

  return (
    <div className="mx-auto w-full max-w-content px-4 py-6 pb-28">
      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
      >
        <div className="flex items-center gap-2 rounded-full border-2 border-hairline bg-surface px-4 py-2.5 shadow-card transition-all duration-300 ease-spring focus-within:border-primary focus-within:shadow-lift">
          <span aria-hidden>🔍</span>
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="दुकान या सामान ढूंढो..."
            enterKeyHint="search"
            aria-label="खोजें"
            className="min-w-0 flex-1 bg-transparent text-md text-ink outline-none placeholder:text-ink-faint"
          />
          {input && (
            <button
              type="button"
              onClick={() => setInput('')}
              aria-label="साफ़ करें"
              className="grid h-6 w-6 place-items-center rounded-full bg-surface-alt text-xs text-ink-muted"
            >
              ✕
            </button>
          )}
          <button
            type="submit"
            className="tap-highlight-none rounded-full bg-primary px-4 py-1.5 text-sm font-bold text-white transition-all duration-200 ease-spring hover:bg-primary-dark hover:shadow-primary active:scale-95"
          >
            खोजें
          </button>
        </div>

        {showSuggest && (
          <SuggestDropdown
            query={debouncedInput}
            suggestions={suggestData.suggestions}
            onSubmitQuery={submit}
            onPickProduct={(id) => router.push(`/product/${id}`)}
          />
        )}
      </form>

      <Filters
        value={ui}
        onChange={(next) => write(submittedQ, next)}
        categories={(categories ?? []).map((c) => c.name)}
      />

      {submittedQ.length === 0 ? (
        <div className="grid place-items-center py-20 text-center">
          <p className="text-4xl" aria-hidden>
            🔍
          </p>
          <p className="mt-2 text-sm text-ink-muted">दुकान या सामान ढूंढो — जैसे “दूध”, “आटा”…</p>
        </div>
      ) : isFetching && !result ? (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-56 animate-pulse rounded-lg bg-surface-alt" />
          ))}
        </div>
      ) : result ? (
        <div className={isFetching ? 'opacity-60 transition-opacity' : ''}>
          <ResultsGrid result={result} />
        </div>
      ) : (
        <div className="grid place-items-center py-20 text-center">
          <p className="text-4xl" aria-hidden>
            ⚠️
          </p>
          <p className="mt-2 text-sm text-ink-muted">खोज नहीं हो पाई — दोबारा कोशिश करें</p>
        </div>
      )}
    </div>
  );
}
