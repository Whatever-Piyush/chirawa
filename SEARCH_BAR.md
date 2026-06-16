# 🔎 Hyper-fast, delightful Search — research + plan (no build yet)

> **Goal:** make the search bar feel **instant** the moment a user touches it — fast,
> fully functional, typo-forgiving, and aesthetically on par with Blinkit/Zepto.
> This doc is **research + the full plan only**. Implementation starts when you say go.

---

## 0. TL;DR of where we are vs. where to go
We already have a **genuinely good foundation** (most apps start from scratch — we don't):
- ✅ Backend **pg_trgm GIN index** on `products.name` + `shops.name` (fuzzy ILIKE is index-fast, not a seq scan) — migration `20260527000000_add_search`.
- ✅ Relevance ranking: trigram similarity **+ exact-match-first boost** (`name = q` ▸ `q%` ▸ `%q%`) + **alias expansion**, capped at 20.
- ✅ Frontend: **race-safe** requests (`requestIdRef` discards stale responses), **300 ms debounce**, min 2 chars, **recent searches** (AsyncStorage), idle product feed, rotating placeholder, **optimistic cart** add/▲/▼.

What's missing to feel *Blinkit-instant* (the work this doc plans):
1. **Client result cache** (instant repeats / backspace) — biggest perceived-speed win, zero backend.
2. **Lower debounce (~160 ms)** + keep race guard.
3. A dedicated **/search/suggest** endpoint (names-only, <30 ms) to paint the **autocomplete dropdown** instantly, separate from the heavier full-results query.
4. **Prefetch & warm** on focus (trending + last query).
5. **Trending searches** (server) alongside recent (local).
6. **Aesthetic dropdown**: product **thumbnail + price + bolded match**, skeletons, category quick-chips.
7. **Hinglish/typo** comfort: extend the alias/synonym map (doodh→milk, atta→flour…); note LLM spell-correction as a later tier.

---

## 1. Current implementation — exact audit
**Frontend** `apps/customer-app/src/screens/search/SearchScreen.tsx` (+ home `SearchBar.tsx`)
- Constants: `DEBOUNCE_MS = 300`, `MIN_QUERY_LEN = 2`, `MAX_RECENT = 5`.
- `handleQueryChange` → debounced `runSearch`; `runSearch` bumps `requestIdRef`, calls `api.search(q, filters)`, ignores stale responses, saves recent.
- **Suggestions are client-derived** from the *full* results' product names (exact→prefix→contains, top 6). So the dropdown needs a full search round-trip first.
- Filters (category / price bucket / in-stock / sort) via a bottom sheet; re-runs query on change.
- Idle: recent chips + 3-up product grid (30 products). Rotating placeholder name.

**Backend** `search.routes.ts` → `catalogService.searchCatalog()` in `catalog.service.ts`
- `GET /api/v1/search?q=…` — **30 req/min** in prod (1000 dev), min 2 chars.
- `$queryRaw` with `pg_trgm`: `similarity()` score fragments + `exactBoost` CASE + ILIKE alias parts; ranks exact-first; separate **count** query; also searches shops.
- **No `/suggest` (autocomplete) endpoint** and **no Redis caching** of results yet (catalogService *has* `redis` available).

---

## 2. Research — how Blinkit & Zepto make search feel instant

### 2.1 The instant-search pipeline (industry pattern)
Instant search is a pipeline: **client heuristics → edge/Redis cache → fast index lookup → ranking → personalization → presentation**, leaning on a **precomputed autocomplete index**, **heavy caching**, and async consistency. Dedicated engines (Typesense/Algolia/Meilisearch) hit **sub-50 ms typo-tolerant search-as-you-type**. ([instant-search architecture](https://medium.com/@CodeWithPurpose/the-architecture-behind-instant-search-results-even-at-billion-user-scale-7097c9c683b7) · [Typesense](https://typesense.org/))

### 2.2 Zepto — query understanding is the moat (most relevant to us)
- **The majority of Zepto's business is driven by in-app search**, so a misunderstood query = a dropped session.
- Indian users type **Hinglish / vernacular in Latin script, phonetically, on the go** — "kothimbir" (coriander), "paal" (milk, Tamil), "balekayi cheeps", "kottimbeer pudina". It's *cultural*, not just spelling.
- Zepto built **custom LLM spell-correction + semantic retrieval**, so even badly misspelled/phonetic queries return meaningful results → **+7.5% conversion** on affected queries.
  ([Zepto blog: misspelled multilingual queries](https://blog.zeptonow.com/lost-in-translation-how-we-fix-misspelled-multilingual-queries-with-llms-173ce00c2ba1) · [AIM](https://analyticsindiamag.com/ai-features/zeptos-spellchecker-fixes-errors-with-a-little-help-from-llms/) · [Storyboard18](https://www.storyboard18.com/brand-marketing/from-typos-to-hindi-phrases-zepto-says-its-search-now-understands-everyday-language-inputs-94148.htm))
- **Takeaway for Chirawa:** we won't ship an LLM on day 1, but our `pg_trgm` already absorbs minor typos, and a **curated Hinglish alias/synonym map** (doodh→milk/dudh, atta→flour/aata, namak→salt, chini→sugar, sabun→soap…) gets ~80% of the value cheaply. LLM correction = a later tier.

### 2.3 Blinkit — real-time, heavily cached hyperlocal
- Stack: **Java/Spring Boot + Node.js + Python**, AI + automation + real-time. Search is per-dark-store serviceable inventory, **cache-heavy** for speed. ([Blinkit real-time UX](https://shyamfuture.com/how-blinkit-used-real-time-ux-and-hyperlocal-tech-to-win-quick-commerce/))
- **Takeaway:** the perceived speed is mostly **caching + a tiny autocomplete payload**, not exotic infra.

### 2.4 Search-as-you-type UX rules (measured)
- **Debounce 200 ms is the sweet spot; >300 ms starts degrading**; 300–500 ms only for heavy external calls. → drop ours 300 → **~160 ms**. ([Atomic Object](https://spin.atomicobject.com/2018/06/04/automplete-timing-debouncing/) · [Algolia debouncing](https://www.algolia.com/doc/ui-libraries/autocomplete/guides/debouncing-sources))
- **Never re-fetch the same input** — `f → fa → f` should be ≤2 lookups → **client cache** keyed by normalized `q + filters`. ([greatfrontend autocomplete](https://www.greatfrontend.com/questions/system-design/autocomplete))
- **Client-side caching shows previous queries nearly instantly**, and can seed future queries via prefix match. ([same](https://www.greatfrontend.com/questions/system-design/autocomplete))
- Min length 2–3; mobile keyboards paste multiple chars at once (don't assume one-at-a-time).
- Autocomplete UX: show **thumbnails**, **bold the matched substring**, keep the list **stable** (no flicker), surface **trending/recent** when empty. ([autocomplete UX practices](https://www.plgos.com/blogs/9-best-autocomplete-ux-design-practices-to-boost-user-experience))

---

## 3. The plan (phased) — files & changes

### Phase 1 — Perceived-instant on the client (no backend, biggest win)
| Change | File | Detail |
|---|---|---|
| **Result cache (LRU)** | `SearchScreen.tsx` (or new `hooks/useSearch.ts`) | `Map<normalizedKey, {products,shops,total}>`, ~30 entries. On keystroke, if cache hit → paint **instantly** (0 network); still revalidate in background. Kills backspace/re-type latency. |
| **Debounce 300 → ~160 ms** | `SearchScreen.tsx` | Faster reaction; race guard already protects correctness. |
| **Keep last results visible while typing** | `SearchScreen.tsx` | Dim old results instead of clearing → no flicker/jank. |
| **Prefetch on focus** | `SearchBar.tsx` / `SearchScreen` mount | Warm categories/feed (already) + prefetch trending + the user's most-recent query into cache. |

### Phase 2 — Dedicated autocomplete endpoint (instant dropdown)
| Change | File | Detail |
|---|---|---|
| **`GET /api/v1/search/suggest?q=`** | `search.routes.ts` + `catalog.service.ts` | Names-only (+ optional thumbnail+price), top ~8, **trigram + prefix**, **no count, no shops** → tiny + <30 ms. Own rate-limit. |
| **Redis cache** | `catalog.service.ts` | Cache suggest (and hot full-search) results, short TTL (~60 s). catalogService already has `redis`. |
| **api-client `suggest()`** | `packages/api-client` + `packages/types` | New DTO `SearchSuggestion { id, name, pricePaise, imageUrl }`. |
| **Dropdown from suggest, not full results** | `SearchScreen.tsx` | Type → suggest (fast) fills the dropdown; pressing enter/suggestion → full search. |

### Phase 3 — Discovery & relevance
| Change | File | Detail |
|---|---|---|
| **Trending searches** | backend (log top queries) + idle UI | Server returns popular terms; show "Trending" chips beside "Recent". |
| **Hinglish alias/synonym map** | `catalog.service.ts` (extend alias expansion) | Curated doodh/atta/namak/chini/sabun… → boosts vernacular recall cheaply. |
| **(Later) LLM/semantic spell-correct** | new service | Zepto-style; only if data shows misspell drop-off. |

### Phase 4 — Aesthetics & polish
- Suggestion rows: **thumbnail + name + pack/price**, **bold matched substring**, recent gets a ⟲ icon, trending a 🔥.
- **Skeletons** while results load (reuse `ProductGridSkeleton`); shimmer not spinner.
- Rounded **pill** field, mic/voice affordance (home `SearchBar` already has one), clear-✕, smooth slide-up (already).
- Empty/zero-result state: "No results for X" + trending + nearest-alias suggestion ("Did you mean…").
- Optional: highlight in-cart items in results (we already track `cartMap`).

---

## 4. Done-when (acceptance) + metrics
- Typing feels instant: cached queries paint in **0 ms** (no spinner); fresh queries debounce **~160 ms**; dropdown from `/suggest` in **<50 ms**.
- Backspacing / re-typing a prior query makes **no new network call**.
- Misspelled/Hinglish staples ("dood", "aata", "biscit") still return the right product.
- Dropdown shows thumbnails + bolded match; idle shows recent + trending; zero-result shows a graceful fallback.
- No flicker between keystrokes; results list stays stable.
- Instrument: log p50/p95 search + suggest latency; cache hit-rate.

## 5. Explicitly out of scope for v1 (note, don't build)
- Full LLM/semantic spell-correction (Zepto's gold tier) — revisit with data.
- Swapping Postgres for Typesense/Algolia — our pg_trgm + cache is enough at Chirawa scale.
- Voice-to-text search backend (the mic can stay decorative or use the OS keyboard mic for now).

## 6. Open questions for you (before build)
1. Debounce target — **160 ms** ok, or do you want even snappier (~120 ms)?
2. Suggestion dropdown — **with thumbnails** (richer, Blinkit-style) or **text-only** (lighter)?
3. Trending searches — **curated list** (we pick ~10 staples) or **auto from query logs** (needs logging first)?
4. Hinglish aliases — want me to seed an initial curated map now, or wait?
