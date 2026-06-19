# scripts/harness/10_fixtures.sh — Phase 0A fixtures (F6: fresh, status-pinned
# per-block orders so no shared $OID). SOURCED after lib.sh + a passing preflight.
# Direct SQL = READ-ONLY (discovery). All writes are app-mediated via legal API
# transitions only (no direct status pokes/backdating — see PHASE0A_RISK_SURFACE).
# NOTE (scope): FCM-token registration (F10), multi-shop carts (F20), fixture
# guards (F18) and single-shop promo pin (F22) are Phase 0B — NOT implemented here.
# shellcheck shell=bash

HARNESS_CUST_PHONE="${HARNESS_CUST_PHONE:-9000000001}"

# ── Discover seeded ids (READ-ONLY) ───────────────────────────────────────────
discover_fixtures() {
  PROD_ID="$( hsql "select id from products where is_active and stock_status='available' limit 1" )"
  SHOP_ID="$( hsql "select shop_id from products where id='$PROD_ID'" )"
  SELLER_PHONE="${SELLER_PHONE:-$( hsql "select phone from users where role='seller' limit 1" )}"
  RIDER_PHONE="${RIDER_PHONE:-$( hsql "select phone from users where role='rider' limit 1" )}"
  ADMIN_PHONE="${ADMIN_PHONE:-$( hsql "select phone from users where role='admin' limit 1" )}"
  [ -n "$PROD_ID" ] || h_abort "discover_fixtures: no in-stock product found (seed the catalog first)."
  h_info "fixtures: product=$PROD_ID shop=$SHOP_ID seller=$SELLER_PHONE rider=$RIDER_PHONE admin=$ADMIN_PHONE"
}

# ── Log in the four actors; tokens land in the durable store (login_as) ───────
bootstrap_accounts() {
  login_as CUST   "$HARNESS_CUST_PHONE"
  login_as SELLER "$SELLER_PHONE"
  login_as RIDER  "$RIDER_PHONE"
  login_as ADMIN  "$ADMIN_PHONE"
  CUST_UID="$( hsql "select id from users where phone='$HARNESS_CUST_PHONE'" )"
  RIDER_PID="$( hsql "select rp.id from rider_profiles rp join users u on u.id=rp.user_id where u.phone='$RIDER_PHONE'" )"
  h_ok "logged in customer/seller/rider/admin (cust uid=$CUST_UID)"
}

# ── Customer address (app-mediated) ──────────────────────────────────────────
mk_address() {
  ADDR_ID="$( auth CUST POST /users/me/addresses \
    '{"street":"Harness 1","landmark":"Near temple","locality":"Bazaar","city":"Chirawa","pincode":"333026","lat":28.2403,"lng":75.6466,"contactType":"myself"}' \
    | jq -r '.id // empty' )"
  [ -n "$ADDR_ID" ] || h_abort "mk_address failed (status=$( last_status ))"
  h_info "address=$ADDR_ID"
}

cart_reset() { auth CUST DELETE /cart >/dev/null 2>&1 || true; }
cart_add()   { auth CUST POST /cart/items "{\"productId\":\"${1:-$PROD_ID}\",\"quantity\":${2:-1}}" >/dev/null; }

# ── Transition helpers (legal API transitions only) ───────────────────────────
pay_order() { # $1=OID — create + (dev-mock/sandbox) verify; unique paymentId (F14)
  local oid="$1" p rzo pid
  p="$( auth CUST POST "/payments/orders/$oid" '{}' )"
  rzo="$( printf '%s' "$p" | jq -r '.razorpayOrderId // empty' )"
  [ -n "$rzo" ] || h_abort "pay_order($oid): no razorpayOrderId: $p"
  pid="$( gen_id pay )"
  auth CUST POST "/payments/verify/$oid" \
    "{\"razorpayOrderId\":\"$rzo\",\"razorpayPaymentId\":\"$pid\",\"razorpaySignature\":\"${HARNESS_SIG:-sig}\"}" >/dev/null
}
seller_accept()  { auth SELLER POST "/orders/$1/accept"    '{}' >/dev/null; }
seller_prepare() { auth SELLER POST "/orders/$1/preparing" '{}' >/dev/null; }
seller_ready()   { auth SELLER POST "/orders/$1/ready"     '{}' >/dev/null; }
admin_assign()   { auth ADMIN  POST "/delivery/orders/$1/assign" '{}' >/dev/null; }
rider_pickup()   { auth RIDER  POST "/delivery/orders/$1/pickup"  '{}' >/dev/null; }
rider_start()    { auth RIDER  POST "/delivery/orders/$1/start-delivery" '{}' >/dev/null; }
rider_online()   { auth RIDER  PATCH /delivery/availability '{"status":"online","lat":28.2403,"lng":75.6466}' >/dev/null; }

# ── mk_order METHOD [PIN] — returns a FRESH order id pinned to a known status ──
#   METHOD = cod | upi ;  PIN = created | paid | confirmed (default: created)
#   Echoes the order id. Each block calls this for its OWN fixture (no shared OID).
mk_order() {
  local method="${1:-cod}" pin="${2:-created}" oid cid
  cart_reset; cart_add "$PROD_ID" 1
  # placeOrderSchema requires cartId (uuid) alongside addressId+paymentMethod (H-1 fix).
  cid="$( auth CUST GET /cart | jq -r '.cartId // empty' )"
  [ -n "$cid" ] || h_abort "mk_order($method,$pin): cart empty / no cartId (status=$( last_status ))"
  oid="$( auth CUST POST /orders "{\"cartId\":\"$cid\",\"addressId\":\"$ADDR_ID\",\"paymentMethod\":\"$method\"}" | jq -r '.orderId // empty' )"
  [ -n "$oid" ] || h_abort "mk_order($method,$pin): order not created (status=$( last_status ))"
  case "$pin" in
    created) : ;;                                   # cod=>confirmed, upi=>pending_payment
    paid)      [ "$method" = "upi" ] && pay_order "$oid" ;;
    confirmed)
      if [ "$method" = "upi" ]; then pay_order "$oid"; seller_accept "$oid"; else seller_accept "$oid"; fi ;;
    *) h_abort "mk_order: unknown pin '$pin'";;
  esac
  printf '%s' "$oid"
}

bootstrap_all() { discover_fixtures; bootstrap_accounts; mk_address; }
