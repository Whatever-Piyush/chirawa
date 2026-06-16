import { describe, it, expect } from 'vitest';
import { isValidEan } from '../barcode';

describe('isValidEan', () => {
  // Real GTINs with correct GS1 check digits, one per supported length.
  it('accepts a valid EAN-8', () => {
    expect(isValidEan('96385074')).toBe(true);
  });
  it('accepts a valid UPC-A (12)', () => {
    expect(isValidEan('036000291452')).toBe(true);
  });
  it('accepts a valid EAN-13', () => {
    expect(isValidEan('4006381333931')).toBe(true);
  });
  it('accepts a valid GTIN-14', () => {
    // A GTIN-13 zero-padded to 14 keeps its check digit — still valid.
    expect(isValidEan('04006381333931')).toBe(true);
  });

  it('rejects a wrong check digit', () => {
    expect(isValidEan('4006381333930')).toBe(false); // last digit should be 1
    expect(isValidEan('96385070')).toBe(false);       // should be 4
  });

  it('rejects unsupported lengths (an internal SKU, not a GTIN)', () => {
    expect(isValidEan('12345')).toBe(false);            // 5
    expect(isValidEan('1234567890')).toBe(false);       // 10
    expect(isValidEan('123456789012345')).toBe(false);  // 15
  });

  it('rejects non-numeric / malformed input', () => {
    expect(isValidEan('40063813339AB')).toBe(false);
    expect(isValidEan('4006381 333931')).toBe(false); // internal space
    expect(isValidEan('abcdefgh')).toBe(false);
    expect(isValidEan('')).toBe(false);
  });

  it('trims surrounding whitespace before validating', () => {
    expect(isValidEan('  4006381333931  ')).toBe(true);
  });

  it('handles null/undefined without throwing', () => {
    expect(isValidEan(null)).toBe(false);
    expect(isValidEan(undefined)).toBe(false);
  });
});
