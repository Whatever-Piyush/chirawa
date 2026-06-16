import { describe, it, expect } from 'vitest';
import { imageUrlOrPlaceholder, PLACEHOLDER_IMAGE_URL } from '../r2.service';

describe('imageUrlOrPlaceholder', () => {
  it('returns the url when present', () => {
    expect(imageUrlOrPlaceholder('https://cdn/x.webp')).toBe('https://cdn/x.webp');
  });
  it('falls back to the placeholder for null/undefined/blank', () => {
    expect(imageUrlOrPlaceholder(null)).toBe(PLACEHOLDER_IMAGE_URL);
    expect(imageUrlOrPlaceholder(undefined)).toBe(PLACEHOLDER_IMAGE_URL);
    expect(imageUrlOrPlaceholder('   ')).toBe(PLACEHOLDER_IMAGE_URL);
  });
});
