#!/usr/bin/env bash
# scripts/harness/99_cleanup.sh — ordered, harness-scoped, FK-safe teardown (F7).
# The ONLY harness script that issues direct DELETE/UPDATE (see PHASE0A_RISK_SURFACE).
# Re-asserts the isolation guard before any delete, so it cannot run on the wrong DB.
# bash 3.2-safe.
set -euo pipefail
HERE="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

# Re-run the full isolation guard (network layers included) before deleting anything.
"$HERE/00_preflight.sh" >/dev/null || h_abort "isolation guard failed — refusing to clean up."
h_ok "isolation guard re-confirmed for cleanup"

# Harness customer phones: 9000000001 (kept user, orders cleared) + 002/004 (deleted).
HARNESS_KEEP_PHONE="${HARNESS_CUST_PHONE:-9000000001}"
HARNESS_DROP_PHONES="${HARNESS_DROP_PHONES:-9000000002 9000000004}"

# Build a comma-quoted SQL IN-list from space-separated phones.
in_list() { local p out=""; for p in $1; do out="$out,'$p'"; done; printf '%s' "${out#,}"; }
ALL_PHONES="$HARNESS_KEEP_PHONE $HARNESS_DROP_PHONES"
ALL_IN="$( in_list "$ALL_PHONES" )"
DROP_IN="$( in_list "$HARNESS_DROP_PHONES" )"

# Customer-id scope (all harness customers) used by the order child-deletes.
CIDS="select id from users where phone in ($ALL_IN)"
OIDS="select id from orders where customer_id in ($CIDS)"

h_info "scoping cleanup to harness customers: $ALL_PHONES"

# ── Ordered child -> parent deletes (every statement WHERE-scoped) ────────────
hsql "delete from order_status_history where order_id in ($OIDS);"           >/dev/null
hsql "delete from order_items          where order_id in ($OIDS);"           >/dev/null
hsql "delete from payments             where order_id in ($OIDS);"           >/dev/null
hsql "delete from delivery_assignments where order_id in ($OIDS);"           >/dev/null
hsql "delete from promo_redemptions    where user_id in ($CIDS);"            >/dev/null
hsql "delete from transactions         where reference_type='order' and reference_id in ($OIDS);" >/dev/null
hsql "delete from orders               where customer_id in ($CIDS);"        >/dev/null
hsql "delete from order_groups         where customer_id in ($CIDS);"        >/dev/null
# Empty batches left behind (disposable DB => all batches are harness-owned).
hsql "delete from batches where id not in (select batch_id from orders where batch_id is not null);" >/dev/null
# Harness-tagged payment webhook events + referral redemptions for dropped users.
hsql "delete from payment_webhook_events where event_id like 'evt_TEST%' or event_id like 'evt_HARNESS%';" >/dev/null
hsql "delete from referral_redemptions where referred_user_id in (select id from users where phone in ($DROP_IN));" >/dev/null
hsql "delete from addresses where user_id in ($CIDS);"                       >/dev/null
# Drop the throwaway users (cascades customer_profiles/referral_codes/refresh_tokens). Keep 9000000001.
hsql "delete from users where phone in ($DROP_IN);"                          >/dev/null

# ── Reset rider COD float (UPDATE) ────────────────────────────────────────────
hsql "update rider_profiles set cod_balance_paise=${HARNESS_RIDER_BASELINE:-0} where id in (select rp.id from rider_profiles rp join users u on u.id=rp.user_id where u.role='rider');" >/dev/null

# ── Redis: harness-scoped key deletes only (NO flush, NO blanket bull:*) ──────
del_keys() { local pat k; pat="$1"; while IFS= read -r k; do [ -n "$k" ] && hredis del "$k" >/dev/null 2>&1; done < <( hredis --scan --pattern "$pat" 2>/dev/null || true ); }
del_keys "cart:*"
del_keys "fcm:token:*"
del_keys "rider:*"
del_keys "otp:*:90000000*"
# Rider availability back to offline (app-mediated; only if a rider token is around).
[ -n "${RIDER_AT:-}" ] && [ -n "${RIDER_RT:-}" ] && auth RIDER_AT RIDER_RT PATCH /delivery/availability '{"status":"offline"}' >/dev/null 2>&1 || true

h_ok "cleanup complete (harness-scoped)"
