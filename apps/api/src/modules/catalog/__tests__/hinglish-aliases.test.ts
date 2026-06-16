import { describe, it, expect } from 'vitest';
import { expandHinglish } from '../hinglish-aliases';

describe('expandHinglish', () => {
  it('maps phonetic Hinglish staples to their whole synonym group', () => {
    expect(expandHinglish('doodh')).toEqual(expect.arrayContaining(['milk', 'doodh', 'dudh']));
    expect(expandHinglish('atta')).toEqual(expect.arrayContaining(['flour', 'atta', 'wheat']));
    expect(expandHinglish('namak')).toEqual(expect.arrayContaining(['salt', 'namak']));
  });

  it('is case-insensitive and matches English members too', () => {
    expect(expandHinglish('MILK')).toEqual(expect.arrayContaining(['milk', 'doodh']));
    expect(expandHinglish('Sugar')).toEqual(expect.arrayContaining(['sugar', 'chini']));
  });

  it('falls back to the first word for multi-word queries', () => {
    expect(expandHinglish('doodh packet')).toEqual(expect.arrayContaining(['milk', 'doodh']));
  });

  it('returns [] for unknown terms (no false expansion)', () => {
    expect(expandHinglish('parle-g')).toEqual([]);
    expect(expandHinglish('xyz123')).toEqual([]);
  });
});
