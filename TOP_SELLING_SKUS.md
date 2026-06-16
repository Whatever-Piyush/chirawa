# 🛒 Daily Essentials — Top-Selling SKUs for Chirawa (Tier-3) — Research + Section Design

> **Goal:** replace the home **"For You"** feed swiper with a **"Daily Essentials"** rail —
> the everyday top-selling SKUs a Chirawa household buys repeatedly (milk, atta, bread, eggs,
> oil, dal, tea, soap, biscuits…), so a regular shopper grabs the basics in seconds **without
> scrolling or searching**. This doc does the research **and** designs the section. **No code
> until approved.** Real catalog SKUs + real prices only — no fabricated "bestseller" ranks.
>
> **Companions:** `1.md` (Bestsellers), `2.md` (Beauty/Household). **Chosen heading: "Daily
> Essentials"** (subtitle optional, Hindi-friendly: *रोज़ का ज़रूरी सामान*).

---

## 1. Research — what actually sells daily in tier-3 / rural India

Consistent across the sources (q-commerce data, kirana retail, Kantar CRP, rural FMCG):

- **Highest-frequency SKUs (near-daily):** milk, eggs, bread, **dahi/curd**, bananas — "outsell
  in many cities … move every single day across every dark store." Add daily veg: **onion,
  potato, tomato**.
- **Staples = highest volume by order count:** **atta, rice, dal, cooking oil, sugar, salt,
  tea, spices** — "the backbone of every Indian kitchen."
- **Fast-moving impulse:** **biscuits, instant noodles, namkeen, cold drinks, packaged water.**
  *Parle-G is the world's #1 biscuit; Maggi holds 60%+ of instant noodles.*
- **Rural/tier-3 strong specifically:** **soaps, detergents, toothpaste, hair oil, biscuits,
  namkeen, mosquito repellent, refined oil, batteries.** *(Parle #1 chosen FMCG brand, then
  Britannia, Amul, Clinic Plus, Tata — Kantar Consumer Reach Points.)*
- **Tier-3 buying behaviour:** **₹5 / ₹10 "magic price points"**, **sachets & small packs**,
  affordability-first; basket sizes rising (5.8→9.3 items, 2022→24) but value-led.
- **Why these win on quick-commerce:** daily/near-daily consumption, urgency, no substitute at
  home — exactly the "run out of milk/bread" moments.

> Implication for Chirawa: lead with **perishables + kitchen staples**, then **everyday
> snacks/personal/home care**, and bias toward **affordable, small packs**.

---

## 2. The Chirawa "Daily Essentials" list — mapped to our live catalog

Ordered by buy-frequency. Each maps to a **real seeded SKU** (so the rail shows actual products
at real prices). Out-of-stock entries are simply skipped.

### Tier 1 — Daily perishables (top of the rail)
| Essential | Catalog SKU |
|---|---|
| Milk | **Amul Taaza Toned Milk** (alt: Mother Dairy Toned Milk) |
| Bread | **Britannia Whole Wheat Bread** |
| Eggs | **Farm Fresh Eggs** |
| Curd / Dahi | **Amul Masti Dahi** (alt: Mother Dairy Classic Dahi) |
| Banana | **Fresh Banana** |
| Onion | **Onion** |
| Potato | **Organically Grown Potato** |
| Tomato | **Tomato Local** |

### Tier 2 — Kitchen staples (core monthly, always-in-cart)
| Essential | Catalog SKU |
|---|---|
| Atta | **Aashirvaad Select Atta** (alt: Fortune Chakki Fresh) |
| Rice | **India Gate Classic Basmati** (alt: Daawat Rozana) |
| Cooking oil | **Fortune Sunflower Oil** (alt: Saffola Gold) |
| Sugar | **Madhur Pure Sugar** |
| Salt | **Tata Salt Iodised** |
| Dal | **Tata Sampann Toor Dal** |
| Tea | **Tata Tea Gold** (alt: Brooke Bond Red Label) |
| Ghee | **Amul Pure Ghee** |

