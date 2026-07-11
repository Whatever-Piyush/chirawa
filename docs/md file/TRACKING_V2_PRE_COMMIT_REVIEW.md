# Tracking V2 — Pre-Commit Review (Sprint 1 + Sprint 2)

Review-only (no code changed). Covers the four requested areas + the "why hide the timeline
on delivered" question. **Verdict: safe to commit** — no correctness blockers. Findings are
low-severity edge cases or *known Phase-2 gaps* (delay handling, refund timeline). Two small
**optional** polish tweaks are called out; everything else is defer-to-Phase-2.

Severity: 🟡 Medium · ⚪ Low. (Nothing rises to High/Critical.)

---

## 1. `STATUS_STEP5` timeline mapping

```
pending_payment|paid|confirmed → 0 Confirmed   (ts: confirmedAt)
preparing|ready_for_pickup     → 1 Packing     (ts: preparingAt)
picked_up                      → 2 Picked up   (ts: pickedUpAt)
out_for_delivery               → 3 On the way  (ts: outForDeliveryAt)
delivered                      → 4 Delivered   (ts: deliveredAt)
cancelled → not mapped → idx 0 (handled by the cancelled branch)
```

**Assessment:** the 9→5 collapse is sound and matches the spec. Notes:

- **⚪ `ready_for_pickup` folds into "Packing" (phase 1), and `readyAt` is unused.** "Ready,
  awaiting rider" shows the same row as "Preparing", timestamped with `preparingAt` (packing
  *start*). Acceptable (there's no "Ready" display phase), but the `readyAt` column is never
  surfaced and ready looks identical to preparing in the timeline. The ETA hero still tightens
  at ready, so it's not misleading. *Defer.*
- **🟡 Cancelled orders show reached phases as "pending" (grey), not "done".** The done/active
  logic is guarded by `!isCancelled`, so for a cancelled order *no* phase is marked done —
  even "Confirmed", whose `confirmedAt` is set and whose timestamp renders. So a cancelled
  order reads "Confirmed —grey— 9:21 PM … ✕ Cancelled", which looks slightly off (the phase
  that happened isn't ticked). *Recommended tweak (optional, pre-commit): mark a phase done by
  **timestamp presence** (`!!ts`) rather than `i < idx`.* That single rule also fixes the next
  point and is robust to skipped phases.
- **⚪ "done by index" vs "timestamp present" can diverge on a skipped phase.** `codCollected`/
  `markDelivered` bypass `assertTransition` and can set `delivered` without an
  `out_for_delivery` stamp; then "On the way" would show done (index) with a "—" timestamp.
  **Not rendered today** because the timeline is hidden on delivered (§2), so this is latent
  only. The timestamp-presence rule above pre-empts it.

*Net: mapping is correct; the cancelled-branch "done" marking is the one worth a 1-line tweak.*

---

## 2. Why delivered orders hide the timeline

`{!isDelivered && <OrderTimeline … />}` — **intentional**, not a bug:

- **Delivered is a celebration + action state, not a progress state.** On delivery the screen
  leads with the `DeliveredBanner` + `RatingCard` (rate / reorder) — the customer's attention
  should be there, not on a now-redundant "all steps done" tracker. This mirrors Blinkit/Zepto
  (delivered = success + rate) and preserves the pre-V2 behaviour (the old stepper was hidden
  for `delivered`/`cancelled` too).
- **The timeline's job is in-flight reassurance** ("is it moving?"). Once complete, it carries
  no live value, so hiding it reduces clutter and keeps one focal point.
- **Cancelled is treated differently on purpose:** the timeline *does* render for cancelled
  (with the ✕ branch) because the customer needs to see *where it stopped* + the refund — a
  cancelled order isn't a "success", it needs explanation.

**Trade-off (acknowledged, not a blocker):** a delivered order loses the per-phase
*timestamps* in the UI (e.g., "delivered at 9:42"). If order-history detail ever wants those,
show a collapsed, read-only timeline there — a Phase-2 nicety, not needed for Sprint 2.

---

## 3. ETA Hero countdown edge cases

```
anchor = { ms: Date.now(), sec: eta.secondsRemaining }   // set on each eta change
liveSec = max(0, anchor.sec - (now - anchor.ms)/1000)     // ticks 1s
active → ~ceil(liveSec/60) min ; else → range from anchor.sec ± spread
```

- **🟡 Late orders stick at "~1 min".** When `liveSec` hits 0 (order past its ETA),
  `ceil(0/60)=0 → max(1,0)=1` ⇒ the hero shows **"Arriving in ~1 min" indefinitely**. This is
  the **known delay-handling gap** (delay engine is explicitly Phase 2 / out of Sprint-2
  scope). It's "confidently wrong" but bounded. *Recommended (optional): when `liveSec === 0`,
  switch copy to a neutral "Arriving soon / taking a little longer" client-side — a 1-line
  guard, no backend.* Otherwise defer to the Phase-2 delay state.
- **⚪ Anchor ignores network latency.** `anchor.sec` (server's remaining as of `serverNow`)
  is pinned to the client *receive* time, so the countdown trails reality by the push/poll
  latency (~100–500 ms). Negligible at minute granularity. *Defer.*
- **⚪ "by H:MM" depends on the device clock.** The relative countdown is skew-safe (deltas
  only), but the absolute "by 9:42 PM" uses `Date.now()` → wrong if the device clock is wrong.
  Most devices are fine. *Defer.*
- **⚪ Pre-pickup range doesn't tick between refreshes.** The range is recomputed from
  `anchor.sec` (static between pushes); it *does* refresh every 15 s (the poll's `getOrder`
  recomputes `secondsRemaining` fresh) + on `order:eta`. So it's never stale beyond ~15 s.
  Fine for a fuzzy range. *Defer.*
- **✓ Hooks/cleanup correct.** `useState/useRef/useEffect` run before the early return; the 1 s
  interval is cleaned on unmount; the component mounts/unmounts wholesale via the parent's
  `{!isDelivered && !isCancelled && …}` guard — no conditional-hook hazard.
- **✓ No negative values.** `etaResponse` clamps `secondsRemaining ≥ 0` server-side; `liveSec`
  clamps again.

*Net: only the late-order "~1 min" is worth flagging; it's the documented Phase-2 delay gap.*

---

## 4. Refund calculation edge cases

```
paymentRefund = Σ Payment.refundedPaise
lineRefund    = Σ items[fulfillmentStatus='unavailable_refunded'].refundedPaise
refundedPaise = max(paymentRefund, lineRefund)
refund        = >0 ? { amountPaise, destination: cod ? 'cash_adjustment' : 'original' } : undefined
```

Verified against `payments.service` (`refundCapturedOrderPayment`, `refundOrderLine`):

- **✓ `max()` is correct for every *real* flow** (not just "no double-count"):
  - Full prepaid cancel → `refundCapturedOrderPayment` sets `Payment.refundedPaise = totalAmount`,
    no OrderItem touched ⇒ `paymentRefund=total, lineRefund=0` → `total`.
  - Prepaid line OOS → `refundOrderLine` **increments** `Payment.refundedPaise` *and* the caller
    sets `OrderItem.refundedPaise` ⇒ both include the line → `max` counts it **once**.
  - COD line OOS → `refundOrderLine` returns null early (COD), Payment untouched, only
    `OrderItem.refundedPaise` set ⇒ `paymentRefund=0, lineRefund=line` → `line`.
  - The theoretical undercount (Payment-only refund on one line + OrderItem-only on another)
    **doesn't occur** — both move together per line. So `max` is sound. *(A first-class `Refund`
    model is the Phase-2 robustness upgrade, not a correctness fix.)*
- **✓ No cancel/refund timing gap.** `cancelOrder` calls `refundCapturedOrderPayment`
  **synchronously before** `updateOrderStatus('cancelled')`, and that helper records
  `Payment.refundedPaise` **even in dev-mock mode** (the Razorpay call is gated, the DB write
  isn't). So a cancelled prepaid order with a captured payment **always** has the refund
  recorded by the time it's `cancelled` → the card shows immediately. No webhook race.
- **⚪ The card requires a *captured* payment.** Both helpers no-op (return null, record
  nothing) when there's no `captured` Razorpay payment. So: cancelling *before* capture
  (`pending_payment → cancelled`) shows **no** refund card — which is **correct** (no money was
  taken). In dev, a prepaid order with no real captured payment also shows nothing; the Sprint-1
  runtime proof worked because it seeded a `payments` row with `refunded_paise`. *No action.*
- **⚪ COD "reduced from your cash total" assumes pre-collection.** Item-unavailable happens at
  pickup (before COD is collected), so the wording is right. A (rare) post-collection COD
  refund would read slightly off. *Defer.*
- **⚪ Full cancel refunds the *total* (incl. delivery fee).** `refundedPaise = totalAmount`, so
  the card shows the full ₹ incl. fee — correct for a full cancel. *No action.*

*Net: refund math is correct for all real flows; the only "absences" (pre-capture cancel,
COD wording) are correct or trivial.*

---

## Recommendation

**Commit Sprint 1 + Sprint 2 as-is** — no correctness blockers; all findings are 🟡/⚪ and
either known Phase-2 gaps or correct-by-design.

Two **optional** 1-line polish tweaks you *could* fold in before committing (or defer):
1. **Timeline (§1):** mark a phase done by **`!!timestamp`** instead of `i < idx` — fixes the
   cancelled-branch grey "Confirmed" and the skipped-phase case in one rule.
2. **ETA hero (§3):** when `liveSec === 0`, show "Arriving soon" instead of a stuck "~1 min"
   (a stopgap until the Phase-2 delay engine).

Everything else (delay engine, refund timeline/model, `readyAt` surfacing, route/marker
polish, masking, group ETA) stays correctly out of scope. *No code changed by this review.*
