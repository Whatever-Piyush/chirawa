import { describe, it, expect } from 'vitest';
import { parseSearchSort, parsePricePaise, dedupeByMaster } from '../catalog.service';

// ─── parseSearchSort — coerces untrusted ?sort= to a known value ──────────────
describe('parseSearchSort', () => {
  it('accepts the four valid sorts verbatim', () => {
    expect(parseSearchSort('relevance')).toBe('relevance');
    expect(parseSearchSort('priceLow')).toBe('priceLow');
    expect(parseSearchSort('priceHigh')).toBe('priceHigh');
    expect(parseSearchSort('rating')).toBe('rating');
  });

  it('falls back to relevance for unknown / missing values', () => {
    expect(parseSearchSort(undefined)).toBe('relevance');
    expect(parseSearchSort('')).toBe('relevance');
    expect(parseSearchSort('cheapest')).toBe('relevance');
    expect(parseSearchSort('PRICELOW')).toBe('relevance'); // case-sensitive on purpose
  });
});

// ─── parsePricePaise — parses price query params to non-negative ints ─────────
describe('parsePricePaise', () => {
  it('parses valid integer strings', () => {
    expect(parsePricePaise('0')).toBe(0);
    expect(parsePricePaise('10000')).toBe(10000);
  });

  it('floors fractional values', () => {
    expect(parsePricePaise('150.9')).toBe(150);
  });

  it('skips absent, empty, negative, or non-numeric values', () => {
    expect(parsePricePaise(undefined)).toBeUndefined();
    expect(parsePricePaise('')).toBeUndefined();
    expect(parsePricePaise('-5')).toBeUndefined();
    expect(parsePricePaise('abc')).toBeUndefined();
  });
});

// ─── dedupeByMaster — search dedup for the aggregated illusion (Phase 4) ──────
describe('dedupeByMaster', () => {
  it('keeps one row per master (first/best-ranked wins) and all null-master rows', () => {
    const rows = [
      { id: 'a1', masterId: 'm1' },   // top-ranked Maggi
      { id: 'a2', masterId: 'm1' },   // same master, different shop → dropped
      { id: 'b1', masterId: null },   // long-tail item → kept
      { id: 'c1', masterId: 'm2' },
      { id: 'a3', masterId: 'm1' },   // dropped
      { id: 'b2', masterId: null },   // distinct null → kept
    ];
    expect(dedupeByMaster(rows, 20).map((r) => r.id)).toEqual(['a1', 'b1', 'c1', 'b2']);
  });

  it('respects the limit', () => {
    const rows = [{ id: '1', masterId: 'a' }, { id: '2', masterId: 'b' }, { id: '3', masterId: 'c' }];
    expect(dedupeByMaster(rows, 2).map((r) => r.id)).toEqual(['1', '2']);
  });
});
