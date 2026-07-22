# OPERATIONS_LIFECYCLE.md

> The operations / admin lifecycle: how founders run the town day-to-day — onboarding,
> live dispatch monitoring, catalog moderation, financial settlement oversight, escalations,
> and the background-job machinery that keeps it all moving. Traced to code; `path:line`.
>
> There is **no separate admin app in this repo.** Operations = authenticated REST endpoints
> under `/api/v1/admin` (`modules/admin/admin.routes.ts`, all `requireRole('admin')`), the
> background **worker** (`apps/api/src/worker`), and SMS/manual escalations into the field apps.

---

## 1. Actors & ownership

| Actor | Responsibility |
|-------|----------------|
| Admin / Founder | Onboard shops & catalog, monitor dispatch, moderate catalog, oversee settlements, handle escalations |
| Worker process | Run scheduled jobs (settlement, reconciliation, cleanup, enrichment) and on-demand assignment |
| External services | Razorpay (payments/payouts), Fast2SMS (OTP + escalation SMS), FCM (push), Cloudflare R2 (images), OFF (catalog enrichment) |

**Admin identity** (`AdminProfile`, `schema.prisma:202`): `permissionLevel`, `ipAllowlist`,
`pinHash`, `totpSecret`. Login is OTP + PIN like seller/rider (`auth.service.ts`). Admins pass
the IDOR/role guards trivially (`role === 'admin'` short-circuits ownership checks in
`orders.service.ts:370` and `realtime.helpers.ts:36`).

---

## 2. Live dispatch monitoring (the ops cockpit)

`GET /api/v1/admin/dispatch` (`admin.routes.ts:119`) — the founders' real-time operational
snapshot (the full UI is future; the JSON is live):
- **Active orders** (last 24 h) in {paid, confirmed, preparing, ready_for_pickup, picked_up,
  out_for_delivery} with shop name, status, assigned rider name, amount, locality, payment
  method.
- **`unassigned` flag**: order is `confirmed`/`preparing`/`ready_for_pickup` but has **no
  rider** (`:155`) — these are what ops must act on.
- **Online riders** with their active delivery load (`:159-170`).
- Headline counters: `activeOrderCount`, `unassignedCount`, `onlineRiderCount`.

**Manual assignment** (the escalation landing): `POST /api/v1/delivery/orders/:id/assign`
(`requireRole('admin')`, `delivery.routes.ts:97`) calls the same `assignOrder` path the worker
uses — so when the no-rider SMS fires (§5), ops can force-assign from the same logic.

---

## 3. Onboarding & catalog operations

Ops loads the catalog (sellers have no product CRUD — see SELLER_LIFECYCLE.md §3):

| Operation | Endpoint | Notes |
|-----------|----------|-------|
| Bulk product import | `POST /admin/products/import` | Idempotent on (shopId, name), ≤500 rows, full attributes/variants/images (`admin.routes.ts:390`) |
| Upload image → R2 | `POST /admin/upload-image?folder=products\|shops` | Products go through the image pipeline (square WebP, EXIF stripped, content-hash rehost); shop logos keep aspect (`:259`) |
| Set product images | `PUT /admin/products/:id/image(s)` | Replaces all; busts catalog cache (`:319,351`) |
| Set shop images | `PATCH /admin/shops/:id/images` | Logo/cover; busts cache (`:287`) |
| Search aliases | `POST/PATCH/GET /admin/search-aliases` | Synonym expansion for search; Redis-cached (`:29-110`) |

Every write busts the relevant Redis catalog cache (`catalog:shop:{id}:full`,
`catalog:shops:active`).

---

## 4. Catalog moderation (Catalog Engine Phase 7)

The `MasterCatalog` dictionary is community/OFF-sourced, so it has a moderation gate
(`MasterStatus` ∈ {needs_review, approved, rejected}, `schema.prisma:54`). Only **approved**
masters are publicly usable / eligible for cross-shop aggregation.