### Tier 3 — Everyday snacks & beverages (impulse / kids)
| Essential | Catalog SKU |
|---|---|
| Biscuits | **Parle-G Gold Biscuits** *(world's #1)* |
| Instant noodles | **Maggi 2-Minute Masala Noodles** *(60% share)* |
| Namkeen | **Bikaji Bikaneri Bhujia** |
| Cold drink | **Thums Up** (alt: Coca-Cola) |
| Water | **Bisleri Mineral Water** |

### Tier 4 — Daily personal & home care (rural-strong)
| Essential | Catalog SKU |
|---|---|
| Bath soap | **Lifebuoy Total 10 Soap** (alt: Lux / Dettol) |
| Shampoo | **Clinic Plus Strong & Long Shampoo** |
| Hair oil | **Parachute Coconut Hair Oil** (alt: Dabur Amla) |
| Detergent | **Surf Excel Matic Powder** (alt: Ariel Matic) |
| Dishwash | **Vim Dishwash Gel (Lemon)** |
| Mosquito repellent | **Good Knight Gold Flash Refill** (alt: All Out) |
| Sanitary pads | **Whisper Ultra Soft (XL+)** |

**~28 SKUs — all shown** in the rail, **frequency-ordered** (perishables → staples → snacks →
care), so the everyday basics (milk, bread, eggs, atta, oil) need **zero swipe** and the full
daily basket lives in one place. Out-of-stock entries are skipped.

### ⚠️ Catalog gaps the research flags (recommend adding)
- **Toothpaste (Colgate/Close-Up)** — a top-penetration daily SKU, **missing** from the seed.
- **Small/sachet & ₹5–₹10 packs** — tier-3 magic price points (shampoo sachet, ₹10 biscuit,
  small atta/oil). Catalog is mostly standard packs; adding small packs improves tier-3 fit.
- *(Minor)* matchbox / agarbatti, candles — common kirana dailies.

---

## 3. Section design (replaces "For You")

- **Heading:** **"Daily Essentials"** as the **first** scroll section (above Bestsellers).
  Optional subtitle: *"Milk, atta, bread & more — in minutes"* / *रोज़ का ज़रूरी सामान*.
- **Layout (LOCKED):** a **horizontal dense-card rail** (same `ProductCard size="dense"`),
  ordered Tier 1 → Tier 4, so the absolute essentials (milk, bread, eggs, atta, oil) are
  **visible with zero scroll**; the shopper swipes only for the long tail.
- **Alignment:** reuse the standardized section style (title 17 · `marginTop 18` · HPAD 16 ·
  gap 10) so it lines up with Bestsellers / category grids.
- **Closed store:** same as today — ADD disables gracefully with a toast.

---

## 4. Backend — curated now → data-driven later (honest by design)

This is **"Daily Essentials" (a curated everyday set)**, *not* a claimed sales rank — so it's
truthful with zero order history. It auto-upgrades to real data once traffic exists.

**Phase 1 — curated (ship now):** a backend-defined ordered list resolves each essential to the
best **in-stock** catalog product, returned as **aggregated tiles** (reuse aggregation: cheapest
in-stock across shops, shop hidden, real price). Skips anything out of stock.
```ts
// catalog.service.ts — config + resolver (pure list, testable)
interface Essential { key: string; label: string; prefer: string; match: RegExp }
const DAILY_ESSENTIALS: Essential[] = [
  { key: 'milk',  label: 'Milk',  prefer: 'Amul Taaza Toned Milk',        match: /toned milk/i },
  { key: 'bread', label: 'Bread', prefer: 'Britannia Whole Wheat Bread',  match: /bread/i },
  { key: 'eggs',  label: 'Eggs',  prefer: 'Farm Fresh Eggs',              match: /egg/i },
  …atta, oil, sugar, salt, dal, tea, ghee, parle-g, maggi, soap, hair oil, detergent…
];
// getDailyEssentials(): for each entry → find active+in-stock product (prefer exact name,
// else first /match/), map to an aggregated tile, keep curated order. Cached (catalog:essentials),
// busted in invalidateShopCache. Returns ProductCard-shaped tiles.
```
- **Route:** `GET /catalog/daily-essentials` (public).
- **Phase 2 — data-driven (later, additive):** rank by `OrderItem` quantity over the last 30
  days, **blended** with the curated list, so the rail tunes to what Chirawa actually buys.
  No fabrication — it only ranks real sales once they exist.

---

## 5. Frontend
1. `@chirawa/api-client` — `getDailyEssentials()`.
2. `catalog.ts` — `fetchDailyEssentials(): Promise<ProductCardData[]>` (reuse `toFeedCard`).
3. New `DailyEssentialsShelf.tsx` (horizontal dense rail; heading "Daily Essentials") —
   **replaces** `ForYouFeedShelf` in `HomeScreen`.
4. `HomeScreen.tsx` — fetch essentials; render the shelf first. Retire `ForYouFeedShelf`
   (leave in repo, unused) and drop the now-unused full-feed fetch if nothing else needs it.

---

## 6. 🔒 Security & data-integrity
| Risk | Status |
|---|---|
| Fabricated "top seller" claim | ✅ avoided — it's a **curated "Daily Essentials"** set; Phase 2 ranks only **real** sales |
| Shop identity / price leak | ✅ aggregated tiles — shop hidden, real lowest price, no `shopId`/PII |
| Auth | ✅ public read; ADD goes through the existing authed cart |
| Stale price | ✅ resolver re-validates at checkout (Phase 5) |
| Cache | ✅ Redis-cached + busted on inventory writes |
| Out-of-stock essential | ✅ skipped (never a dead tile) |

---

## 7. 📂 Files to touch (when we build)
| File | Change |
|---|---|
| `apps/api/.../catalog.service.ts` | **+** `DAILY_ESSENTIALS` + `getDailyEssentials()` + cache key/bust/export |
| `apps/api/.../catalog.routes.ts` | **+** `GET /daily-essentials` |
| `apps/api/.../__tests__/catalog.essentials.test.ts` | **+** resolver unit tests (keeps suite green) |
| `packages/api-client/src/index.ts` | **+** `getDailyEssentials()` |
| `apps/customer-app/.../services/catalog.ts` | **+** `fetchDailyEssentials()` |
| `apps/customer-app/.../home/DailyEssentialsShelf.tsx` | **NEW** — horizontal dense rail |
| `apps/customer-app/.../home/HomeScreen.tsx` | swap For You → Daily Essentials |

**Not touched:** Bestsellers, category grids, cart, backend tests (additive). `ForYouFeedShelf` retired, not deleted.

---

## 8. 🧭 Build steps
1. Backend — `DAILY_ESSENTIALS` + `getDailyEssentials()` + route + test (Context7 → Prisma v5 first).
2. Client — `api-client.getDailyEssentials()` + `fetchDailyEssentials()`.
3. UI — `DailyEssentialsShelf` (rail).
4. Wire — HomeScreen swap; retire For You.

## 9. 🎯 Done-when  — ✅ BUILT (2026-06-15)
- [x] Home opens with a **"Daily Essentials"** rail (Tier-1 milk/bread/eggs/atta first, zero swipe).
- [x] Tiles are **real in-stock SKUs** at aggregated lowest price; out-of-stock skipped.
- [x] Heading/alignment consistent with the rest of the home (title 17 · HPAD 16 · gap 10).
- [x] `GET /catalog/daily-essentials` = a view over the cached feed (no new DB query); no PII/shop/price leak.
- [x] `tsc` clean (customer-app + api-client); **API tests green: 221** (215 + 6 new `pickDailyEssentials`).
- [x] Verified live: endpoint returns the full 28-SKU rail, correctly ordered (oil→cooking, not hair oil).

## 10. ✅ Locked decisions
1. **Layout:** horizontal **rail** of dense cards (Tier-1 first → zero-scroll essentials).
2. **Count:** the **full curated set (~28)**, frequency-ordered (top-frequency first). *(You
   asked for "all the daily essential items" listed — so the rail shows the whole daily basket,
   not a capped subset.)*
3. **Catalog: not touched** — the rail uses **only seeded SKUs**. *(Toothpaste stays a known
   gap — it simply won't appear in the rail until it's added to the catalog in a later pass.)*
4. **Heading:** "Daily Essentials".

---

## Sources
- [Shiprocket — Top selling products in quick commerce (India)](https://www.shiprocket.in/blog/most-selling-products-on-quick-commerce/)
- [Accio — Top selling grocery items in India 2025](https://www.accio.com/business/top-selling-grocery-items-in-india)
- [getSwipe — General store items list](https://getswipe.in/blog/article/general-store-items-list)
- [gfreshmart — Best kirana store items by sales](https://www.gfreshmart.com/best-20-kirana-store-items-which-have-more-sales/)
- [Badho — Why Tier 2 & 3 cities are the new FMCG battleground](https://blog.badho.in/rural-rural-gold-rush-why-tier-2-3-cities-are-the-new-battleground-for-fmcg-growth)
- [IBEF — FMCG prospects in the Indian rural market](https://www.ibef.org/blogs/fmcg-sector-prospects-in-the-indian-rural-market)
- [Business Standard — Parle, Britannia top chosen FMCG brands (Kantar CRP)](https://www.business-standard.com/industry/news/parle-britannia-emerge-as-india-s-top-chosen-fmcg-brands-kantar-124072501117_1.html)
- [Market Xcel — Rural consumption revival 2025](https://www.market-xcel.com/blogs/rural-consumption-revival-fact-fiction)
