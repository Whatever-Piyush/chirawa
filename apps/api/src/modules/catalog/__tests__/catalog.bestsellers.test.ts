import { describe, it, expect } from 'vitest';
import { buildBestsellers, type BestsellerCategoryRow } from '../catalog.service';

// Pure collapse for the Bestsellers 2×2 cluster (image-1 / 1.md): up to 4 sample
// images per category, eggs excluded, NO counts. No DB needed.
const img  = (url: string) => ({ url });
const prod = (name: string, ...urls: string[]) => ({ name, images: urls.map(img) });

describe('buildBestsellers', () => {
  it('returns up to 4 image urls per category, name only (no count field)', () => {
    const cats: BestsellerCategoryRow[] = [
      { name: 'Snacks', sortOrder: 1, products: [
        prod('Lays', 'a'), prod('Kurkure', 'b'), prod('Bhujia', 'c'), prod('Chips', 'd'), prod('Extra', 'e'),
      ] },
    ];
    expect(buildBestsellers(cats)).toEqual([{ name: 'Snacks', images: ['a', 'b', 'c', 'd'] }]);
  });

  it('excludes egg products and any egg category (bilingual)', () => {
    const cats: BestsellerCategoryRow[] = [
      { name: 'Dairy & Bread', sortOrder: 1, products: [
        prod('Amul Milk', 'm'), prod('Farm Eggs 6pc', 'e'), prod('Brown Bread', 'b'),
      ] },
      { name: 'Eggs', sortOrder: 2, products: [prod('White Egg', 'x')] },
      { name: 'अंडा', sortOrder: 3, products: [prod('देसी अंडा', 'y')] },
    ];
    expect(buildBestsellers(cats)).toEqual([{ name: 'Dairy & Bread', images: ['m', 'b'] }]);
  });

  it('aggregates the same category name across shops and dedupes image urls', () => {
    const cats: BestsellerCategoryRow[] = [
      { name: 'Fruits', sortOrder: 1, products: [prod('Apple', 'a'), prod('Banana', 'b')] },
      { name: 'Fruits', sortOrder: 1, products: [
        prod('Apple2', 'a'), prod('Mango', 'c'), prod('Grape', 'd'), prod('Pear', 'e'),
      ] },
    ];
    expect(buildBestsellers(cats)).toEqual([{ name: 'Fruits', images: ['a', 'b', 'c', 'd'] }]);
  });

  it('drops categories with no usable images and respects the limit', () => {
    const cats: BestsellerCategoryRow[] = [
      { name: 'Empty', sortOrder: 1, products: [{ name: 'NoImg', images: [] }] },
      { name: 'A', sortOrder: 2, products: [prod('p', 'a')] },
      { name: 'B', sortOrder: 3, products: [prod('p', 'b')] },
      { name: 'C', sortOrder: 4, products: [prod('p', 'c')] },
    ];
    expect(buildBestsellers(cats, 2)).toEqual([
      { name: 'A', images: ['a'] },
      { name: 'B', images: ['b'] },
    ]);
  });

  it('orders by sortOrder then name', () => {
    const cats: BestsellerCategoryRow[] = [
      { name: 'Zeta',  sortOrder: 1, products: [prod('p', 'z')] },
      { name: 'Alpha', sortOrder: 1, products: [prod('p', 'a')] },
      { name: 'First', sortOrder: 0, products: [prod('p', 'f')] },
    ];
    expect(buildBestsellers(cats).map((c) => c.name)).toEqual(['First', 'Alpha', 'Zeta']);
  });
});
