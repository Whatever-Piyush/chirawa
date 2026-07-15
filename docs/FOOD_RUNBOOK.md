# Food Operations Runbook — Bringly Food

The food-specific companion to [RUNBOOK.md](RUNBOOK.md) (open that first for
topology, health checks, restarts, and marketplace payments). Everything here
is about the **Food Delivery module**: its own pipeline (`food_orders`), its
own money-safety sweep, and its own restaurant/rider surfaces.

**Mental model for every food incident:** the `food-reconcile` sweep (runs in
the API process every ~2 min; log tag `food-reconcile`) is the safety net. It
(1) rescues captured payments stuck at `pending_payment`, (2) expires abandoned
unpaid orders after 30 min, (3) cancels + refunds paid orders no restaurant
accepted within 15 min, (4) retries failed refunds, (5) refunds late captures
on already-cancelled orders. Timings are config: `AppConfig` key `food.config`
→ `ops.*`. If a food order looks wedged, your first question is always: *has
the sweep seen it yet?* (`grep 'food reconcile' /var/log/chirawa/api-out.log`).

Useful queries (psql, all read-only):

```sql
-- Live food orders and their ages
SELECT id, status, refund_status, total_paise/100 AS rs,
       now() - created_at AS age
FROM food_orders
WHERE status NOT IN ('delivered','cancelled')
ORDER BY created_at;

-- Refunds needing eyes (same data as GET /api/v1/food/admin/refunds)
SELECT id, total_paise/100 AS rs, refund_status, cancel_reason, cancelled_at
FROM food_orders
WHERE refund_status IN ('failed','pending')
ORDER BY updated_at;
```

---

## F1. Payment captured but order not confirmed

