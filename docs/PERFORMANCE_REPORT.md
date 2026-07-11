# Performance Report — Load Validation (Phase 6)

**Verdict:** the platform is comfortably over-provisioned for launch scale
(a town of customers ≈ tens of RPS peak; the stack demonstrated 1,100+ RPS
browse and ~100 orders/minute-equivalent placement with zero errors) — **with
one launch-relevant cliff**: catalog search degrades linearly with catalog
size and collapses around ~10–15k products (§5). Fix it before the catalog
grows past ~1–2k products; everything else is second-order.

Raw evidence: [`docs/perf/loadtest-2026-07-03-dev-mac.json`](perf/loadtest-2026-07-03-dev-mac.json).
Reproduce: `node scripts/loadtest/run.mjs` ([suite README](../scripts/loadtest/README.md)).

## 1. Methodology & environment (read before quoting numbers)

- **What ran:** the compiled production artifacts (`dist/index.js`,
  `dist/worker/index.js`) against the same engines production uses
  (PostgreSQL 15 + PostGIS, Redis 7), seeded catalog (285 products, 10 shops,
  3 riders), production-shaped JSON logging at `info`. Rate limiter and
  operating-hours gate disabled via the non-production enablers (`Perf 1/N`
  commit) — we measured the app, not its guardrails.
- **Load model:** closed-loop (N workers issue requests back-to-back), 5 s
  warmup discarded, 30 s measured windows. RPS is an *outcome*, not an input —
  no coordinated-omission correction needed.
- **Host caveat:** 10-core Apple-silicon dev machine, Node v24 — NOT the
  production CX32 (4 vCPU, Node 20). Absolute numbers are best-case.
  Transferable: *which* path saturates first, error behavior, scaling shape,
  and resource ratios. §7 derates to a production estimate.
- **Topology caveat:** one API process here vs PM2 cluster ×4 in production.
  CPU-bound API paths get ~cluster-×-cores headroom in prod; the single shared
  Postgres/Redis do NOT scale with API workers — which is exactly why the
  DB-bound findings below matter most.

## 2. Scenario results (measured 30 s each, zero errors everywhere)

### Browse — 50 concurrent, **1,179 RPS aggregate**

| Endpoint | RPS | P50 | P95 | P99 |
|---|---|---|---|---|
| GET /catalog/feed | 411 | 16 ms | 36 ms | 61 ms |
| GET /catalog/shops | 120 | 16 ms | 36 ms | 58 ms |
| GET /catalog/products?category | 241 | 48 ms | 75 ms | 104 ms |
| GET /catalog/categories | 116 | 47 ms | 72 ms | 99 ms |
| GET /catalog/products/:id | 291 | 75 ms | 114 ms | 153 ms |

Resources: API 254% CPU avg (2.5 cores), 438 MB RSS max; Redis 527 ops/s;
PG ~2,970 commits/s, 100% cache hit, ≤6 active backends.
Feed/shops are Redis-cached (fast + flat); the uncached DB paths are 3–5× slower.

### Search — 30 concurrent, **347 RPS**

| Variant | RPS | P50 | P95 | P99 |
|---|---|---|---|---|
| GET /search?q= | 278 | 78 ms | 147 ms | 217 ms |
| GET /search?sort=rating | 70 | 82 ms | 162 ms | 250 ms |

Resources: API CPU only **57%** — but **22 active PG backends** (= the Prisma
pool ceiling on this host). Search is Postgres-bound: the API sat waiting on
the DB. This is the §5 cliff at its friendly, small-catalog scale.
(`sort=rating` costs only ~5% extra — the P1-13 rework held up.)

### Checkout (cart build) — 25 concurrent, **1,073 RPS aggregate**

| Step | RPS | P50 | P95 | P99 |
|---|---|---|---|---|
| POST /cart/items | 358 | 30 ms | 48 ms | 62 ms |
| GET /cart | 358 | 11 ms | 18 ms | 25 ms |
| POST /pricing/preview | 358 | 24 ms | 39 ms | 55 ms |

