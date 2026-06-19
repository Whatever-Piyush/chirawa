#!/usr/bin/env bash
# scripts/harness/negatives.sh — Phase 0A negative / rejection assertions (F2).
# Proves the harness FAILS-CLOSED: each call must be REJECTED (non-2xx) and cause
# no state change. A 2xx here marks FAIL (the control is broken). Read-only SQL.
# Requires lib.sh + 10_fixtures bootstrap (tokens + a fixture order).
# bash 3.2-safe.
set -euo pipefail
HERE="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# shellcheck source=lib.sh
. "$HERE/lib.sh"
# shellcheck source=10_fixtures.sh
. "$HERE/10_fixtures.sh"

HARNESS_FAILED=0
bootstrap_all

echo "── negative / permission assertions ─────────────────────────"

# A fresh confirmed COD order to act against.
OID="$( mk_order cod confirmed )"

# 1) Non-admin refund must be rejected (customer token on an admin-only endpoint).
auth CUST POST "/payments/refund/$OID" '{"reason":"x"}' >/dev/null
expect_status 403 "$( last_status )" "customer cannot call admin refund"

# 2) Non-admin manual assign must be rejected.
auth CUST POST "/delivery/orders/$OID/assign" '{}' >/dev/null
expect_status 403 "$( last_status )" "customer cannot call admin assign"

# 3) Non-seller accepting a seller order -> 403.
auth RIDER POST "/orders/$OID/accept" '{}' >/dev/null
expect_status 403 "$( last_status )" "non-seller cannot accept a seller order"

# 4) Rider completing a delivery not assigned to them -> 403 (not_your_delivery).
auth RIDER POST "/orders/$OID/delivered" '{}' >/dev/null
expect_status 403 "$( last_status )" "rider cannot complete an unassigned delivery"

# 5) Webhook signature enforcement — ONLY meaningful in sandbox (dev-mock skips it).
if [ "${HARNESS_MODE:-dev-mock}" = "sandbox" ]; then
  BAD='{"id":"'"$( gen_id evt )"'","event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_x","order_id":"order_x","method":"upi","amount":1,"status":"captured"}}}}'
  ST="$( "$H_CURL" -s -o /dev/null -w '%{http_code}' -X POST "$API/payments/webhook/razorpay" \
        -H 'content-type: application/json' -H 'x-razorpay-signature: deadbeef' -d "$BAD" )"
  expect_status 401 "$ST" "webhook with bad signature rejected"
else
  h_warn "skipping webhook-signature negative (HARNESS_MODE=dev-mock skips signature check)"
fi

echo "─────────────────────────────────────────────────────────────"
if [ "$HARNESS_FAILED" = "0" ]; then h_ok "all negative assertions passed"; exit 0
else h_abort "one or more negative assertions FAILED (a control accepted a call it should reject)"; fi