**Symptoms:** customer says money left their UPI app; order shows "Awaiting
payment" (`pending_payment`) or customer never saw a confirmation.
**Root cause:** the app's verify-payment call never arrived (crash, network
drop) — UPI captures asynchronously.
**Immediate response:** nothing, for 5 minutes. The sweep checks Razorpay for
every `pending_payment` order older than 3 min and flips captured ones to
`paid` automatically (log: `🛟 food reconcile: rescued captured payment`).
**Escalation:** if the order is still `pending_payment` after ~10 min, the
sweep itself may be down: check `grep 'food reconcile' api-out.log` for recent
ticks; check `/ready`; check `PAYMENTS_ONLINE_ENABLED=true` and real Razorpay
keys (the sweep no-ops without them — that's the most common cause).
**Resolution:** restart the API (`pm2 restart chirawa-api`) → the sweep runs a
boot pass within 15 s.
**Verification:** order row flips to `paid`, restaurant gets the push, customer
tracking shows "Order placed".

## F2. Restaurant never accepts

**Symptoms:** order sits at `paid`; customer tracking stuck on "Order placed".
**Root cause:** restaurant phone offline / app closed / staff missed the push.
**Immediate response:** call the restaurant (numbers in the onboarding sheet).
They can accept from the Seller app's 🍽️ Restaurant tab (it polls every 15 s).
**Escalation:** none needed — at **15 min** (config `ops.acceptTimeoutMinutes`)
the sweep auto-cancels and auto-refunds (`⏱️ food reconcile: accept timeout`),
and the customer is notified with the refund message.
**Resolution:** if this recurs for one restaurant, flip them closed (their
open/close switch, or `UPDATE restaurants SET is_open=false WHERE id=…`) until
they're reliable.
**Verification:** order `cancelled`, `refund_status='processed'`,
`refunded_paise = total_paise`.

## F3. Restaurant closes unexpectedly (mid-day)

**Symptoms:** restaurant calls "we're closed today" / orders keep arriving.
**Immediate response:** the restaurant flips its own switch: Seller app →
Restaurant tab → top-right toggle (`बंद है`). Instantly removes ordering
(catalog shows Closed; checkout blocks).
**Support fallback:** `PATCH /api/v1/food/restaurant/open` as them, or
`UPDATE restaurants SET is_open=false WHERE name='…';` — takes effect on the
next catalog read.
**In-flight orders:** restaurant must still fulfil or reject accepted orders;
anything at `paid` they reject (auto-refund) or the 15-min timeout handles it.
**Verification:** `GET /api/v1/food/restaurants` shows `isCurrentlyOpen:false`.

## F4. Restaurant marks item unavailable / item sold out

**Symptoms:** "we're out of paneer" mid-service.
**Immediate response:** self-serve — Seller app → Restaurant tab → **मेनू** →
toggle the item off. It disappears from the customer menu immediately (already
placed orders are unaffected; the restaurant fulfils or rejects those).
**Support fallback:** `PATCH /api/v1/food/restaurant/menu/:itemId`
`{"isAvailable":false}` or `UPDATE menu_items SET is_available=false WHERE id=…`.
**Note:** carted-but-unordered items re-price/validate at checkout — an
unavailable item blocks order placement with a clear message; the customer
removes it and proceeds.

## F5. Rider never arrives

**Symptoms:** order stuck at `ready_for_pickup`; restaurant calls "food is
getting cold".
**Root cause:** no rider claimed it (all busy/offline), or the claimer stalled.
**Immediate response:** check who owns it:
`SELECT rider_id FROM food_orders WHERE id='…';`
- `rider_id IS NULL` → no claim yet: ping riders directly (the Food tab in the
  rider app lists it for every rider; it polls every 15 s).
- claimed but idle → call that rider; if unreachable, free the order:
  `UPDATE food_orders SET rider_id=NULL WHERE id='…' AND status='ready_for_pickup';`
  — it reappears in every rider's available list.
**Escalation:** if cold/undeliverable, cancel + refund manually: reject is no
longer legal at this status, so run the refund path by hand — set
`status='cancelled'`, then confirm the sweep's refund retry picks it up, or use
Razorpay dashboard for an immediate manual refund and mark
`refund_status='processed'`, `refunded_paise=total_paise`.
**Verification:** order reaches `delivered`, or `cancelled` with
`refund_status='processed'`.

## F6. Refund fails

**Symptoms:** admin endpoint `GET /api/v1/food/admin/refunds` (or the SQL
above) lists rows with `refund_status='failed'`; log line
`💸 Food refund FAILED`.
**Root cause:** Razorpay API error/outage at refund time.
**Immediate response:** nothing — the sweep retries every cycle and first asks
Razorpay which refunds already exist (it can never double-refund). Most rows
converge on their own (`💸 food reconcile: refund retry succeeded`).
**Escalation:** stuck > 1 hour → refund manually in the Razorpay dashboard
(payment id is `razorpay_payment_id` on the row), then:
`UPDATE food_orders SET refund_status='processed', refunded_paise=total_paise WHERE id='…';`
**Verification:** admin refunds list is empty; customer confirms credit (UPI
refunds take 5–7 days to land — set that expectation).

## F7. Customer requests cancellation

**Symptoms:** support call/message: "cancel my order".
**Rules:** self-serve in-app while `pending_payment` or `paid` (auto-refund).
From `confirmed` onward the kitchen is cooking — cancellation is a business
decision, not a button.
**Immediate response:** ask them to use the Cancel button on tracking. If the
restaurant hasn't accepted, that's it (refund auto-initiates).
**Escalation (already confirmed/preparing):** call the restaurant; if they
agree to stop, they reject from the app **only works pre-preparing** — from
`preparing` onward do it manually: `status='cancelled'`, then the refund per F6
escalation. Goodwill refunds after `preparing` come out of Bringly's margin —
founder's call, log it.
**Verification:** `cancelled` + `refund_status='processed'`.

## F8. Customer reports incorrect order

**Symptoms:** "wrong item / item missing" after delivery.
**Root cause:** kitchen packing error (Bringly's rider only carries the sealed
order).
**Immediate response:** get a photo; check the order's `food_order_items`
snapshot (name/qty/price at order time is immutable evidence).
**Resolution:** pilot policy — partial goodwill refund via Razorpay dashboard
(partial amount against `razorpay_payment_id`), then record it:
`UPDATE food_orders SET refunded_paise = refunded_paise + <paise> WHERE id='…';`
(leave `refund_status='processed'` semantics to full refunds; partial history
lives in Razorpay). Debit the restaurant in the weekly settlement sheet.
**Verification:** customer confirms; restaurant informed same day.

## F9. Push notifications fail

**Symptoms:** restaurants say "orders arrive but no sound/notification";
customers miss milestone pushes.
**Root cause candidates (in order):** device token missing (user never granted
permission / app reinstall) → `redis-cli GET fcm:token:<userId>` empty; FCM
credentials (`firebase-admin` init) broken; FCM outage.
**Immediate response:** nothing breaks functionally — Restaurant Mode polls
every 15 s and customer tracking polls every 10 s. Push is acceleration, not
the source of truth.
**Resolution:** token empty → have the user reopen the app (registration runs
on launch) and check notification permission. Broader failure → check api
error log for `food push failed` / FCM errors and verify the Firebase service
account envs per DEPLOYMENT.md.
**Verification:** `redis-cli GET fcm:token:<userId>` non-empty; a test order's
push arrives.

## F10. Webhook stops working

**Food is deliberately NOT webhook-dependent.** Payment truth for food orders
comes from the client verify call plus the pull-based reconcile sweep that
queries Razorpay directly — a dead webhook cannot lose food money.
**But:** the **marketplace** online-payment path does consume the Razorpay
webhook. If webhook delivery breaks (Razorpay dashboard shows failures):
follow RUNBOOK.md §5 (payments operations); food needs no action.
**Verification (food):** sweep ticks present in logs; stuck-order rescue works
end-to-end (F1).

---

## Daily food ops (add to RUNBOOK.md §8 calendar)

| When | What | How |
|---|---|---|
| Morning | Refund queue empty? | `GET /food/admin/refunds` → expect `[]` |
| Morning | Restaurants open as expected? | `GET /food/restaurants` → `isCurrentlyOpen` |
| Evening | Any order stuck non-terminal > 2 h? | first SQL query above |
| Weekly | Restaurant settlement sheet (manual for pilot) | `SELECT restaurant_id, sum(items_subtotal_paise) FROM food_orders WHERE status='delivered' AND delivered_at > now()-interval '7 days' GROUP BY 1;` |
| Weekly | Rider food-delivery count (manual payout, pilot) | `SELECT rider_id, count(*) FROM food_orders WHERE status='delivered' AND delivered_at > now()-interval '7 days' GROUP BY 1;` |