Redis-centred flow (1,470 Redis ops/s) — healthy and flat.

### Order creation — 12 concurrent, **~100 orders placed/second**

| Step | RPS | P50 | P95 | P99 |
|---|---|---|---|---|
| POST /orders (COD place) | 99.6 | 88 ms | 136 ms | 226 ms |

2,989 orders placed in 30 s with zero errors. The place transaction (stock
CAS + order + items + history + events + ETA) holds P95 ≤ 136 ms while the
dispatch pipeline runs live behind it (worker at 36% CPU, Redis 3,800 ops/s).
This is ~3 orders *per second* of launch-town headroom **per 30 ms of P50** —
orders are not a bottleneck at any plausible scale.

### Rider assignment (order confirmed → assignment row)

| Metric | Value |
|---|---|
| Orders in window | 2,989 placed / 3,330 assigned* / 38 unassigned |
| confirm → assigned P50 | **726 ms** |
| P95 / P99 / max | 2,161 / 2,240 / 2,519 ms |

\*assigned > placed because warmup-window orders also resolve inside the window.
Latency is dominated by the deliberately configured 2 s batch-accumulation
window (`BATCH_WINDOW_MS`, prod default 3 min): full batches (3 orders)
assign immediately (the ~726 ms P50 population), window-expiry batches show
up at ~2.2 s. **Pipeline overhead beyond the window is ~200–500 ms** — event
bus → batch CAS → BullMQ → worker → assignment transaction is sound under a
100-orders/sec burst, three-plus orders of magnitude above launch volume.

### Sockets — 300 concurrent authenticated connections

300/300 connected, 0 failures; handshake P50 5 ms / P99 27 ms; idle hold:
~0% API CPU, 184 MB RSS. WebSocket-only + Redis adapter (P0-2) is ready for
the PM2 cluster; connection count is nowhere near a limit at launch scale.

## 3. Measurement coverage (spec item 3)

P50/P95/P99 per op (§2); CPU + memory for API and worker per scenario
(sampled 1 s via `ps`); Postgres commits/s, cache-hit ratio (100% throughout),
active backends; Redis ops/s + memory (peaked 4,669 ops/s, 8 MB — Redis is
idling); worker utilization (peak 50% of one core during continuous order
placement — dominated by assignment/notification jobs).

## 4. Bottlenecks, ranked

1. **Search does un-indexed trigram scoring over the whole catalog per query**
   (§5). Launch-relevant; grows linearly with catalog size.
2. **`GET /catalog/categories` loads every active product id + first image to
   count them in JavaScript, uncached.** 47 ms P50 at 285 products → measured
   93 ms single-request at 14k products; it's O(catalog) per request on a
   home-screen endpoint.
3. **Prisma pool defaults bind DB-bound paths.** 22 active backends during
   search = the default pool (`2×cores+1`) saturated on this host. The CX32
   default is 9 per process × 4 PM2 workers = 36 backends of burst against one
   Postgres — unconfigured and untuned either way.
4. **Product detail is ~6 queries/request, uncached** (findUnique + 3 includes
   + related + related-images). Fine solo (16 ms), 75 ms P50 under load is
   pool queueing, not query cost — a symptom of (3), softened by caching.
5. Not bottlenecks at any plausible scale: order placement, cart/pricing
   (Redis-centred), the assignment pipeline, socket handshakes, worker CPU,
   Redis (≤8 MB, ≤4.7k ops/s), PG cache hit (100%).

## 5. The search cliff — evidence

`searchProducts` filters with `word_similarity()`/`similarity()` **function
calls**, which no index can serve (`products.name` has only a btree). Every
query trigram-scores every active product row.

Scale probe — catalog inflated to 14,250 products (×50, synthetic rows since
removed), same suite, same host:

| Catalog size | /search P50 | /search throughput | Single-query EXPLAIN |
|---|---|---|---|
| 285 products | 78 ms | 347 RPS (30 workers) | 12.7 ms, Seq Scan 274 rows |
| 14,250 products | **5,735 ms** | **8 RPS** (10 workers) | 144 ms, Seq Scan 14,239 rows |

