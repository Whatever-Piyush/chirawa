# Inventory & Product Imagery — Research + Plan

_Last updated: 2026-06-13 · Branch: `feat/blinkit-style-catalog`_

This doc answers one question: **when we add inventory, where do the product
images come from?** Do we photograph every item ourselves, pull images off the
internet, edit them — and how do we do this for _thousands_ of SKUs without it
becoming a full-time job?

---

## TL;DR (the short answer)

**Do NOT photograph everything yourself. You'd be re-shooting photos that already
exist.** A Chirawa quick-commerce catalog is mostly standard branded packaged
goods (Amul, Aashirvaad, Tata, Parle, Britannia, Maggi…). Someone has already
shot every one of those. Your job is to _fetch_ those, not _recreate_ them.

The winning strategy is a **tiered, barcode-keyed pipeline**:

1. **Branded packaged FMCG (~70–85% of SKUs)** → auto-fill images by **barcode
   lookup** from licensed/open databases. Near-zero manual effort.
2. **Loose / fresh / local items (~10–20%)** → one clean in-house photo per
   _category_ of loose item (e.g. one "loose tomatoes" shot), reused widely.
3. **Obscure local brands not in any database (~5–10%)** → snap the pack with a
   phone during stocking. You physically have the product; it's a 10-second job.

So the operational answer to _"hell lot of images, how?"_ is: **scan the barcode
while stocking, let a background job fill ~80% of images automatically, and only
a human-photograph the small uncovered tail.**

> The percentages above are estimates for a small-town kirana-style catalog —
> validate them against your first real product list, but the shape holds.

---

## The decision (recommended approach)

| Layer | Choice |
|-------|--------|
| **Primary image source** | Barcode → **Open Food Facts** (free, open license) to bootstrap; **GS1 India DataKart** (official, license-clean) as the authoritative source once subscribed |
| **Long-tail source** | In-house phone photos (loose items + obscure local brands) + brand/distributor asset kits |
| **Standardization** | Normalize everything to one spec (square, white bg, WebP) via `sharp` + a background-removal step |
| **Storage** | Re-host **everything** to our existing **Cloudflare R2** bucket — never hotlink |
| **Join key** | A new **`barcode` (GTIN/EAN)** field on `Product` — this is the spine of the whole pipeline |

