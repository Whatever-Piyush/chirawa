import type Redis from 'ioredis';
import { env } from '../../config/env';
import { serviceLogger } from '../../shared/observability/logger';

const log = serviceLogger('distance');

const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days — roads don't change weekly
const FETCH_TIMEOUT_MS = 3000;

// Round to 4 decimal places (~11m precision) for cache key
function round4(n: number): string {
  return n.toFixed(4);
}

function distanceCacheKey(
  srcLat: number, srcLng: number,
  dstLat: number, dstLng: number,
): string {
  return `pricing:distance:${round4(srcLat)}_${round4(srcLng)}:${round4(dstLat)}_${round4(dstLng)}`;
}

// ─── Haversine formula (straight-line, used as fallback only) ─────────────────
export function haversineMetres(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R  = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Mappls Distance Matrix (Phase 5 — replaces Google; founder decision) ─────
// Contract verified against the official spec (github.com/mappls-api/
// mappls-rest-apis → mappls-distance-matrix-api/readme.md, doc v1.0.0 2025-06):
//   GET https://route.mappls.com/route/dm/distance_matrix/{profile}/{coords}
//       ?access_token=<REST key>
//   coords are LONGITUDE-FIRST pairs, semicolon-separated: "lng,lat;lng,lat".
//   → { responseCode: 200, results: { code: "Ok",
//        distances: [[0, metres, …]], durations: [[…]] } }   (metres/seconds;
//     index 0 is source→source, so our single destination is distances[0][1].)
// Profile 'biking' = two-wheeler routing — what our riders actually ride.
// (region/rtype are unsupported with 'biking'; we need neither for India.)
// Auth is the same MAPPLS_REST_KEY the geo proxy uses for rev_geocode.
const MAPPLS_DM_URL = (srcLat: number, srcLng: number, dstLat: number, dstLng: number): string =>
  `https://route.mappls.com/route/dm/distance_matrix/biking/` +
  `${srcLng},${srcLat};${dstLng},${dstLat}` +
  `?access_token=${encodeURIComponent(env.MAPPLS_REST_KEY)}`;

interface MapplsDmResp {
  responseCode?: number;
  results?: { code?: string; distances?: number[][] };
}

export interface DistanceDeps { fetchImpl?: typeof fetch }

async function fetchMapplsDistance(
  srcLat: number, srcLng: number,
  dstLat: number, dstLng: number,
  deps: DistanceDeps,
): Promise<number> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetchImpl(MAPPLS_DM_URL(srcLat, srcLng, dstLat, dstLng), {
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Mappls distance_matrix HTTP ${res.status}`);
    const data = (await res.json()) as MapplsDmResp;

    const metres = data.results?.distances?.[0]?.[1];
    if (data.results?.code?.toLowerCase() === 'ok' && typeof metres === 'number' && metres >= 0) {
      return Math.round(metres);
    }
    throw new Error(`Mappls distance_matrix returned code=${data.results?.code ?? data.responseCode}`);
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Main export — cached Mappls road distance with haversine fallback ────────
export interface DistanceResult {
  metres: number;
  source: 'mappls' | 'haversine_fallback' | 'cache';
}

export async function getRoadDistance(
  srcLat: number, srcLng: number,
  dstLat: number, dstLng: number,
  redis: Redis,
  deps: DistanceDeps = {},
): Promise<DistanceResult> {
  const cacheKey = distanceCacheKey(srcLat, srcLng, dstLat, dstLng);

  // 1. Try Redis cache
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) {
    return { metres: parseInt(cached, 10), source: 'cache' };
  }

  // 2. Try Mappls (skip if the REST key is a placeholder)
  if (env.MAPPLS_REST_KEY !== 'placeholder') {
    try {
      const metres = await fetchMapplsDistance(srcLat, srcLng, dstLat, dstLng, deps);
      // Cache result for 7 days
      await redis.setex(cacheKey, CACHE_TTL_SECONDS, String(metres));
      return { metres, source: 'mappls' };
    } catch (err) {
      log.warn({ err }, 'Mappls distance failed, using haversine fallback');
    }
  }

  // 3. Haversine fallback — multiply by 1.4 (road distance ≈ 40% longer than straight-line)
  const straight = haversineMetres(srcLat, srcLng, dstLat, dstLng);
  const metres   = Math.round(straight * 1.4);

  // Cache fallback too (shorter TTL)
  await redis.setex(cacheKey, 3600, String(metres));
  return { metres, source: 'haversine_fallback' };
}
