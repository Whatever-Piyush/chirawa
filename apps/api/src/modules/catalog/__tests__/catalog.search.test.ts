import { describe, it, expect } from 'vitest';
import { parseSearchSort, parsePricePaise } from '../catalog.service';

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
