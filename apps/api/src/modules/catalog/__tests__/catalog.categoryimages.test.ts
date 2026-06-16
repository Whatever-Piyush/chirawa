import { describe, it, expect } from 'vitest';
import { buildCategoryImages, type CategoryImageRow } from '../catalog.service';

// Pure collapse for the home category tiles (image-2 / 2.md): a { name: url[] }
// map with up to 3 sample images per category. No DB needed.
const img  = (url: string) => ({ url });
const prod = (...urls: string[]) => ({ images: urls.map(img) });

describe('buildCategoryImages', () => {
  it('returns up to 3 image urls per category', () => {
    const cats: CategoryImageRow[] = [
      { name: 'Bath & Body', products: [prod('a'), prod('b'), prod('c'), prod('d')] },
    ];
    expect(buildCategoryImages(cats)).toEqual({ 'Bath & Body': ['a', 'b', 'c'] });
  });

  it('aggregates the same category across shops and dedupes urls', () => {
    const cats: CategoryImageRow[] = [
      { name: 'Hair Care', products: [prod('a'), prod('b')] },
      { name: 'Hair Care', products: [prod('a'), prod('c'), prod('d')] },
    ];
    expect(buildCategoryImages(cats)).toEqual({ 'Hair Care': ['a', 'b', 'c'] });
  });

  it('omits categories with no usable images', () => {
    const cats: CategoryImageRow[] = [
      { name: 'Empty', products: [{ images: [] }] },
      { name: 'Skin & Face', products: [prod('s')] },
    ];
    expect(buildCategoryImages(cats)).toEqual({ 'Skin & Face': ['s'] });
  });

  it('respects a custom perCat', () => {
    const cats: CategoryImageRow[] = [
      { name: 'Household', products: [prod('a'), prod('b'), prod('c')] },
    ];
    expect(buildCategoryImages(cats, 2)).toEqual({ Household: ['a', 'b'] });
  });
});