Ops surface (`admin.routes.ts:199-251`, via `moderation.service`):
| Endpoint | Purpose |
|----------|---------|
| `GET /admin/moderation/masters` | The `needs_review` queue |
| `PATCH /admin/masters/:id/status` | Approve / reject a master |
| `GET /admin/moderation/image-reports` | Open "wrong image" reports (`ImageReport`) |
| `POST /admin/image-reports/:id/resolve` | Resolve a report (optionally re-approve) |
| `POST /admin/masters/:id/takedown` | One-click legal takedown — replace (swap+approve) or remove (clear+re-gate) |
| `GET /admin/moderation/price-outliers` | Products priced above own/master MRP |
| `GET /admin/coverage` | Image/barcode coverage + enrichment breakdown |
| `GET /admin/metrics` | DB-derived rates + threshold alert flags |
| `GET /admin/product-requests` | Ranked unmet demand ("request this item") to drive sourcing |

**Re-gating:** reporting a wrong image re-sets the linked master to `needs_review` (pulls it
from the public pool until fixed) — the moderation loop self-heals bad data.

---

## 5. Escalations (when the automated flow can't resolve)

| Trigger | Mechanism | Where it lands |
|---------|-----------|----------------|
| **No rider** for a batch after 10×60 s retries | SMS to `AppConfig['support_phone']` (`assignment.job.ts:48-57`) | Founder manually assigns via `POST /delivery/orders/:id/assign` |
| **Seller ignores** an order 3 min | Auto-accept forces `confirmed`; `missedAcceptances++` (`orders.service.ts:543`) | Order self-progresses; flag visible for follow-up |
| **Settlement needs attention** (no UPI / payout failed) | `Settlement.needsAttention=true` + `failureReason` (`settlement.job.ts:148,225,238`) | Admin adds UPI / retries payout |
| **Payment stuck** >30 min | Reconciliation marks paid + durably alerts seller (`reconciliation.job.ts`) | Automatic; no human needed |
| **Capture after cancel** | Auto-refund (`payments.service.ts:114`) | Automatic |

`AppConfig` (`schema.prisma:1037`) is the operational config table — `support_phone` is the
escalation target; key/value so ops can tune behavior without a deploy.

---

## 6. Financial oversight

Three ledgers/records ops cares about (all amounts integer paise):
- **`Transaction`** (`schema.prisma:795`) — append-only money ledger (customer_payment,
  refund, seller_settlement, rider_*). Written **only when money actually moves** (e.g. payout
  ledger is written after RazorpayX confirms `processed`, `settlement.job.ts:194`).
- **`Settlement`** — seller daily payouts; `status` ∈ {pending, processing, paid, failed};
  `needsAttention` is the ops alert flag.
- **`RiderSettlement`** — rider monthly salary (data model present; recurring job is a future
  add — see RIDER_LIFECYCLE.md §7).

**Refunds** ops can trigger: `initiateRefund` (`payments.service.ts:204`) — claims the payment
+ cancels the order **atomically before** the external refund (P0-2 safety ordering: never
refunded-but-fulfillable), reverts the claim on gateway failure, writes the ledger only after
the refund succeeds.

**Revenue at launch:** delivery fee only. Commission is 0 everywhere
(`Settlement.platformFeePaise=0`). Growth loops (referral/loyalty/wallet) are **hidden** for
launch — present in schema, off in product.

---

## 7. Background-job machinery (`apps/api/src/worker`)

The worker is a **separate process** from the API (see SYSTEM_MAP.md §6). Schedules are
registered idempotently on every worker boot (`scheduler.ts`, BullMQ dedupes by `jobId`):

