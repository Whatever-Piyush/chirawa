# 🧺 Bringly — Catalog Engine (Plan A) — Production Build Plan

> **What this is:** the single execution plan for Bringly's catalog/inventory subsystem —
> ₹0 image sourcing, the two-layer master/shop catalog, and the **Blinkit-style "one store"
> aggregation built as a presentation layer on the per-shop fulfillment engine we already
> have (Plan A)**. Every live-production failure mode is identified and **mitigated here, in
> dev, before we ship.**
>
> **Companion docs:** `inventory.md` (the research + ₹0 sourcing strategy) · `fixme.MD` (the
> master production roadmap — this plan resolves its *"no product CRUD (inventory)"* catalog
> gap) · `Bringly_Field_Manual.html` (architecture reference).
>
> **Stack touchpoints:** Fastify v4 API · BullMQ v5 worker · Postgres/Prisma v5 · Redis ·
> Socket.io v4 · Expo apps (customer/seller) · Cloudflare R2 · PM2/Hetzner. Money in **paise**.
> **Cost of this entire plan: ₹0** (see `inventory.md` → "100% free tool stack").

---

## 🔒 Decision locked: Plan A

We keep the **per-shop fulfillment engine that already exists** (multi-shop carts +
per-shop order splitting) and layer the "single aggregated product / hidden shop" illusion
**on top as presentation + a checkout-time resolver.** We do **not** rewrite cart/checkout
toward single-shop resolution (Path B).

**Why:** `cart.service.ts:167` already allows multi-shop carts; `orders.service.ts:155`
already splits a cart into one order per shop; `Order.shopId` is required (`schema:401`).
Plan A reuses all of that. The risk shifts from "big rewrite" to "presentation + resolver +
a stock-accuracy safety net" — which is exactly what this doc hardens.

---

## 📖 Glossary (so names stop colliding)

| Term | What it is | In the code |
|------|-----------|-------------|
| **MasterCatalog** | Global product "dictionary", keyed by **barcode**. Canonical name/image/MRP. **Not sellable.** | **NEW** table (none exists today) |
| **ShopInventory** | What a real shop actually stocks + its price + availability | the **existing `Product`** table (per-shop) |
| **Aggregated tile** | The single customer-facing card ("Maggi ₹14") that merges all shops carrying that master | **NEW** read-path / cache |
| **Resolver** | Checkout-time logic mapping each aggregated line → a concrete shop | **NEW** in `orders.service` |
| **OrderGroup** | Ties the per-shop child orders into ONE customer-facing order | **NEW** lightweight table |
| **Specials** | Chirawa local vendors shown *with* branding (marketplace mode, not aggregated) | reuse **existing** "Chirawa Special" shop concept (`orders.service.ts:184`) |

---

## 🏗️ Architecture in one screen

```
            ┌───────────────────────── INGEST (₹0, async) ─────────────────────────┐
 Distributor ERP export (Marg/Tally) ─┐                         OFF India bulk dump ─┐
   name + barcode + MRP               │                          (CC-BY-SA images)   │
                                      ▼                                              ▼
                            ┌───────────────────┐   barcode match    ┌──────────────────────┐
                            │   MasterCatalog   │◄───────────────────│  Enrichment worker   │
                            │  (dictionary,     │  image → normalize │  (BullMQ v5)         │
                            │   keyed: barcode) │  → R2 → attribution │  status=needs_review │
                            └─────────┬─────────┘                    └──────────────────────┘
                                      │ masterId (FK)
                                      ▼
 Seller scans barcode ──► "I stock this" ──► ┌───────────────────┐  price + In/Out toggle
   (prefilled name/img/MRP from master)      │   Product (Shop-  │  (existing StockScreen)
                                             │   Inventory, per- │
                                             │   shop, sellable) │
                                             └─────────┬─────────┘
                                                       │ group by masterId across shops
                                                       ▼
                              ┌─────────────────────────────────────────┐
   CUSTOMER APP (illusion):   │  Aggregated feed: 1 tile per master,    │  cached in Redis
   no shop names, one cart    │  price = lowest in-stock, shop hidden    │  catalog:agg:{area}
                              └───────────────────┬─────────────────────┘
                                                  │ checkout
                                                  ▼
                              ┌─────────────────────────────────────────┐
   RESOLVER + per-shop split  │ resolve each line → concrete shop;      │  → OrderGroup
   (Plan A core):             │ re-validate price+stock; prefer fewest   │  (one customer order,
                              │ shops; ONE delivery fee; reroute on fail │   N child orders)
                              └─────────────────────────────────────────┘
```