**Why this and not "just take photos" or "just grab from Google":** it's both the
**cheapest** (you photograph maybe 15–20% of the catalog instead of 100%) *and*
the **safest** legally (open/official sources + your own photos sidestep the
copyright question entirely — see [Legal](#legal--licensing-guardrails)).

---

## Your three options, evaluated

You asked specifically: **(a)** click pics of everything ourselves, **(b)** use
internet images, or **(c)** edit internet images. Here's the honest evaluation.

### (a) Photograph every item ourselves
- ✅ Zero copyright risk; full control; consistent look.
- ❌ **Does not scale.** Thousands of SKUs × (unbox, shoot, edit, upload) = weeks
  of labour, repeated every time a new product lands. You'd be re-shooting
  Amul Milk that's already been shot a million times.
- **Verdict:** Right for the _long tail only_ (loose items, obscure local brands),
  wrong as the default for branded goods.

### (b) Use internet images as-is
- ✅ Fast, free-ish, huge coverage.
- ❌ "The internet" is not one thing. Pulling from **Google Images / competitor
  apps (Blinkit/Zepto/BigBasket)** = unknown or clearly-owned copyright + likely
  terms-of-service violation. **Hotlinking** external URLs also breaks the day
  the source moves/blocks you.
- **Verdict:** Only safe when the source is **licensed/open** (Open Food Facts,
  GS1 DataKart, brand asset kits) **and you re-host it**. Never blind-grab from
  search results or scrape competitors.

### (c) Edit internet images
- This isn't really a _source_ — it's a _normalization step_ you should apply to
  **all** images regardless of origin (see [Standardization](#standardization-the-edit-them-step)).
- Editing a copyrighted image doesn't make it yours. Editing a **licensed/open**
  image to fit your spec is exactly right.
- **Verdict:** Yes — but as a pipeline step on top of a legitimate source, not as
  a way to "launder" a copyrighted image.

**Conclusion:** the real answer isn't a/b/c — it's **"the right source per tier,
re-hosted, then normalized."**

---

## Where images actually come from (sources, ranked)

Ranked by a mix of legal-cleanliness, India coverage, and cost.

| # | Source | Coverage (India) | License / legality | Cost | Use it for |
|---|--------|------------------|--------------------|------|-----------|
| 1 | **GS1 India — DataKart** | Authoritative for barcoded Indian retail products; brand-owners upload catalogue-ready images + MRP + net content | **Cleanest** — brand-sanctioned national repository | Custom quote — **DataKart for _Retailers_** program (NOT a brand barcode/GCP pack) | The long-term primary source for branded FMCG — _at launch, not in dev_ |
| 2 | **Open Food Facts (OFF)** | Good & growing for India food/grocery; barcode → front/ingredients/nutrition images | **Open — CC-BY-SA** (attribute + share-alike; re-host allowed) | **Free** | Bootstrapping the catalog _now_, before DataKart is set up |
| 3 | **Brand / distributor asset kits** | Whatever your actual suppliers stock | Clean — they _want_ their goods shown | Free (just ask) | High-quality shots for top brands; your distributors often already have these |
| 4 | **Commercial barcode APIs** (Go-UPC, Barcodelookup, UPCitemdb, EAN-Search) | Very broad globally (708M–1.2B+ items) | ⚠️ **Murky** — images are aggregated/scraped; licensing unclear | Paid per lookup | _Discovery aid_ only (find the barcode/name), not as a clean image license |
| 5 | **In-house phone photos** | Anything you physically stock | Cleanest — you own it | Time + a ~₹1,500–3,000 lightbox | Loose/fresh items, obscure local brands |
| 6 | **AI-generated images** | N/A | You own the output; but never fake a _branded pack_ | ~free–cheap | Generic category art only (e.g. a "loose vegetables" tile), never to fabricate a real branded label |

### How barcode → image works (the mechanism)
- Every packaged product has a **GTIN/EAN barcode**. That number is the universal
  key. Scan it with a phone during stocking.
- **Open Food Facts:** given the 13-digit barcode you can resolve directly to
  image URLs (front/ingredients/nutrition/packaging). Pad the barcode to 13
  digits, then their folder scheme maps it to the stored images — see their
  ["How to download images"](https://openfoodfacts.github.io/openfoodfacts-server/api/how-to-download-images/)
  guide. **Download once and re-host to R2** — don't hammer their servers and
  don't hotlink (CC-BY-SA wants attribution + the link would be fragile anyway).
- **DataKart:** same idea but brand-supplied and authoritative; access is via a
  GS1 India subscription rather than an open URL.

---

## Legal & licensing guardrails

Researched for India specifically. The honest picture:

- **Strict copyright:** whoever _clicks_ the photo owns it. A manufacturer's
  pack-shot is owned by the brand/manufacturer. Copying it without permission
  **can** infringe copyright, and Indian courts also protect packaging as
  **trademark / trade-dress**.
- **Practical reality for a genuine reseller:** you're selling the actual branded
  product, and brands generally _want_ their goods displayed. Using a brand's own
  distributed pack-shot to sell their genuine product is near-universal in Indian
  retail and **low-risk in practice** — but "low risk in practice" is **not** the
  same as "licensed."
- **The clean path that removes the question entirely** (and is also the cheapest):
  - ✅ **GS1 DataKart** (brand-sanctioned) for branded goods.
  - ✅ **Open Food Facts**, **re-hosted + attributed** (CC-BY-SA).
  - ✅ **Brand/distributor asset kits** — just ask your suppliers.
  - ✅ **Your own photos** for everything else.
- **Do NOT:**
  - ❌ Scrape **Blinkit / Zepto / BigBasket / Amazon / Flipkart** images — those
    are their copyrighted catalog photos + a ToS violation.
  - ❌ Blind-grab from **Google Images** — mixed/unknown licenses.
  - ❌ **Hotlink** any external URL — re-host to R2 always.
  - ❌ Use AI to fabricate a **branded label/pack** that doesn't match reality
    (misleading + IP risk). AI is fine for generic, non-branded category art.

**Attribution:** for any OFF/CC-BY-SA images, keep an attribution record (store the
source URL + license on the image row, or maintain a credits page). Cheap insurance.

> This is engineering guidance, not legal advice. Before scaling to thousands of
> SKUs, a 30-minute check with a lawyer on "branded pack-shots for resale listings"
> is worth it — but the clean path above is designed so the answer is boring.

---

## Standardization (the "edit them" step)

Whatever the source, push **every** image through one normalization step so the
catalog looks uniform — this is what makes a mixed-source catalog look as clean as
Blinkit's.

**Target spec (proposed):**
- **Shape:** square **1:1** (Blinkit-style tiles)
- **Background:** white `#FFFFFF` (or transparent PNG, then composited on white)
- **Product fill:** ~80–85% of the frame, centered, consistent padding
- **Size:** ~1000–1500px, served as **WebP**
- **Naming:** keyed by product/barcode, stored in R2 under `products/`

**Tools:**
- **Resize / pad / format → [`sharp`](https://sharp.pixelplumbing.com/)** (Node lib;
  add as an `apps/api` dependency). Fast, runs in the same worker.
- **Background removal** — pick one:
  - **Managed API:** [Photoroom API](https://www.photoroom.com/api) ≈ **$0.01–0.02/image**
    (~$20/mo → 1,000 images) — cheapest managed option. [remove.bg](https://www.remove.bg/)
    is similar but pricier.
  - **Self-hosted:** `rembg` / **BiRefNet** models — **~free** at marginal cost
    (just compute). Best if volume is high and you're cost-sensitive.

For 5,000 SKUs, a managed bg-removal pass is a **one-time ~$50–100**. Negligible.

---

## How this maps to OUR codebase today

Good news: **most of the plumbing already exists.** Here's the current state and
the gaps.

### ✅ What we already have
- **Storage:** Cloudflare R2 wired up — `apps/api/src/services/r2.service.ts`
  exposes `uploadImage(folder, buffer, mime) → publicUrl`. R2_* env vars exist in
  `.env.example`.
- **Data model:** `Product` → `ProductImage[] { url, sortOrder }`
  (`apps/api/prisma/schema.prisma:327`). Customer catalog already serves
  `imageUrl: images[0].url` (`catalog.service.ts`).
- **Admin endpoints** (`apps/api/src/modules/admin/admin.routes.ts`):
  - `POST /admin/upload-image?folder=products` — multipart → R2 (5 MB cap).
  - `PUT  /admin/products/:id/image  { url }` — set primary image.
  - `PUT  /admin/products/:id/images { urls[] }` — set the whole carousel.
- **Bulk CSV import** (`catalog/inventory.service.ts` → `importProductsCsv`):
  already has an **`image_url`** column and creates `ProductImage` rows from it.
  Template: `apps/api/src/modules/catalog/templates/product-import-template.csv`.
- **Seller app** (`apps/seller-app`): `StockScreen.tsx` already lets sellers
  add/edit products + CSV-import. Natural home for a "snap a photo" button.

### ❌ Gaps to close
1. **No barcode field.** `Product` has no `barcode/GTIN` — only `ProductVariant.sku`
   (free text). Without a barcode key, automated enrichment can't join. **This is
   the #1 thing to add.**
2. **CSV `image_url` is stored as-is (hotlinked).** `inventory.service.ts:337`
   writes the external URL straight into `ProductImage.url`. Needs to become
   **fetch → normalize → re-host to R2**.
3. **No image normalization.** The upload path stores raw bytes — no resize / pad /
   bg-removal / WebP. No `sharp` dependency yet.
4. **Upload is admin-only.** Sellers can't add images from the seller app today;
   the manual-fallback flow needs a seller-scoped upload route.

---

## Build plan (phased, mapped to files)

### Phase 0 — Schema: add the barcode key
- Add to `Product` in `apps/api/prisma/schema.prisma`:
  ```prisma
  barcode String? @db.VarChar(14) @map("barcode")
  // ...
  @@index([barcode])   // NOT unique — same GTIN can exist per-shop as separate rows
  ```
- Migration via Prisma v5 (per `apps/api/CLAUDE.md` — pull Context7 docs first).
- Add `barcode` to the CSV template + `importProductsCsv` parsing.

### Phase 1 — Image normalization service
- New `apps/api/src/services/image-pipeline.ts`:
  `normalize(buffer) → { webpBuffer }` using **`sharp`** (resize, pad to square,
  white bg, WebP) + an optional **bg-removal** call (Photoroom API or self-hosted).
- Route the **existing** `uploadImage` through it so _every_ upload (admin, seller,
  enrichment) lands normalized and consistent.

### Phase 2 — Barcode enrichment worker (the bulk win)
- A **BullMQ v5** worker (per `apps/api/CLAUDE.md`: no `QueueScheduler` in v5):
  for each `Product` with a `barcode` and no `ProductImage`:
  1. Look up **Open Food Facts** by barcode (free) → fall back to **DataKart**
     (if subscribed) → else mark **`needs_manual`**.
  2. Download the front image → run Phase-1 normalize → `uploadImage('products', …)`
     → create `ProductImage`.
  3. Record source + license (for OFF attribution).
- This is what turns "thousands of images" into an **unattended queue**. Run it
  once over the seed catalog, then on every new product with a barcode.

### Phase 3 — Upgrade CSV import
- Add a **`barcode`** column (seeds the join key for Phase 2).
- Change `image_url` handling: instead of storing the raw URL, **fetch →
  normalize → re-host to R2** (kills hotlinking). Keep it backward-compatible.

### Phase 4 — Seller capture (the long-tail fallback)
- Add a seller-scoped upload route (mirror `POST /admin/upload-image`, but
  `requireRole('seller')` + shop-ownership check).
- In `apps/seller-app/StockScreen.tsx` add/edit modal: an **"Add photo"** button
  using `expo-image-picker` (camera). Phone shot → upload → normalize → done.
  > ⚠️ Seller app is **Expo v56** — per `apps/seller-app/AGENTS.md`, read the
  > versioned Expo docs before writing the picker code.
- Surface a **`needs_manual` worklist** so sellers/admin can clear the gap.

### Phase 5 — Coverage dashboard
- A simple admin metric: **% of active SKUs with an image**, and the
  `needs_manual` count. Work the number toward ~100%. This is your operational
  health gauge for the catalog.

---

## Day-to-day operational playbook

What the humans actually do once the pipeline exists:

1. **Stocking a new product?** Scan its barcode (phone) → it goes into the catalog
   with the barcode set.
2. The **enrichment worker** auto-fills the image overnight for ~80% of items.
3. Each morning, whoever manages the catalog opens the **`needs_manual` list** —
   usually just loose items + a few obscure local brands — and snaps phone photos.
4. **No barcode** (loose veg/fruit/sweets)? Use the shared per-category photo
   (one "loose tomatoes" image reused for all tomato SKUs).

Result: you photograph **~15–20%** of the catalog, not 100%, and new products
mostly self-populate.

---

## Cost reality & the dev-phase ₹0 plan

**Bottom line: in dev phase, spend ₹0 on images/data. Do NOT pay GS1 anything yet.**
We're pre-launch, not on Play Store, and reselling _other people's_ brands — GS1 is
for manufacturers or scaled retailers with a data-feed budget. Skip it for now.

### What GS1 actually costs (verified)
GS1 India barcode fees are slab-based (annual turnover × barcode quantity × years).
GS1 does **not** publish flat public numbers — you only get them from their
[fee calculator](https://www.gs1form.org/register-for-barcode) or by contacting them.
Real-world ranges, all **+18% GST**:
- One-time joining/registration: **₹7,500 – ₹75,000**
- Annual subscription: **₹2,500 – ₹25,000 / yr**
- Refundable security deposit: fixed (~₹3,000 – ₹11,800)

So the "~₹43k first year" figure going around is a _plausible mid-slab estimate_, not
an authoritative quote — treat it as rough.

### ⚠️ Important correction — don't fall for the "GCP hack"
A GS1 **barcode subscription / GCP** lets a **manufacturer create barcodes for their
OWN products**. It does **not** exist to let you download _other brands'_ images.
Pulling other brands' data + images as a **reseller marketplace** is a **separate
program — "DataKart for Retailers/E-tailers"** — with its own registration and **no
public pricing (custom quote, "our team will reach out")**. So paying ~₹43k for a
brand GCP would **not** cleanly get you what you actually want. Don't do it.

### MSME 80% subsidy — probably not for us
The govt MSME barcode-reimbursement scheme (up to ~₹50,650 over 3 years) is **real**,
but it's for **micro-MANUFACTURING enterprises barcoding their own products**. A
reselling marketplace isn't a manufacturer, so it likely doesn't apply (re-check only
if we ever register a manufacturing arm).

### When does GS1 become worth it?
| Stage | App status | Image/data source | Spend |
|-------|-----------|-------------------|-------|
| **Now (dev)** | Localhost / Expo / not on Play Store | OFF + distributor export + placeholders | **₹0** |
| **Beta** | Closed beta in Chirawa | OFF + distributor catalogue + phone photos | **₹0** |
| **Launch+** | Live, real orders, 2,000+ SKUs to maintain | _Then_ consider DataKart-for-Retailers (custom quote) + paid bg-removal | ~quote |

### Getting 2,000–3,000 products in for ₹0 (the real method)
The hard part isn't images — it's getting a clean product list **with barcodes**
without typing 3,000 rows by hand. Three free routes, graded:

1. **🏆 Local distributor ERP export (Marg / Tally / Busy)** — _best_. Chirawa
   wholesalers run these; ask for an Excel/CSV product-master export → you get **real
   names + barcodes + MRP + HSN** for exactly the SKUs sold locally, in minutes. This
   is your seed CSV. Clean, accurate, free, hyper-relevant.
2. **✅ Open Food Facts** — free images by barcode. Caveats: it's **food only**
   (non-food grocery → smaller [Open Products Facts](https://world.openproductsfacts.org/data)
   / Open Beauty Facts), and for thousands of items **use the nightly India
   [bulk data dump](https://world.openfoodfacts.org/data)**, not 3,000 live API calls
   (they ask you not to hammer the API). Images are CC-BY-SA → re-host + attribute.
3. **⚠️ Kaggle/GitHub "BigBasket/Blinkit" datasets** — useful **only** for a starter
   _name/category/MRP_ list. Their **images are BigBasket's copyrighted CDN files**
   (the exact thing to avoid — see [Legal](#legal--licensing-guardrails)) and they
   usually **don't contain real EAN barcodes**. Take the names, drop the images.

### The ₹0 pipeline, concretely
1. Distributor ERP export → seed CSV (name + barcode + MRP + category).
2. Add `barcode` to the schema (Phase 0) → import the CSV.
3. OFF India bulk dump → match by barcode → fetch front image → `sharp` normalize →
   re-host to R2. Auto-fills the food/FMCG majority for ₹0.
4. Gaps (non-food, local brands) → phone-photo the long tail (we physically have them).
5. Background removal in dev: **self-hosted `rembg` (free)** or just use OFF pack shots
   as-is (already white-bg). Skip paid plans entirely for now.
6. Missing image → a placeholder tile so the UI never looks broken.

**Dev-phase total: ₹0.** The only spend is a bit of time on the distributor export +
phone-shooting the tail. The expensive resource is **human photography time** — and the
whole plan exists to minimize it.

---

## The 100% free tool stack (₹0 at our scale)

Every step has a genuinely free tool. Nothing here threatens a paid tier at our size.

| Need | Free tool | License | Why it's free / safe |
|------|-----------|---------|----------------------|
| Product list + barcodes | Distributor ERP export · [OFF bulk dump](https://world.openfoodfacts.org/data) | Open / yours | Free; barcodes included |
| Images by barcode (food) | [Open Food Facts](https://world.openfoodfacts.org/data) | CC-BY-SA | Free; re-host + attribute |
| Images (non-food / cosmetics) | [Open Products Facts](https://world.openproductsfacts.org/data) / Open Beauty Facts | CC-BY-SA | Free; smaller coverage |
| Resize / pad / WebP | [`sharp`](https://sharp.pixelplumbing.com/) | Apache-2.0 | Free npm lib (already in the plan) |
| **Background removal** | **[`rembg`](https://github.com/danielgatis/rembg)** | **MIT ✅** | Free **for commercial**, self-hosted, batches a whole folder, runs offline |
| Image storage + CDN | **Cloudflare R2 — already set up** | Free tier | 10 GB storage, 1M writes + 10M reads/mo, **$0 egress** |
| Barcode scanning (stocking) | `expo-camera` / `expo-barcode-scanner` | MIT | Free; we're already on Expo |
| One-time bulk bg-removal of 3,000 imgs | [Google Colab](https://colab.research.google.com/) free GPU running `rembg` | Free | No local GPU needed |
| Missing-image fallback | placeholder tile (local asset / [placehold.co](https://placehold.co)) | Free | UI never looks broken |

### ⚠️ "Free" traps to avoid
- **BRIA RMBG-1.4 / 2.0** (the popular Hugging Face bg-removal model) is
  **non-commercial only** — commercial use needs a **paid BRIA license**. Many "free"
  demos quietly use it. **Don't ship it** — use `rembg` (MIT) instead.
- **`@imgly/background-removal-node`** is free but **AGPL-3.0** — copyleft that can
  force you to open-source your server. Fine for a quick test; for a closed-source app
  prefer **`rembg` (MIT)** to avoid the obligation.

### Why R2's free tier is plenty
3,000 normalized WebP images ≈ **0.15–0.45 GB** (vs 10 GB free). Uploads are a one-time
~3,000 writes (vs 1M/mo free). Customer reads are cached and **egress is $0**. We'd need
~30,000+ SKUs before storage is even a question.

### Do we even need bg-removal in dev?
Often **no** — OFF / distributor pack shots are usually already on white-ish
backgrounds. Treat `rembg` as a later polish step, not a blocker. In dev, use the
images as-is.

---

## Products not stocked in Chirawa (catalog vs. local reality)

The generic dumps (OFF, Kaggle) list thousands of India-wide products — far more than
any Chirawa shop actually carries. **Never let the reference dump become the
storefront.** Two layers:

- **Reference / master catalog** — the big generic list (OFF + datasets), keyed by
  barcode. A _lookup table_ for images/names/MRP + seller-onboarding autocomplete.
  **Not buyable.**
- **Sellable catalog** — per-shop `Product` rows, created only when a real Chirawa
  shop actually stocks the item. **This is all the customer sees.**

In our schema every `Product` already has a `shopId`, and the storefront filters by
`stockStatus`/`isActive`. So a product no local shop carries simply has **no sellable
row → it never shows as buyable.** That removes the "phantom inventory" worry; the dump
only ever _enriches_ items a shop actually adds.

### When a customer wants something no Chirawa shop has
| Play | What it does | When |
|------|--------------|------|
| **Hide by default** | Don't list unbuyable items | Launch default — cleanest |
| **🏆 "Request this item" / Notify me** | Captures latent demand → your sourcing roadmap | Always — highest-value move |
| **On-demand / next-day** | Procure from nearby wholesale (Jhunjhunu / Sikar / Pilani), deliver next day. Two speeds: _instant_ (stocked) vs _next-day_ (sourced) | When a partner can procure |
| **Substitute** | "X nahi hai — Y available hai" nearest alternative | When a close match is in stock |

The **"Request this item"** button is the unlock: every unavailable search becomes data
telling you exactly what to stock next. Top requests → take to the distributor → stock.

### The architecture win: master → seller autocomplete
Use the master as a **product picker** in the seller app: seller searches, taps
**"I stock this"** → a per-shop `Product` is created with name + image + barcode
pre-filled (no typing). Local availability grows organically, images come free, and the
storefront never shows phantom stock. This upgrades the existing `StockScreen` (where
sellers currently type every product).

> Data-model note: the clean version is a global `CatalogProduct` (keyed by `barcode`)
> that per-shop `Product` rows reference. For dev, keep it light — a lookup table/CSV
> that powers both enrichment _and_ the autocomplete is enough.

---

## Reconciling the plan with the current codebase

Before building the "virtual dark store" aggregation, know what already exists — some
of the plan is built, and one part points the _opposite_ way.

### Already built (don't rebuild)
- **Multi-shop carts** — items from different shops coexist in one cart, each cart item
  carries its own `shopId` (`cart.service.ts:167`).
- **Per-shop order splitting** — checkout groups the cart by shop and creates **one
  order per shop** (`orders.service.ts:155`); `Order.shopId` is **required**
  (`schema:401`).
- **"Chirawa Special" concept** — delivery-fee logic already branches on Special shops
  (`orders.service.ts:184`). Build Part 5 on this existing flag; don't add a parallel
  `isLocalSpecial`.
- **App-wide name dedup precedent** — categories are already deduped by name across shops
  (`catalog.service.ts:16`); product-by-barcode dedup is the same pattern.

### Not built yet
- **No global master table** (`MasterCatalog`/`CatalogProduct`) — Part 2's "dictionary"
  is a genuinely new table, keyed by `barcode`.
- **No feed aggregation** — today the same product from 3 shops shows as 3 tiles. Part 4's
  "single Maggi" is new presentation work.
- **No `barcode` field** on `Product` (Phase 0).

### The one real decision — aggregation model
| | **Path A — illusion as presentation (recommended)** | **Path B — single-shop resolution** |
|---|---|---|
| How | Keep per-shop orders; aggregate identical products in the feed (group by `barcode`), hide shop names, show one unified cart/order | Route the whole cart to the nearest single shop that has everything |
| Work | Mostly presentation on the existing engine | Big cart + checkout rewrite |
| Catch | Multi-shop cart still = multiple pickups → batch to one rider, or accept | Lower availability (one shop must have all items) |

**Three catches aggregation forces either way:**
1. **Canonical price** — 3 shops = 3 prices → pick one for the tile (recommend: lowest
   in-stock price, route there; or a platform-set price shops accept).
2. **Multi-shop = multi-delivery today** — to keep the "one delivery" feel, batch the
   per-shop pickups onto one rider (short distances in Chirawa make this viable).
3. **Stale-stock routing** — once the _platform_ picks the shop, a stale "In Stock"
   toggle = the platform's failed pickup. Need: rider "not available" → **auto-reroute to
   next nearest shop + auto-toggle that shop off.** (The most important missing safety net.)

> Recommendation: **Path A** — don't rebuild the fulfillment engine; layer the
> Blinkit-feel on top of the per-shop orders you already have.

---

## Open decisions / action items

- [ ] **(Launch stage — NOT now)** Get a **DataKart-for-Retailers** quote from GS1
      India (custom-quoted, not the brand barcode pack). In dev phase this stays ₹0 —
      see the "Cost reality & the dev-phase ₹0 plan" section.
- [ ] **Pick bg-removal:** managed (Photoroom, fastest to ship) vs self-hosted
      (`rembg`/BiRefNet, cheapest at scale). Recommend **start managed, revisit if
      volume explodes.**
- [ ] **Confirm the image spec** (square 1:1, white bg, ~1200px WebP) against the
      Blinkit-style tiles already being built on this branch.
- [ ] **Write the attribution policy** for OFF/CC-BY-SA images.
- [ ] **Lawyer sanity-check** on branded pack-shots for resale listings (30 min).
- [ ] Decide whether `barcode` lives on `Product` (recommended) or also flows down
      to `ProductVariant` for pack-size-specific images.

---

## Sources

- [Open Food Facts — API docs](https://openfoodfacts.github.io/openfoodfacts-server/api/) ·
  [How to download images](https://openfoodfacts.github.io/openfoodfacts-server/api/how-to-download-images/) ·
  [Data / API / SDKs](https://world.openfoodfacts.org/data)
- [GS1 India — DataKart (national product-data repository)](https://www.gs1india.org/services/datakart) ·
  [DataKart for brand owners & retailers](https://www.gs1india.org/blog/understanding-gs1india-datakart)
- [Selling on Blinkit/Zepto — listing/image requirements](https://blusteak.com/blog/how-to-sell-on-zepto-and-blinkit) ·
  [Quick-commerce product listing services](https://www.digitosis.com/services/quick-commerce-product-listing)
- [The overlap of copyright & trademark in product packaging (India)](https://www.intepat.com/blog/the-overlap-of-copyright-and-trademark-in-product-packaging) ·
  [Legality of identical packaging in India (iPleaders)](https://blog.ipleaders.in/legality-identical-packaging-india/) ·
  [Copyright protection for ecommerce (goNukkad)](https://www.gonukkad.com/blog/copyright-protection-for-ecommerce-websites)
- Background removal: [Photoroom API](https://www.photoroom.com/api) ·
  [Photoroom vs remove.bg](https://www.photoroom.com/api/photoroom-vs-removebg) ·
  [Background Removal API comparison 2026 (boost.photos)](https://boost.photos/en/blog/background-removal-api-comparison-2026)
- Barcode databases: [Go-UPC](https://go-upc.com/) ·
  [UPCitemdb](https://www.upcitemdb.com/) ·
  [Barcode Lookup API](https://www.barcodelookup.com/api) ·
  [EAN-Search](https://www.ean-search.org/)
- Image processing: [`sharp`](https://sharp.pixelplumbing.com/)
</content>
</invoke>
