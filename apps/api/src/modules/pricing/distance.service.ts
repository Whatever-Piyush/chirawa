import type Redis from 'ioredis';
import { env } from '../../config/env';

const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days — roads don't change weekly

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

// ─── Google Maps Distance Matrix ──────────────────────────────────────────────
async function fetchGoogleDistance(
  srcLat: number, srcLng: number,
  dstLat: number, dstLng: number,
): Promise<number> {
  const url =
    `https://maps.googleapis.com/maps/api/distancematrix/json` +
    `?origins=${srcLat},${srcLng}` +
    `&destinations=${dstLat},${dstLng}` +
    `&key=${env.GOOGLE_MAPS_API_KEY}`;

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 3000); // 3s timeout

  try {
    const res  = await fetch(url, { signal: controller.signal });
    const data = await res.json() as {
      rows: Array<{ elements: Array<{ status: string; distance: { value: number } }> }>;
    };

    const element = data.rows[0]?.elements[0];
    if (element?.status === 'OK') {
      return element.distance.value; // metres
    }
    throw new Error(`Google Maps returned status: ${element?.status}`);
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Main export — cached Google Maps with haversine fallback ─────────────────
export interface DistanceResult {
  metres: number;
  source: 'google_maps' | 'haversine_fallback' | 'cache';
}

export async function getRoadDistance(
  srcLat: number, srcLng: number,
  dstLat: number, dstLng: number,
  redis: Redis,
): Promise<DistanceResult> {
  const cacheKey = distanceCacheKey(srcLat, srcLng, dstLat, dstLng);

  // 1. Try Redis cache
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) {
    return { metres: parseInt(cached, 10), source: 'cache' };
  }

  // 2. Try Google Maps (skip if key is placeholder)
  if (env.GOOGLE_MAPS_API_KEY !== 'placeholder') {
    try {
      const metres = await fetchGoogleDistance(srcLat, srcLng, dstLat, dstLng);
      // Cache result for 7 days
      await redis.setex(cacheKey, CACHE_TTL_SECONDS, String(metres));
      return { metres, source: 'google_maps' };
    } catch (err) {
      console.warn('Google Maps distance failed, using haversine fallback:', err);
    }
  }

  // 3. Haversine fallback — multiply by 1.4 (road distance ≈ 40% longer than straight-line)
  const straight = haversineMetres(srcLat, srcLng, dstLat, dstLng);
  const metres   = Math.round(straight * 1.4);

  // Cache fallback too (shorter TTL)
  await redis.setex(cacheKey, 3600, String(metres));
  return { metres, source: 'haversine_fallback' };
}
