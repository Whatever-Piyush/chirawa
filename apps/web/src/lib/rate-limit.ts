// Minimal in-memory fixed-window limiter for the Next auth routes. This is
// belt-and-braces on top of the backend's real limits (per-IP + per-phone in
// Redis); it only throttles this single web process.

const buckets = new Map<string, { count: number; resetAt: number }>();
const MAX_BUCKETS = 10_000;

export function rateLimitOk(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) {
      // Full sweep is fine at this scale; prevents unbounded growth under scans.
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
      if (buckets.size >= MAX_BUCKETS) buckets.clear();
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  b.count += 1;
  return b.count <= max;
}

// Best-effort client key: first hop of x-forwarded-for (set by the fronting
// proxy in prod), else a shared local bucket.
export function clientKey(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  const first = xff?.split(',')[0]?.trim();
  return first || headers.get('x-real-ip') || 'local';
}
