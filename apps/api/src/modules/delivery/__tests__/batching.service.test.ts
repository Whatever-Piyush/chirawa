import { describe, it, expect } from 'vitest';
import { isBatchEligible, BATCH_MAX_SIZE, type OpenBatch } from '../batching.service';

const now = new Date('2026-06-03T10:00:00Z');
const future = new Date(now.getTime() + 60_000);
const past   = new Date(now.getTime() - 1_000);
const anchor = { lat: 28.2330, lng: 75.6307 };

const baseBatch: OpenBatch = { id: 'b1', zoneId: 'z1', anchor, closesAt: future, orderCount: 1 };

describe('isBatchEligible (Chunk 5.4)', () => {
  it('accepts a nearby order in the same zone within the window', () => {
    expect(isBatchEligible(baseBatch, { lat: 28.2345, lng: 75.6320 }, 'z1', now)).toBe(true); // ~200m
  });
  it('rejects a different zone', () => {
    expect(isBatchEligible(baseBatch, anchor, 'z2', now)).toBe(false);
  });
  it('rejects when the window has closed', () => {
    expect(isBatchEligible({ ...baseBatch, closesAt: past }, anchor, 'z1', now)).toBe(false);
  });
  it('rejects when the batch is already full', () => {
    expect(isBatchEligible({ ...baseBatch, orderCount: BATCH_MAX_SIZE }, anchor, 'z1', now)).toBe(false);
  });
  it('rejects a far-away order (> 800m)', () => {
    expect(isBatchEligible(baseBatch, { lat: 28.2450, lng: 75.6500 }, 'z1', now)).toBe(false); // ~2km
  });
});
