import { describe, it, expect, vi, beforeEach } from 'vitest';

// Phase 5: road distance comes from the Mappls Distance Matrix (biking profile),
// never Google. Contract under test mirrors the official spec
// (mappls-api/mappls-rest-apis → mappls-distance-matrix-api/readme.md):
// lng-first coordinates, results.distances[0][1] in metres, code "Ok".

vi.mock('../../../config/env', () => ({
  env: {
    NODE_ENV: 'test',
    MAPPLS_REST_KEY: 'test_rest_key',
  },
}));

import { env } from '../../../config/env';
import { getRoadDistance, haversineMetres } from '../distance.service';

// Jhunjhunu-ish fixture: ~2.2 km apart
const SRC = { lat: 28.2403, lng: 75.6465 };
const DST = { lat: 28.2603, lng: 75.6465 };

function makeRedis(cached: string | null = null) {
  return {
    get:   vi.fn().mockResolvedValue(cached),
    setex: vi.fn().mockResolvedValue('OK'),
  };
}

const okResponse = (metres: number) => ({
  ok: true,
  json: async () => ({
    responseCode: 200,
    results: { code: 'Ok', distances: [[0, metres]], durations: [[0, 300]] },
  }),
});

type RedisArg = Parameters<typeof getRoadDistance>[4];
const asRedis = (r: ReturnType<typeof makeRedis>) => r as unknown as RedisArg;

describe('getRoadDistance — Mappls distance matrix (Phase 5)', () => {
  beforeEach(() => {
    (env as { MAPPLS_REST_KEY: string }).MAPPLS_REST_KEY = 'test_rest_key';
  });

  it('returns the cached value without calling Mappls', async () => {
    const redis = makeRedis('4200');
    const fetchImpl = vi.fn();
    const result = await getRoadDistance(SRC.lat, SRC.lng, DST.lat, DST.lng, asRedis(redis), { fetchImpl });
    expect(result).toEqual({ metres: 4200, source: 'cache' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('parses distances[0][1], rounds, caches for 7 days', async () => {
    const redis = makeRedis();
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(5231.7));
    const result = await getRoadDistance(SRC.lat, SRC.lng, DST.lat, DST.lng, asRedis(redis), { fetchImpl });
    expect(result).toEqual({ metres: 5232, source: 'mappls' });
    expect(redis.setex).toHaveBeenCalledWith(expect.any(String), 7 * 24 * 60 * 60, '5232');
  });

  it('requests the biking profile with LONGITUDE-FIRST coordinates and the REST key', async () => {
    const redis = makeRedis();
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(1000));
    await getRoadDistance(SRC.lat, SRC.lng, DST.lat, DST.lng, asRedis(redis), { fetchImpl });
    const url = fetchImpl.mock.calls[0]![0] as string;
    expect(url).toContain('https://route.mappls.com/route/dm/distance_matrix/biking/');
    expect(url).toContain(`${SRC.lng},${SRC.lat};${DST.lng},${DST.lat}`);
    expect(url).toContain('access_token=test_rest_key');
  });

  it('falls back to haversine×1.4 (1h cache) when Mappls errors', async () => {
    const redis = makeRedis();
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const result = await getRoadDistance(SRC.lat, SRC.lng, DST.lat, DST.lng, asRedis(redis), { fetchImpl });
    const expected = Math.round(haversineMetres(SRC.lat, SRC.lng, DST.lat, DST.lng) * 1.4);
    expect(result).toEqual({ metres: expected, source: 'haversine_fallback' });
    expect(redis.setex).toHaveBeenCalledWith(expect.any(String), 3600, String(expected));
  });

  it('falls back when Mappls answers with a non-Ok code', async () => {
    const redis = makeRedis();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ responseCode: 200, results: { code: 'NoRoute', distances: [] } }),
    });
    const result = await getRoadDistance(SRC.lat, SRC.lng, DST.lat, DST.lng, asRedis(redis), { fetchImpl });
    expect(result.source).toBe('haversine_fallback');
  });

  it('never calls Mappls while the REST key is a placeholder', async () => {
    (env as { MAPPLS_REST_KEY: string }).MAPPLS_REST_KEY = 'placeholder';
    const redis = makeRedis();
    const fetchImpl = vi.fn();
    const result = await getRoadDistance(SRC.lat, SRC.lng, DST.lat, DST.lng, asRedis(redis), { fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.source).toBe('haversine_fallback');
  });

  it('haversine sanity: ~0.02° of latitude ≈ 2.2 km straight-line', () => {
    const m = haversineMetres(SRC.lat, SRC.lng, DST.lat, DST.lng);
    expect(m).toBeGreaterThan(2100);
    expect(m).toBeLessThan(2350);
  });
});
