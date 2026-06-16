import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseOffDumpLine, createOffDumpSource, offProductUrl } from '../off-source';

describe('parseOffDumpLine', () => {
  it('parses a complete OFF line into an OffProduct', () => {
    const line = JSON.stringify({
      code: '8901725000011',
      product_name: 'Aashirvaad Atta',
      brands: 'Aashirvaad',
      categories: 'Flours, Atta',
      image_front_url: 'https://images.openfoodfacts.org/x/front.jpg',
    });
    expect(parseOffDumpLine(line)).toEqual({
      barcode: '8901725000011',
      name: 'Aashirvaad Atta',
      brand: 'Aashirvaad',
      categoryName: 'Flours',
      imageUrl: 'https://images.openfoodfacts.org/x/front.jpg',
      source: 'open_food_facts',
      license: 'CC-BY-SA',
      attribution: offProductUrl('8901725000011'),
    });
  });

  it('falls back to image_url and product_name_en', () => {
    const p = parseOffDumpLine(JSON.stringify({ code: '111', product_name_en: 'X', image_url: 'http://i/x.jpg' }));
    expect(p).toMatchObject({ barcode: '111', name: 'X', imageUrl: 'http://i/x.jpg' });
  });

  it('returns null without a barcode, without an image, or for malformed JSON', () => {
    expect(parseOffDumpLine(JSON.stringify({ product_name: 'No code', image_url: 'x' }))).toBeNull();
    expect(parseOffDumpLine(JSON.stringify({ code: '123', product_name: 'No image' }))).toBeNull();
    expect(parseOffDumpLine('{not valid json')).toBeNull();
    expect(parseOffDumpLine('   ')).toBeNull();
  });
});

describe('createOffDumpSource', () => {
  const dump = join(tmpdir(), `off-dump-${process.pid}.jsonl`);
  writeFileSync(dump, [
    JSON.stringify({ code: '8901725000011', product_name: 'Atta', image_front_url: 'https://i/atta.jpg' }),
    '',                                                                       // blank line tolerated
    '{ broken',                                                               // malformed tolerated
    JSON.stringify({ code: '8901639000282', product_name: 'Salt', image_url: 'https://i/salt.jpg' }),
    JSON.stringify({ code: '999', product_name: 'No image' }),               // skipped (no image)
  ].join('\n'));
  afterAll(() => rmSync(dump, { force: true }));

  it('indexes the dump and looks products up by barcode', async () => {
    const src = createOffDumpSource(dump);
    expect(await src('8901725000011')).toMatchObject({ name: 'Atta', imageUrl: 'https://i/atta.jpg' });
    expect(await src('8901639000282')).toMatchObject({ name: 'Salt' });
    expect(await src('999')).toBeNull();        // present but image-less → not enrichable
    expect(await src('0000000')).toBeNull();    // absent
  });

  it('returns a null-source when no/invalid dump path is given', async () => {
    const src = createOffDumpSource(undefined);
    expect(await src('8901725000011')).toBeNull();
    const src2 = createOffDumpSource('/no/such/file.jsonl');
    expect(await src2('8901725000011')).toBeNull();
  });
});