| Queue / Job | Cadence | Owner file |
|-------------|---------|-----------|
| `settlement` / `daily-settlement` | 11:00 IST | `settlement.job.ts:49` |
| `settlement` / `payout-reconcile` | every 30 min | `settlement.job.ts:253` |
| `reconciliation` / `payment-reconcile` | every 15 min | `reconciliation.job.ts:19` |
| `cleanup` / location | 02:00 IST | `cleanup.job.ts` |
| `cleanup` / otp | every 6 h | `cleanup.job.ts` |
| `cleanup` / token | 03:00 IST | `cleanup.job.ts` |
| `cleanup` / cart | hourly | `cleanup.job.ts` |
| `enrichment` / catalog-enrich | 01:00 IST | `enrichment.job.ts` |
| `order-assignment` / assign-batch | on demand + retry | `assignment.job.ts` |
| `seller-accept` / auto-accept | 3 min after new order | consumed in **API** (`seller-timeout.plugin.ts`) |
| `referral` / unlock-referral | on demand | `referral.job.ts` (dormant at launch) |

**Concurrency** (`worker/index.ts:47-102`): settlement & reconciliation & enrichment run
serial (`concurrency:1` — money/rate-limited paths); cleanup 2, assignment 3, referral 5.

**Why some effects bypass the event bus:** the Redis event bridge is fire-and-forget (lossy).
The payment-reconciliation job — which exists precisely for orders whose normal flow already
failed — therefore does its critical effects **directly and durably**: it enqueues the seller
auto-accept BullMQ job and sends the seller FCM itself rather than trusting the bridge
(`reconciliation.job.ts:81-125`). This is the operational embodiment of "must-happen work goes
through Postgres + BullMQ."

---

## 8. External-service dependencies (ops failure surface)

| Service | Used for | Degradation behavior |
|---------|----------|----------------------|
| **Razorpay** | Customer payments, refunds, RazorpayX payouts | Dev-mock when unconfigured; **prod hard-guards** against fake payouts (`settlement.job.ts:159`); webhook + reconcile backstops |
| **Fast2SMS** | OTP, no-rider escalation | SMS failure is non-fatal to login (`otp.service.ts:178`); escalation SMS logged on failure |
| **FCM** | Push to all three apps | Notifications never crash order flow (`notifications.plugin.ts:188`); socket path is the live fallback |
| **Cloudflare R2** | Product/shop images | Image pipeline at upload time; cached URLs |
| **OpenFoodFacts dump** | Catalog image enrichment | No dump → masters marked `needs_manual`; never hits live OFF API in bulk (`worker/index.ts:43-45`) |
| **Redis** | Cart, cache, sockets adapter, event bridge, BullMQ, rate limits | **Hard dependency** — its loss degrades realtime, cart, and job delivery |
| **Postgres** | System of record | **Hard dependency** — all durable state |

---

## 9. Failure modes & launch-critical requirements

| Failure | Guard | Result |
|---------|-------|--------|
| Worker process down | Jobs queue in Redis; API still serves | Settlement/cleanup/assignment stall until worker returns — **monitor this** |
| Event bridge drops a worker→API message | Durable direct effects in critical jobs | Reconciliation still alerts seller & schedules auto-accept |
| Payout marked paid without money moving | Ledger written only on `processed` | No phantom settlements |
| Bad catalog data goes public | `needs_review` gate + image-report re-gating | Only approved masters surface |
| Founder unreachable for escalation | `support_phone` in `AppConfig` (tunable) | Update without deploy |
| Razorpay placeholder creds in prod | `isPayoutConfigured()` hard guard | Refuses to fake payouts |
| Schedule duplication on redeploy | BullMQ `jobId` dedup (`scheduler.ts`) | Idempotent |

**Launch-critical:**
1. **Worker process supervised** (PM2/systemd) — its absence silently stalls money + dispatch.
2. `support_phone` set in `AppConfig` — the no-rider escalation must page a human.
3. Razorpay **and** RazorpayX configured in prod (the guards refuse to fake either).
4. `Settlement.needsAttention` actively monitored — the only signal a seller won't get paid.
5. Redis + Postgres HA — both are hard dependencies for the live order flow.
6. Admin dispatch endpoint reachable — the only window into unassigned/stuck orders.