44× less throughput at 50× the catalog: linear per-query growth × closed
queueing = collapse. A real catalog reaches 14k products at ~50 shops × 285
items — not hypothetical.

**Fix (validated live at 14k rows):** GIN trigram index + operator-form
predicates (operators are index-served, function calls are not):

```sql
CREATE INDEX products_name_trgm_idx ON products USING gin (name gin_trgm_ops);
-- per-connection: SET pg_trgm.similarity_threshold = 0.15;
--                 SET pg_trgm.word_similarity_threshold = 0.2;
-- rewrite:  name ILIKE '%q%' OR q <% name OR name % q     (Bitmap-OR, all arms indexed)
```

| Term (matches at 14k) | function-form (today) | operator-form + GIN |
|---|---|---|
| "dettol" (100 rows) | 158 ms | **18 ms** (8.7×) |
| "maggi" (250 rows) | 136 ms | **52 ms** (2.6×) |
| "aata" (2,599 rows — worst case) | 144 ms | 45 ms, Bitmap Index Scan |

Operator cost scales with *matches*, function cost with *catalog* — exactly the
property a growing catalog needs.

## 6. Recommendations (prioritized)

| # | Action | Trigger / when | Effort |
|---|---|---|---|
| R1 | GIN trgm index on `products.name` (+`shops.name`) and operator-form rewrite of `searchProducts`. Mind three details: thresholds must move to `pg_trgm.*` GUCs set per connection (code's 0.2/0.15 ≠ PG defaults 0.6/0.3); the `similarity(s.name, q)` arm must split into its own index-served branch (cross-table OR can't Bitmap-OR) — e.g. UNION the shop-name matches; keep the ILIKE alias arm (GIN serves it too). | **Before catalog > ~1–2k products** — schedule now | ~1 day + tests |
| R2 | `getCategories`: count in SQL (`COUNT(*)` grouped) instead of loading ids+images, and Redis-cache it — `invalidateShopCache` already busts sibling keys, add this one. | With R1 (same growth curve, home-screen endpoint) | ~½ day |
| R3 | Set explicit `connection_limit` (+`pool_timeout`) in the production `DATABASE_URL` — e.g. start `connection_limit=10` per PM2 worker (40 total) against default PG `max_connections=100`, then tune from `pg_stat_activity`. Removes the "pool = f(cores)" surprise in both directions. | At merge — it's one URL param | minutes |
| R4 | Redis-cache product detail (short TTL or bust via `invalidateShopCache`); optionally collapse the related-products image include. | When PDP P95 matters (marketing pushes, deep links) | ~½ day |
| R5 | Keep `BATCH_WINDOW_MS` as the assignment-latency dial; the pipeline itself needs nothing. Document that customer-visible "rider assigned" time ≈ window + ~0.5 s. | none — informational | — |
| R6 | Re-run this suite on the CX32 before launch (`node scripts/loadtest/run.mjs` over SSH against a staging DB) to replace §7's estimate with a measurement. | Pre-launch checklist | ~1 hour |

## 7. What this means for the CX32 (production estimate)

Derating the Mac numbers ~3–4× per core and giving the API its 4-worker
cluster: browse ~1,000+ RPS aggregate, checkout ~800+ RPS, orders ~60–80/s —
all still 100× beyond a launch town's peak. The exception is Postgres-bound
search: it does NOT scale with PM2 workers, lands on the same shared 4 vCPU as
everything else, and at current query shape would saturate the box at roughly
**~10–20 RPS of search at a few-thousand-product catalog**. R1 turns that into
a non-issue. Memory: API ≤ 440 MB under our heaviest load vs the 500 MB PM2
restart cap — acceptable, but watch `pm2 status` restarts under real traffic
(RUNBOOK §3).

## 8. Artifacts

- Evidence JSON: `docs/perf/loadtest-2026-07-03-dev-mac.json` (full run)
- Suite: `scripts/loadtest/` (README covers re-running + caveats)
- Per-run API/worker logs land beside each run's `results.json` (gitignored)
