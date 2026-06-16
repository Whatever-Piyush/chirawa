import { describe, it, expect, vi } from 'vitest';
import { createOffLiveSource } from '../off-live';

function jsonRes(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body } as unknown as Response;
}

const foundBody = {
  status: 1,
  product: { code: '8901725000011', product_name: 'Atta', brands: 'Aashirvaad', categories: 'Flours', image_front_url: 'https://i/atta.jpg' },
};

describe('createOffLiveSource', () => {
  it('maps a found product and sends a descriptive User-Agent', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonRes(foundBody));
    const src = createOffLiveSource({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const p = await src('8901725000011');
    expect(p).toMatchObject({ barcode: '8901725000011', name: 'Atta', brand: 'Aashirvaad', imageUrl: 'https://i/atta.jpg', source: 'open_food_facts', license: 'CC-BY-SA' });

    const init = fetchImpl.mock.calls[0]![1];
    expect(init?.headers).toMatchObject({ 'User-Agent': expect.stringContaining('Bringly') });
  });

  it('returns null when OFF reports not-found (status 0)', async () => {
    const src = createOffLiveSource({ fetchImpl: (async () => jsonRes({ status: 0 })) as unknown as typeof fetch });
    expect(await src('0000000000000')).toBeNull();
  });

  it('returns null (never throws) on network error', async () => {
    const src = createOffLiveSource({ fetchImpl: (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch });
    expect(await src('123')).toBeNull();
  });

  it('returns a product even when OFF has no image (live path can still create a master)', async () => {
    const body = { status: 1, product: { code: '111', product_name: 'No Image Item' } };
    const src = createOffLiveSource({ fetchImpl: (async () => jsonRes(body)) as unknown as typeof fetch });
    expect(await src('111')).toMatchObject({ barcode: '111', name: 'No Image Item', imageUrl: null });
  });

  it('enforces the ~per-minute rate limit, then recovers after the window', async () => {
    let clock = 1_000_000;
    const fetchImpl = vi.fn(async () => jsonRes(foundBody));
    const src = createOffLiveSource({ fetchImpl: fetchImpl as unknown as typeof fetch, now: () => clock });

    // 90 allowed calls...
    for (let i = 0; i < 90; i++) expect(await src('8901725000011')).not.toBeNull();
    // ...the 91st within the same window is skipped (rate-limited → null, no fetch).
    expect(await src('8901725000011')).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(90);

    // Advance past the window → calls flow again.
    clock += 61_000;
    expect(await src('8901725000011')).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(91);
  });
});