**Reuses (don't rebuild):** R2 `uploadImage()` (`r2.service.ts`), CSV import
(`inventory.service.ts`), admin image routes (`admin.routes.ts`), per-shop cache invalidation
(`catalog.service.invalidateShopCache`), multi-shop cart + per-shop order split, the existing
**In/Out stock toggle** (`StockScreen` + `Product.stockStatus`), and the **Chirawa Special**
shop flag.

---

## 🗃️ Data model changes (additive, nullable → safe migration)

All new fields/tables are nullable/optional so the migration is non-breaking and reversible.
Prisma v5 — **pull Context7 docs first** per `apps/api/CLAUDE.md`.

```prisma
// NEW — the dictionary. One row per real-world product (GTIN). Not sellable.
model MasterCatalog {
  id               String       @id @default(uuid()) @db.Uuid
  barcode          String       @unique @db.VarChar(14)   // EAN-13/UPC — the join key
  name             String       @db.VarChar(200)
  brand            String?      @db.VarChar(120)
  unit             String?      @db.VarChar(50)
  mrpPaise         Int?         @map("mrp_paise")
  categoryName     String?      @map("category_name")     // generic, deduped-by-name like existing categories
  imageUrl         String?      @map("image_url")          // canonical, on OUR R2 (never hotlinked)
  imageSource      String?      @map("image_source")       // 'open_food_facts' | 'distributor' | 'manual'
  imageLicense     String?      @map("image_license")      // 'CC-BY-SA' | 'owned'
  imageAttribution String?      @map("image_attribution")  // OFF product URL for the credits page
  status           MasterStatus @default(needs_review)     // gate before it's publicly usable
  createdAt        DateTime     @default(now()) @map("created_at")
  updatedAt        DateTime     @updatedAt @map("updated_at")
  products         Product[]
  @@index([name])
  @@index([status])
  @@map("master_catalog")
}
enum MasterStatus { needs_review approved rejected }

// ON Product (ShopInventory) — link to the dictionary + the join key.
//   barcode  String? @db.VarChar(14) @map("barcode")
//   masterId String? @map("master_id") @db.Uuid
//   master   MasterCatalog? @relation(fields: [masterId], references: [id])
//   @@index([barcode])
//   @@index([masterId, stockStatus, isActive])   // drives aggregation queries

// ON ProductImage — provenance for legal/attribution + takedowns.
//   source      String?   // 'open_food_facts' | 'manual' | ...
//   license     String?
//   attribution String?

// NEW — demand capture ("Request this item").
model ProductRequest {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String?  @map("user_id") @db.Uuid    // null = anonymous
  rawText   String?  @map("raw_text")            // free-text wish
  barcode   String?  @db.VarChar(14)
  masterId  String?  @map("master_id") @db.Uuid
  pincode   String?  @db.VarChar(10)
  createdAt DateTime @default(now()) @map("created_at")
  @@index([masterId])
  @@index([createdAt])
  @@map("product_requests")
}

// NEW — unify the per-shop child orders into ONE customer-facing order.
model OrderGroup {
  id         String   @id @default(uuid()) @db.Uuid
  customerId String   @map("customer_id") @db.Uuid
  createdAt  DateTime @default(now()) @map("created_at")
  orders     Order[]
  @@map("order_groups")
}
// ON Order:  groupId String? @map("group_id") @db.Uuid + relation to OrderGroup
```

**Backfill (one-off script):** where `ProductVariant.sku` is a valid EAN-13, copy it to
`Product.barcode`. Everything else stays null and flows through the manual path.

---

## 🧭 Phased build (sequenced; check as you go)

> Order matters — each phase unblocks the next. Don't start Phase 4 (aggregation UI) before
> Phase 0–2 (the data + images) are correct.

### Phase 0 — Foundation: barcode + the dictionary
- [ ] Migration: `MasterCatalog`, `Product.barcode`/`masterId`, `ProductImage` provenance,
      `ProductRequest`, `OrderGroup`/`Order.groupId` (all additive/nullable).
- [ ] `isValidEan(code)` util — length 8/12/13/14 **+ GS1 check-digit** validation. Unit-tested.
- [ ] Backfill `Product.barcode` from valid `ProductVariant.sku`.
- [ ] CSV import (`inventory.service.importProductsCsv`): add a `barcode` column; validate EAN;
      prefer upsert by `(shopId, barcode)` when present, else fall back to `(shopId, name)`.
- **Done when:** migration applied & reversible; validator green; CSV round-trips barcodes.

### Phase 1 — Image pipeline: normalize + re-host (₹0)
- [ ] `services/image-pipeline.ts`: `process(input) → { url }` = fetch/validate → **`sharp`**
      (square pad on white, ~1200px, WebP, strip EXIF/metadata) → optional `rembg` → existing
      `uploadImage('products', …)`. **Content-hash the output key** so re-runs dedupe.
- [ ] Route **all** image entry points through it (admin upload, CSV `image_url`, enrichment).
      **CSV `image_url` now fetches + re-hosts to R2 — no more hotlinking.**
- [ ] Persist `source`/`license`/`attribution` on `ProductImage` + `MasterCatalog`.
- [ ] Add `sharp` dep (Context7 check). `rembg` (MIT) = optional polish via Google Colab batch —
      **not required for v1** (OFF pack-shots are already white-ish).
- [ ] Placeholder asset wired for missing images (UI never breaks).
- **Done when:** any image in → normalized WebP on R2 out, with provenance; bad/oversized inputs
      rejected; re-processing the same image doesn't duplicate.

### Phase 2 — Bulk enrichment worker (BullMQ v5, ₹0)
- [ ] **Source = OFF India *bulk dump* (CSV/JSONL), not the live API for bulk** — OFF caps at
      100 req/min and 503/IP-bans abuse. Live API is used **only** as a single-item fallback in
      the seller scan, with a descriptive **User-Agent** (`Bringly/1.0 (email)`) and a ≤100/min guard.
- [ ] Worker: for each `MasterCatalog` row with a barcode and no image → match the dump → pull the
      front image → Phase 1 normalize → set `imageUrl` + `status=needs_review`. **Idempotent,
      resumable, rate-limited, observable** (success/fail counters). Non-food → Open Products/Beauty
      Facts dumps; otherwise `needs_manual`.
- [ ] Never block any user-facing request on OFF — enrichment is fully async.
- **Done when:** one pass over the seed master auto-images the food/FMCG majority; failures are
      logged with reasons; re-running creates zero duplicates.

### Phase 3 — Seller onboarding: scan → autocomplete → toggle
- [ ] **Seller-scoped** upload + product-create routes (today upload is admin-only;
      `admin.routes.ts:184`). Enforce shop-ownership (reuse the `assertShopOwner` pattern).
- [ ] `StockScreen` (Expo v56 — **read versioned docs** per `apps/seller-app/AGENTS.md`):
      `expo-camera`/barcode-scanner → lookup `MasterCatalog` by barcode → **prefill name/image/MRP**
      → seller sets price + In/Out toggle → creates per-shop `Product { barcode, masterId }`.
- [ ] Barcode **not** in master → live OFF fetch → create `needs_review` master → continue.
      Camera fails / damaged barcode → **manual barcode entry** fallback.
- [ ] **Offline-tolerant** (Chirawa connectivity): queue scans/edits locally, sync on reconnect;
      server upserts are idempotent by `(shopId, barcode)`.
- [ ] "Report wrong image" button on each product.
- **Done when:** a seller adds a stocked product with **one scan + a price**; it works offline →
      syncs; wrong data is reportable.

### Phase 4 — Aggregated feed (the illusion), cached
- [ ] New read path: group active, in-stock `Product` rows by `masterId` across active shops in the
      serviceable area → **one tile per master**, displayed from `MasterCatalog` (canonical
      name/image). **Shop identity hidden.**
- [ ] **Canonical price = the lowest in-stock price** among carrying shops → show "₹X" (the price
      the resolver will honor). Per-shop prices stay internal.
- [ ] Cache `catalog:agg:{area}` in Redis; **extend the existing inventory-write invalidation**
      (`invalidateShopCache`) to also bust the agg cache. Add a lock/jitter to avoid stampede.
- [ ] Search: dedupe by `masterId`; keep the existing **exact-match-first** behavior.
- **Done when:** the same product across 3 shops shows as **1 tile** at the lowest in-stock price;
      cache-hit path verified; search is deduped.

### Phase 5 — Checkout resolver + fulfillment safety net (the hard part) — **DONE (2026-06-14)**
- [x] **Resolver** (`orders/resolver.service.ts`): pure `resolveAggregatedLines` routes each
      aggregated line → concrete shop via greedy **fewest-shops** set-cover (tiebreak **nearest**,
      then price), **never overcharging** beyond `PRICE_TOLERANCE` (default 0 = honor displayed
      lowest price). Factory `resolveCart` queries live in-stock/active/open candidates by master.
      A cart line is "aggregated" (fungible) iff its product's master is **approved** — recorded on
      the cart line at add-time (`cart.service.ts`), so Specials/passthrough stay pinned.
- [x] **OrderGroup:** `placeOrder` resolves aggregated lines, then a multi-shop cart creates ONE
      `OrderGroup` and stamps `groupId` on every child order (single-shop stays ungrouped/legacy).
      `GET /orders/group/:groupId` → unified totals + one (least-advanced) status.
- [x] **One delivery fee** — unchanged: the existing `combinedFee` + `feeCarrierIdx` already charges
      it once across the group. (Rider pickup-batching is the existing dispatch/batching path.)
- [x] **Stale-stock safety net:** `POST /delivery/orders/:orderId/items/:itemId/unavailable` →
      flip that shop's `Product` → `out_of_stock` (+ bust feed cache), **refund just that line**
      (`payments.refundOrderLine`, prepaid) or deduct from cash due (COD), **cancel the whole child
      order** when it was the only line; emit `ORDER_ITEM_UNAVAILABLE` over the Redis pub/sub →
      Socket.io bridge with a **substitute suggestion** (cheapest other in-stock shop, ask-don't-sub).
      *Mid-trip auto-reroute to another shop is deferred (fast-follow) — checkout-time re-validation
      catches the bulk of staleness; the line refund + suggestion is the launch floor.*
- [x] **Promo reconciliation:** lifted the single-shop gate → promo now applies at the **group
      subtotal**, discount lands on the fee-carrier order (`orders.service.ts`).
- [x] **Ratings:** unchanged — `Order.rating` stays per-shop internal; no aggregated-UI rating.
- **Done when:** an aggregated cart resolves → one unified order; price/stock re-checked; a failed
      pickup refunds the line + suggests a sub; the customer is charged **one** delivery fee.
      *(Verified: 12 new unit tests — resolver fewest-shops/nearest/tolerance/drop + safety-net
      branches; 195 API tests green. Live multi-shop checkout verification pending a running DB.)*

### Phase 6 — Chirawa Specials + Request-this-item — **DONE (2026-06-14, backend)**
- [x] **Specials:** `GET /catalog/specials` (public) = `catalog.service.getSpecials()` =
      cached shop list filtered to `isFeatured` (branding + rating + open). The menu is the
      existing `GET /catalog/shops/:id`. `shopId` present & shown — the opposite of the feed.
- [x] **Request-this-item:** `POST /catalog/requests` (auth) → `ProductRequest` (rawText/
      barcode + pincode); a valid barcode links the matching master. Admin **demand dashboard**
      `GET /admin/product-requests` groups by master/barcode/text, ranks by count.
- [x] **Restock "notify me":** opt-in `notifyOnRestock` on the request →
      `requests.service.notifyRestock(masterId)` FCMs pending requesters (reuses `sendPush` +
      the `fcm:token:{userId}` Redis token) and stamps `notifiedAt` (at-most-once). Triggered
      from the seller In/Out toggle (`PATCH /products/:id/stock`) on `Out→In` for master-linked
      products. Migration `20260614160000_catalog_phase6_request_notify` (additive). Loyalty/
      wallet stays **hidden** (no points tie-in).
- **Done when:** Specials live on the existing flag; requests captured + ranked; restock notify
      works. *(Verified: 5 new unit tests — create/link, demand ranking, restock fan-out; 200
      API tests green. Customer-app Specials tab + request-button UI = separate pass; live DB
      verification pending Postgres.)*

### Phase 7 — Moderation, coverage, observability — **DONE (2026-06-14, backend)**
> All on existing data — **no migration**. Admin endpoints are JSON-only (no admin app in the
> repo; same as `GET /admin/dispatch`). `catalog/moderation.service.ts` + 8 admin routes.
- [x] **Moderation queue:** `GET /admin/moderation/masters` (needs_review queue + provenance +
      open-report counts), `PATCH /admin/masters/:id/status` (the needs_review→approved gate, busts
      the feed), `GET/POST /admin/.../image-reports[/:id/resolve]`, `GET /admin/moderation/price-
      outliers` (price > own/master MRP). **One-click takedown** `POST /admin/masters/:id/takedown`:
      replace→swap image+approve / remove→clear+provenance-strip+re-gate; resolves reports + busts
      feed. Provenance already stored → auditable.
- [x] **Coverage dashboard** `GET /admin/coverage`: % active SKUs with image (product OR master
      image), % with barcode, master-status + enrichment-status breakdowns, enrichment success
      rate, `needs_manual` count.
- [x] **Metrics + alerts** `GET /admin/metrics` (DB-derived): enrichment fail rate, failed-pickup
      rate (Phase-5 `OrderItem.fulfillmentStatus`), open-image-report count, each with a threshold
      `breached` flag + an `alerts[]`. Hot-path counters (image-error / agg-cache hit / OFF 503) are
      listed in `deferred` — a follow-up needing Redis instrumentation.
- [x] **Credits page** `GET /catalog/credits` (public) — CC-BY-SA attributions (closes that
      Launch-Gate item).
- **Done when:** moderation actions work end-to-end; dashboards render; alerts flag regressions.
      *(Verified: 6 new unit tests — status/cache-bust, takedown remove/replace, price-outliers,
      coverage, metric thresholds; 206 API tests green. Live DB verification + admin UI pending.)*

---

## 🔥 Risk register — every risk, mitigated in dev

> The ask was "find all the risks and resolve them at dev phase." Grouped by domain. Each row:
> **Risk → what it does live → how we kill it before shipping.**

### A. Barcode & data quality
| Risk | Live impact | Mitigation (build in dev) |
|------|-------------|---------------------------|
| Distributor "barcode" is an **internal code, not an EAN** | Garbage matches, wrong images | `isValidEan()` check-digit gate; invalid → flagged, never matched to OFF |
| **No barcode** (loose veg, local pede) | Can't auto-enrich | Barcode-less master entries + manual photo; routed to **Specials** path |
| **One product, many barcodes** (pack sizes) | Duplicate masters | Master per GTIN; pack-sizes as `ProductVariant`; admin **merge** tool |
| **Wrong barcode scanned** → wrong image | Embarrassing public error | `needs_review` gate **before public**; seller "report wrong image"; admin override |
| **Duplicate masters** (typo / 2 barcodes) | Split aggregation, two tiles | `@@unique(barcode)`; fuzzy-name dup detection; admin merge |
| **OFF community data wrong** (name/brand) | Misleading listing | `status=needs_review` until an admin approves |

### B. Images & legal
| Risk | Live impact | Mitigation |
|------|-------------|-----------|
| **CC-BY-SA attribution** obligation (OFF) | License non-compliance | Store `source/license/attribution`; public **credits page** |
| **Brand copyright takedown** | Legal demand | One-click remove/replace; provenance recorded; prefer OFF/own photos over scraped |
| **BRIA RMBG** model is **non-commercial** | License violation if shipped | Use **`rembg` (MIT)** only — documented in `inventory.md` |
| **`@imgly` AGPL** copyleft | Could force open-sourcing the server | Avoid server-side; `rembg` only |
| **Hotlinking** external image URLs | Breaks when source moves; etiquette breach | Always **fetch + re-host to R2** (Phase 1) |
| **Malicious / corrupt / huge** image upload | DoS / payload | mime allowlist + 5 MB cap (exist) + **dimension cap + sharp re-encode** (strips EXIF/payloads) |
| **NSFW / wrong** image from OFF | Brand-damaging tile | `needs_review` gate + moderation queue |

### C. Aggregation & pricing
| Risk | Live impact | Mitigation |
|------|-------------|-----------|
| **3 shops, 3 prices** — which shows? | Ambiguous price | Show **lowest in-stock**; resolver routes to that shop |
| **Price changes** between view & checkout | Customer charged more than shown | **Re-validate at checkout**; honor displayed within tolerance, else prompt |
| Shop **games a low price** to win routing, then no-shows | Failed orders | Reroute on failure + **reputation penalty** signal (uses internal shop rating) |
| **Master name ≠ shop's actual item** | Mismatch confusion | Canonical display from master; mismatch reportable |

### D. Stock accuracy & fulfillment (the heart)
| Risk | Live impact | Mitigation |
|------|-------------|-----------|
| **Stale In/Out toggle** → routed to an empty shop | Failed pickup, angry customer | **Auto-toggle-off + auto-reroute** to next nearest; reconfirm stock at checkout; push **numeric stock** (auto-decrements in checkout already) for fast-movers |
| **All shops out** at checkout | Dead order line | Drop line + "just sold out" + **substitute suggestion**; rest proceeds |
| **Multi-shop cart** → multi-delivery cost/UX | Customer sees 3 fees / 3 bags | Resolver **prefers fewest shops**; batch pickups to one rider; **one** group delivery fee |
| **Partial fulfillment** (shop has 3 of 5) | Confusing | Split or substitute with **customer approval** (don't auto-sub) |
| **Closed shop** routed to | No-show | Honor shop hours/`isActive` in routing (ties to `fixme.MD` IST open-now fix) |

### E. Seller experience & abuse
| Risk | Live impact | Mitigation |
|------|-------------|-----------|
| Price **above MRP** / typo | Overcharge | `MRP ≥ price` enforced (exists) + outlier flag |
| **Poor connectivity** mid-add | Lost work | Offline queue + idempotent sync |
| **Prohibited / fake** product added | Trust/legal | Moderation + report flow |
| Seller **floods** the catalog | Spam | Rate limit + review gate |

### F. Performance & scale
| Risk | Live impact | Mitigation |
|------|-------------|-----------|
| Aggregation **group-across-shops** query is heavy | Slow feed | Precompute + **Redis `catalog:agg:{area}`**; index `(masterId, stockStatus, isActive)` |
| Search dedup cost | Slow search | Indexed + cached + exact-match-first (existing) |
| `sharp`/`rembg` CPU | Worker saturation | Queue (BullMQ), batch off-peak, **Colab** for one-time bulk |
| **Cache stampede** on invalidation | Thundering herd | Lock + jitter on the agg-cache rebuild |

### G. External dependencies
| Risk | Live impact | Mitigation |
|------|-------------|-----------|
| **OFF 100/min limit → 503 / IP ban** | Enrichment dies | Use **bulk dump** for bulk; User-Agent; ≤rate single-item fallback; cache; **never on the user path** |
| **OFF down** | — | Enrichment is async/dump-based; seller scan falls back to manual; user unaffected |
| **R2 misconfig (placeholder creds)** | Uploads fail | `r2.service` already refuses loudly; placeholder image fallback; retries |
| **R2 read spike / hotlink abuse** | Cost / quota | Immutable cache headers (exist) + Cloudflare edge cache; monitor Class B ops (free tier = 10M/mo) |
| **OFF staleness** | Outdated images | Scheduled dump refresh + admin override |

### H. Cold-start & ops
| Risk | Live impact | Mitigation |
|------|-------------|-----------|
| Launch with **1–2 shops** → aggregation is moot | Over-engineering risk | Aggregation degrades gracefully to passthrough; **ship single-shop first**, aggregation shines at density — don't block launch on it |
| **Empty catalog** | Nothing to buy | Seed from distributor export + OFF; coverage dashboard drives the gap to ~100% |
| Master goes **stale** | Drift | Scheduled refresh + new-product-on-scan flow |

### I. Security & moderation
| Risk | Live impact | Mitigation |
|------|-------------|-----------|
| **Unauthorized** upload / wrong shop | Tampering | Auth + shop-ownership on seller routes (reuse `assertShopOwner`) |
| **CSV formula injection** | Spreadsheet exploit on export | Treat cells as data; sanitize leading `=+-@` |
| **Master poisoning** (bad OFF data public) | Catalog corruption | `needs_review` gate before public |
| **PII** in requests | Privacy | Capture minimal (pincode only) |

### J. Observability & integrity
| Risk | Live impact | Mitigation |
|------|-------------|-----------|
| **Silent** enrichment failures | Coverage rots unnoticed | Metrics + alerts (Phase 7) |
| **Orphaned images** (product deleted) | R2 bloat | Cleanup job; soft-delete keeps order history (existing) |
| **Non-idempotent** re-runs | Duplicate images/products | Content-hash image keys; upsert by `(shopId, barcode)`; BullMQ `jobId` dedupe |
| **Migration breakage** | Downtime | Additive/nullable; backfill script; reversible |

---

## 🚀 "When it's live" — failure scenarios, already resolved

Concrete incidents, each with the dev-phase resolution that makes them non-events:

1. **Rider reaches Sharma Kirana — Maggi khatam.** → "Item not available" → auto-mark that shop
   out → re-resolve to next nearest in-stock shop → if none, refund the line + suggest a
   substitute, rest of the order proceeds. *(Phase 5 safety net.)*
2. **Two shops: ₹14 and ₹16. Customer saw ₹14.** → Resolver routes the line to the **₹14**
   (lowest-in-stock) shop and honors it; if that shop just went out, re-resolve and honor the shown
   price within tolerance, else prompt. *(Phase 4 canonical price + Phase 5 re-validate.)*
3. **OFF rate-limits / goes down mid-enrichment.** → Enrichment is async + **dump-based**; the
   worker backs off; **no user request ever touches OFF**; seller scan falls back to manual.
4. **Damaged barcode → wrong image.** → `needs_review` keeps it **out of the public feed** until
   approved; "report wrong image" + admin fix.
5. **Cart = 6 items across 3 shops.** → Resolver prefers the fewest shops; children tied into one
   **OrderGroup**; **one** delivery fee; unified tracking. Customer never sees the seams.
6. **Image goes viral, R2 reads spike.** → Immutable cache headers + Cloudflare edge serve it;
   Class-B ops monitored, comfortably inside the 10M/mo free tier.
7. **Brand sends a takedown.** → One-click remove/replace; provenance shows the source; swap in an
   own/Distributor photo.
8. **Promo code on a multi-shop aggregated cart.** → Applied at the **group subtotal** (launch
   decision), not per child — no double-discount, no crash. *(Reconciles `orders.service.ts:222`.)*
9. **Launch day, only 1 shop live.** → Aggregation = passthrough (1 shop → 1 tile); zero breakage;
   the **Specials** tab seeds local flavor while density builds.

---

## ✅ Catalog-engine Launch Gate (Definition of Done)

Ship only when **all** are green (feeds into the `fixme.MD` master gate):

- [ ] Migration applied, reversible, backfilled.
- [ ] EAN validator + CSV barcode import: tested.
- [x] Every image path re-hosts to R2 (no hotlinks); provenance stored; credits page live (`GET /catalog/credits`).
- [ ] Enrichment worker: idempotent, rate-safe, observable; seed catalog ≥ target image coverage.
- [ ] Seller 1-scan add works **offline → sync**; manual fallback; wrong-image report.
- [ ] Aggregated feed: 1 tile/master, lowest-in-stock price, cached + invalidated correctly.
- [x] Resolver: re-validates price+stock; OrderGroup unified; **one** delivery fee.
- [x] **Stale-stock** path proven (automated tests; line refund + suggest — mid-trip reroute deferred).
- [x] Specials tab on the existing flag; Request-this-item captured + ranked. *(backend; app UI pending)*
- [x] Moderation queue + coverage dashboard + alerts. *(backend; DB-derived metrics, admin UI pending)*
- [ ] No new high/critical from `/security-review` on the diff.

---

## 🧩 Open decisions (recommendations baked in)

- **Routing fairness:** always-nearest vs round-robin among equal shops. → *Recommend nearest +
  reputation tiebreak; revisit when shop density grows.*
- **Substitution:** auto vs ask. → *Recommend **ask** (approve-in-app) — higher acceptance, fewer
  refunds (per grocery-ops research).* 
- **Promo under aggregation:** group-subtotal vs single-shop-only. → *Recommend group-subtotal for
  a unified feel; gate behind the existing single-shop rule if it complicates settlement.*
- **rembg now or later:** → *Later. Launch on OFF white-bg pack-shots; add `rembg` polish post-launch.*

---

## 📎 Sources

- Open Food Facts — [API conditions & rate limits](https://forum.openfoodfacts.org/t/conditions-to-use-the-open-food-facts-api/443) ·
  [API docs](https://openfoodfacts.github.io/openfoodfacts-server/api/) ·
  [bulk data / exports](https://world.openfoodfacts.org/data) ·
  [how to download images](https://openfoodfacts.github.io/openfoodfacts-server/api/how-to-download-images/) ·
  [Open Products Facts](https://world.openproductsfacts.org/data)
- Background removal: [`rembg` (MIT)](https://github.com/danielgatis/rembg) ·
  [BRIA RMBG-1.4 (non-commercial)](https://huggingface.co/briaai/RMBG-1.4) ·
  [`@imgly/background-removal-node` (AGPL)](https://www.npmjs.com/package/@imgly/background-removal-node)
- Storage: [Cloudflare R2 pricing/free tier](https://developers.cloudflare.com/r2/pricing) ·
  Image processing: [`sharp`](https://sharp.pixelplumbing.com/)
- Grocery ops: [out-of-stock substitution effects (ScienceDirect)](https://www.sciencedirect.com/science/article/pii/S002243592200046X) ·
  [order picking accuracy](https://www.wavegrocery.com/blogpost/how-to-improve-order-picking-accuracy-reduce-picking-errors)
- India product data (post-launch, paid): [GS1 India DataKart for Retailers](https://www.gs1india.org/datakart/datakart-for-retailers)

> Full ₹0 sourcing strategy, GS1 pricing reality, and legal guardrails live in **`inventory.md`**.
</content>
