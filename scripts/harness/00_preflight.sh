#!/usr/bin/env bash
# scripts/harness/00_preflight.sh — isolation guard + run preconditions.
# Findings: F8 (env isolation), F5 (operating-hours), F3 (OTP rate clear), and a
# correct /health|/ready check. Default run is READ-ONLY; only `--init` writes
# (the one branding marker — see PHASE0A_RISK_SURFACE.md).
# bash 3.2-safe.
set -euo pipefail
HERE="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

MARKER_KEY='__harness_marker__'

# ── Isolation guard (allowlist, fail-closed, defence-in-depth) ────────────────
guard() {
  echo "── isolation guard ──────────────────────────────────────────"
  # L0 — explicit opt-in (missing => abort)
  [ "${HARNESS_DB:-}" = "1" ] || h_abort "HARNESS_DB=1 not set — refuse to run without an explicit harness opt-in."
  h_ok "HARNESS_DB=1 (explicit opt-in)"
  # L1 — NODE_ENV must be a known non-production env
  case "${NODE_ENV:-unset}" in
    development|test) h_ok "NODE_ENV='${NODE_ENV}' (non-production)";;
    *) h_abort "NODE_ENV='${NODE_ENV:-unset}' — must be 'development' or 'test', never 'production'/unset.";;
  esac
  : "${DATABASE_URL:?DATABASE_URL not set}"; : "${REDIS_URL:?REDIS_URL not set}"
  local dbh rh; dbh="$( url_host "$DATABASE_URL" )"; rh="$( url_host "$REDIS_URL" )"
  # L2 — host allowlist (loopback / explicitly-allowed test hosts only)
  local allow=" ${HARNESS_ALLOW_HOSTS:-localhost 127.0.0.1 ::1 chirawa_postgres chirawa_redis} "
  case "$allow" in *" $dbh "*) :;; *) h_abort "DATABASE_URL host '$dbh' not in HARNESS_ALLOW_HOSTS — refuse remote/shared DB.";; esac
  case "$allow" in *" $rh "*) :;;  *) h_abort "REDIS_URL host '$rh' not in HARNESS_ALLOW_HOSTS — refuse remote/shared Redis.";; esac
  h_ok "hosts loopback/allowed (db='$dbh' redis='$rh')"
  # L3 — production-token denylist
  if printf '%s\n%s' "$DATABASE_URL" "$REDIS_URL" | grep -Eiq 'prod|production|live'; then
    h_abort "DATABASE_URL/REDIS_URL contains a production token (prod|production|live)."
  fi
  h_ok "no production token in connection strings"

  if [ "${HARNESS_PREFLIGHT_NET:-1}" != "1" ]; then
    h_warn "HARNESS_PREFLIGHT_NET=0 — skipping DB/Redis identity layers (logic-only mode)"
    return 0
  fi
  # L4 — DB identity (name denylist + allowlist)
  local dbn; dbn="$( hsql 'select current_database()' )" || h_abort "cannot reach DATABASE_URL."
  case "$dbn" in *prod*|*production*|*live*) h_abort "current_database()='$dbn' looks like production.";; esac
  local namesok=" ${HARNESS_DB_NAMES:-chirawa_harness chirawa_development chirawa_test} "
  case "$namesok" in *" $dbn "*) h_ok "current_database()='$dbn' in allowlist";; *) h_abort "current_database()='$dbn' not in HARNESS_DB_NAMES.";; esac
  # L5 — positive harness marker (branding)
  local dbmark; dbmark="$( hsql "select value from app_config where key='$MARKER_KEY'" 2>/dev/null || true )"
  [ -n "$dbmark" ] || h_abort "no app_config('$MARKER_KEY') — DB not branded disposable. Run: $0 --init (on a throwaway DB only)."
  h_ok "DB harness marker present ($dbmark)"
  # L6 — row-count ceiling
  local maxo orders; maxo="${HARNESS_MAX_ORDERS:-500}"; orders="$( hsql 'select count(*) from orders' )"
  [ "$orders" -le "$maxo" ] || h_abort "orders has $orders rows (> $maxo) — refuse a populated/shared DB."
  h_ok "orders rows $orders ≤ $maxo"
  # L7 — Redis identity (marker + DBSIZE ceiling)
  hredis ping >/dev/null 2>&1 || h_abort "cannot reach REDIS_URL."
  local rmark; rmark="$( hredis get "$MARKER_KEY" 2>/dev/null || true )"
  { [ -n "$rmark" ] && [ "$rmark" != "nil" ]; } || h_abort "no Redis key '$MARKER_KEY' — Redis not branded disposable."
  local maxk dbsize; maxk="${HARNESS_MAX_KEYS:-5000}"; dbsize="$( hredis dbsize )"
  [ "$dbsize" -le "$maxk" ] || h_abort "Redis DBSIZE=$dbsize (> $maxk) — looks shared/populated."
  h_ok "Redis branded ($rmark), DBSIZE $dbsize ≤ $maxk"
}

