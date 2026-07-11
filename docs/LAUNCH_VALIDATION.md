# Launch Validation — Signed End-to-End Checklist (Phase 7)

**Result: 26/26 validations passed.** Every journey below was executed against
the compiled production artifacts (`dist/` API + worker) on real PostgreSQL 15 +
Redis 7 through the real HTTP/WebSocket APIs — no mocks, no assumptions. Each
row is reproducible (§4) and backed by the committed evidence file.

| | |
|---|---|
| Evidence | [`docs/validation/smoke-2026-07-03.json`](validation/smoke-2026-07-03.json) |
| Evidence SHA-256 | `750b1ffc95f07b3b94a03b91582a83f62733745c5dc9e829033c5534e9e26fa7` |
| Run / suite | `2026-07-02T21-50-53` / `scripts/smoke/run.mjs` at repo state `d829c4f`+Phase 7 |
| Environment | dev host (see §5 for what production must re-prove) |

## 1. Validation matrix

### Customer

| Spec item | ID | Proven |
|---|---|---|
| Login | C1 | verify-otp mints access+refresh; refresh **rotates** (old token unusable path unit-pinned) |
| OTP | C1 | send-otp issues with expiry; wrong code rejected; **per-phone abuse cap engages** (422 after repeated sends) |
| Browse | C2 | feed, categories, product detail populated with real catalog data |
| Search | C3 | Hinglish term returns ranked results; nonsense query degrades to empty, not error |
| Cart | C4 | add + quantity update; line subtotal = price×qty; cart subtotal consistent |
| Checkout | C5 | pricing preview equation holds exactly: total = subtotal + fee − discount (integer paise) |
| COD | C6 | placement → `confirmed`, cart cleared, order retrievable, seller notified live (socket `order:new`) |
| Online payment | C7 + C8 | **launch config (flag off): upi placement AND payment-order creation rejected 422** — the COD-only decision holds at the API boundary; with flag on, the full flow works against the dev-mock gateway: pending_payment → verify → paid/confirmed with a captured payment row |
| Cancel | C9 + S2 | customer cancel and seller reject both → `cancelled`, counterparty notified via socket |
| Refund | C10 | prepaid cancel → payment `captured→refunded`, `refundedPaise` = order total, atomically claimed |

### Seller

| Spec item | ID | Proven |
|---|---|---|
| Accept | S1 | `sellerAcceptedAt` recorded, order stays fulfillable |
| Reject | S2 | fresh order → `cancelled` + customer socket event |
| Prepare | S3 | `confirmed → preparing`, customer sees the transition live |
| Complete | S4 | `preparing → ready_for_pickup` |

### Rider

| Spec item | ID | Proven |
|---|---|---|
| Assignment | R1 | dispatch → batch → worker → `DeliveryAssignment` (active), rider socket `order:assigned`, `/delivery/active` agrees |
| Pickup | R2 | `ready_for_pickup → picked_up → out_for_delivery` via rider endpoints |
| Delivery | R3 | COD collect → `delivered`; server **ignores client amount** (sent a wrong 999 on purpose); `codCollectedPaise` = total; rider COD ledger credited exactly once |
| Navigation | R4 | rider socket `rider:location` relayed to customer as `order:location` (authz-gated room) + REST rider-location endpoint |

### Admin

| Spec item | ID | Proven |
|---|---|---|
| Dashboard | A1 | `/admin/` + `/admin/dispatch` live-ops respond with data; **non-admin gets 403** |
| Notifications | A4 | in-app notification rows persisted for the whole lifecycle; FCM dispatch fired for every event (this dev env has real Firebase creds — sends failed cleanly on the fake smoke token **without breaking order flow**, itself a validated failure mode) |
| Reports | A3 | `/admin/metrics`, `/admin/coverage`, seller sales-summary + settlements |

### System verification

| Spec item | ID | Proven |
|---|---|---|
| Notifications | A4, C6, S3 | persisted + push-dispatched + real-time socket events across all three roles |
| Payments | C8, C10, V2 | capture + refund paths; **forged webhook rejected with zero side effects** (no payment row created) |
| Retries | V3 | poisoned settlement job genuinely retried to exhaustion: `attemptsMade=5` (policy read from the artifact, not assumed), failure retained per 7-day policy |
| Logging | V4 | every stdout line across API+worker parses as JSON with correlation fields (`svc`/`reqId`/`jobName`) |
| Monitoring | V5 | `/health` + `/ready` (DB+Redis) green; **worker heartbeat pings observed** on a live listener |
| Database integrity | V6 | 7 SQL invariants, 0 violations: order money equation, no negative money, delivered⇒history row, COD delivered⇒collected=total, captured⇒payment id present, refunds ≤ captured, ≤1 active assignment/order |

## 2. Fixed during validation (the suite earned its keep)

1. `shared/observability/logger.ts` didn't honor `LOG_LEVEL`/`LOG_PRETTY` — service
   logs stayed pretty (non-JSON) where Fastify's went JSON. Fixed; V4 now pins both.
2. Suite hardening that documents real behavior: per-phone OTP caps engage across
   runs (now asserted, not worked around); a running dev API on the same Redis
   steals exactly-once event claims — the suite now **refuses to start** next to
   foreign event-bus subscribers instead of flaking.

## 3. What this run deliberately could not prove

Real-world edges owned by the production environment: actual SMS delivery
(Fast2SMS credits/DLT), push to a physical device (real FCM token), TLS/nginx
at `api.chirawa.in`, PM2 cluster behavior, real Razorpay webhooks. See §5.

## 4. Reproduce (any machine, ~4 minutes)

```bash
docker compose up -d                      # PG + Redis
pnpm --filter @chirawa/api db:seed       # needs seeded catalog + riders
pnpm --filter @chirawa/api build
node scripts/smoke/run.mjs               # exits 0 only on 26/26
```

Notes: refuses to run if any other process is subscribed to the event bus
(stop `pnpm dev:api` first); creates real orders in the dev DB (re-seed to
clean); the retry validation alone takes ~75 s by design (5 real attempts,
exponential backoff).

## 5. Production sign-off gate — run AFTER merge + server config

The same suite validates production the same way, plus the physical-world items
it can't reach. In order:

- [ ] `PRODUCTION_READINESS_CHECKLIST.md` boxes closed (env, keys, monitors, logrotate)
- [ ] Deploy green; `curl https://api.chirawa.in/health` + `/ready` from outside
- [ ] Real OTP received on a real phone (Fast2SMS path, not dev bypass)
- [ ] Real push on a physical Android device (registered token, order status change)
- [ ] One real COD order end-to-end on production hardware (place → accept →
      prepare → ready → assign → pickup → deliver → COD collect), verified in
      `/admin/dispatch` and the structured logs
- [ ] Worker heartbeat monitor shows pings; kill the worker once → alert fires
      (RUNBOOK §2 drill)
- [ ] Backup restore verification drill run this month (DISASTER_RECOVERY §3a)

## 6. Sign-off

| Role | Verdict | Evidence | Date |
|---|---|---|---|
| Automated validation (this suite) | **26/26 PASS** | `smoke-2026-07-03.json`, sha256 `750b1ffc…e26fa7` | 2026-07-03 |
| Engineering review | ________________ | | |
| Founder / launch owner | ________________ | | |

*The two human rows are signed after §5's production gate is complete — the
automated row alone certifies the codebase, not the deployed environment.*
