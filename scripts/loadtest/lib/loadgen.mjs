// Closed-loop load generator (Phase 6). N workers each run `iteration()`
// back-to-back until the deadline; per-op latencies recorded after a warmup
// window. Closed-loop = arrival rate adapts to service rate, so RPS is a
// RESULT, not an input — the honest way to find capacity without coordinated
// omission from a fixed-rate generator we'd then have to correct for.

export function percentiles(samples) {
  if (samples.length === 0) return null;
  const s = [...samples].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
  return {
    count: s.length,
    p50: at(50), p95: at(95), p99: at(99),
    mean: s.reduce((a, b) => a + b, 0) / s.length,
    max: s[s.length - 1],
  };
}

const round1 = (v) => Math.round(v * 10) / 10;

export function summarize(byOp, errors, measuredMs) {
  const ops = {};
  let total = 0;
  for (const [op, samples] of Object.entries(byOp)) {
    const p = percentiles(samples);
    if (!p) continue;
    total += p.count;
    ops[op] = {
      count: p.count,
      rps: round1(p.count / (measuredMs / 1000)),
      p50_ms: round1(p.p50), p95_ms: round1(p.p95), p99_ms: round1(p.p99),
      mean_ms: round1(p.mean), max_ms: round1(p.max),
    };
  }
  return {
    measured_seconds: round1(measuredMs / 1000),
    total_requests: total,
    total_rps: round1(total / (measuredMs / 1000)),
    errors,
    ops,
  };
}

/**
 * @param {object} cfg
 * @param {number} cfg.concurrency  parallel workers
 * @param {number} cfg.durationMs   measured window (after warmup)
 * @param {number} cfg.warmupMs     ramp/JIT window, samples discarded
 * @param {(ctx: {worker: number, iter: number, record: (op: string, ms: number) => void, fail: (op: string, detail: string) => void, measuring: () => boolean}) => Promise<void>} cfg.iteration
 */
export async function runClosedLoop({ concurrency, durationMs, warmupMs = 5000, iteration }) {
  const byOp = {};
  const errors = {};
  let measuring = false;

  const record = (op, ms) => {
    if (!measuring) return;
    (byOp[op] ??= []).push(ms);
  };
  const fail = (op, detail) => {
    if (!measuring) return;
    const key = `${op}: ${detail}`;
    errors[key] = (errors[key] ?? 0) + 1;
  };

  let stop = false;
  const workers = Array.from({ length: concurrency }, (_, w) =>
    (async () => {
      for (let iter = 0; !stop; iter++) {
        try {
          await iteration({ worker: w, iter, record, fail, measuring: () => measuring });
        } catch (err) {
          fail('iteration', err?.message?.slice(0, 120) ?? 'unknown');
        }
      }
    })(),
  );

  await new Promise((r) => setTimeout(r, warmupMs));
  measuring = true;
  const t0 = performance.now();
  await new Promise((r) => setTimeout(r, durationMs));
  const measuredMs = performance.now() - t0;
  measuring = false;
  stop = true;
  await Promise.allSettled(workers);

  return summarize(byOp, errors, measuredMs);
}

/** Timed fetch helper: records latency under `op`, returns parsed JSON or null on failure. */
export async function timedJson(record, fail, op, url, init) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, init);
    const ms = performance.now() - t0;
    if (!res.ok) {
      fail(op, `HTTP ${res.status}`);
      // Drain body so the socket is reusable.
      await res.text().catch(() => {});
      return null;
    }
    const body = await res.json();
    record(op, ms);
    return body;
  } catch (err) {
    fail(op, err?.cause?.code ?? err?.message?.slice(0, 80) ?? 'fetch error');
    return null;
  }
}