# ── Operating-hours guard (F5): app rejects orders outside 9 AM–8 PM IST ──────
hours_guard() {
  local h um
  if [ -n "${HARNESS_NOW_IST_HOUR:-}" ]; then
    h="$HARNESS_NOW_IST_HOUR"
  else
    um=$(( 10#$( date -u +%H ) * 60 + 10#$( date -u +%M ) ))   # UTC minutes
    h=$(( ( ( um + 330 ) % 1440 ) / 60 ))                       # +5:30 -> IST hour
  fi
  if [ "$h" -lt 9 ] || [ "$h" -ge 20 ]; then
    h_abort "IST hour ${h} is outside the 09–20 delivery window — orders would be rejected (SHOP_CLOSED)."
  fi
  h_ok "IST hour ${h} within 09–20 window"
}

# ── OTP rate/lockout clear (F3): only after guard passes; harness Redis only ──
clear_otp_limits() {
  local k n=0
  for pat in 'otp:rate:*' 'otp:lockout:*'; do
    while IFS= read -r k; do
      [ -n "$k" ] && hredis del "$k" >/dev/null 2>&1 && n=$(( n + 1 ))
    done < <( hredis --scan --pattern "$pat" 2>/dev/null || true )
  done
  h_ok "cleared $n otp rate/lockout key(s)"
}

# ── Liveness (correct root URL — not under /api/v1) ───────────────────────────
health_check() {
  local root code
  root="${API%/api/v1}"
  code="$( "$H_CURL" -s -o /dev/null -w '%{http_code}' "$root/health" || echo 000 )"
  [ "$code" = "200" ] || h_abort "GET $root/health returned $code (API not up?)"
  code="$( "$H_CURL" -s -o /dev/null -w '%{http_code}' "$root/ready" || echo 000 )"
  [ "$code" = "200" ] || h_warn "GET $root/ready returned $code (DB/Redis not ready?)"
  h_ok "health/ready reachable"
}

# ── Mode assertion (F1/F8): money blocks only gate in sandbox ─────────────────
mode_assert() {
  if [ "${HARNESS_MODE:-dev-mock}" = "sandbox" ]; then
    local v
    for v in RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET RAZORPAY_WEBHOOK_SECRET RAZORPAYX_ACCOUNT_NUMBER; do
      case "${!v:-placeholder}" in *placeholder*|*REPLACE*) h_abort "HARNESS_MODE=sandbox but $v is still a placeholder — money blocks would be NON-GATING.";; esac
    done
    h_ok "sandbox mode: Razorpay/RazorpayX creds non-placeholder (money blocks GATING)"
  else
    h_warn "HARNESS_MODE=dev-mock — money blocks (A10,E3,A13,B2-reject,C6,D7,E4) are NON-GATING (signatures/refunds/payouts bypassed)"
  fi
}

# ── One-time branding of a THROWAWAY DB+Redis (the only write 00_preflight does)
brand_init() {
  HARNESS_PREFLIGHT_NET=0 guard               # L0–L3 (opt-in/env/host/denylist)
  local dbn orders stamp
  dbn="$( hsql 'select current_database()' )" || h_abort "cannot reach DATABASE_URL."
  case "$dbn" in *prod*|*production*|*live*) h_abort "refuse to brand '$dbn' (looks production).";; esac
  orders="$( hsql 'select count(*) from orders' )"
  [ "$orders" -le "${HARNESS_MAX_ORDERS:-500}" ] || h_abort "refuse to brand: orders has $orders rows (> ceiling)."
  stamp="harness-$( hostname )-$( date +%s )"
  hsql "insert into app_config(id,key,value,created_at,updated_at) values (gen_random_uuid(),'$MARKER_KEY','$stamp',now(),now()) on conflict (key) do update set value=excluded.value, updated_at=now();" >/dev/null
  hredis set "$MARKER_KEY" "$stamp" >/dev/null
  h_ok "branded disposable: $stamp  (db='$dbn')"
}

main() {
  case "${1:-}" in
    --init) brand_init; exit 0;;
  esac
  guard
  hours_guard
  mode_assert
  if [ "${HARNESS_PREFLIGHT_NET:-1}" = "1" ]; then
    health_check
    clear_otp_limits
  else
    h_warn "logic-only mode: skipped health + otp-clear"
  fi
  h_ok "ALL PREFLIGHT CHECKS PASSED — safe to proceed"
}
main "$@"
