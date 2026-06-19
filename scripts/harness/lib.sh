# scripts/harness/lib.sh — Phase 0A shared helpers. SOURCED, not executed.
# Findings: F3 (dev-safe login), F4 (auth refresh-on-401, durable), F14 (unique ids).
# bash 3.2-safe (no associative arrays / namerefs / ${x,,}). No global `set -e`.
# shellcheck shell=bash

# ── Overridable primitives (so self-tests can mock the network/DB/Redis) ──────
: "${H_PSQL:=psql}"
: "${H_REDIS:=redis-cli}"
: "${H_CURL:=curl}"
: "${API:=http://localhost:3000/api/v1}"

# ── Per-run state dir (token store + id counter). File-backed so values survive
#    $(...) command-substitution subshells — see the F4/F14 fix below. ──────────
: "${HARNESS_STATE_DIR:=${TMPDIR:-/tmp}/harness_state.$$}"
mkdir -p "$HARNESS_STATE_DIR" 2>/dev/null || true

# ── Logging / abort / assert ──────────────────────────────────────────────────
h_ok()    { printf '  \033[32m✔\033[0m %s\n' "$*"; }
h_warn()  { printf '  \033[33m!\033[0m %s\n' "$*" >&2; }
h_info()  { printf '  • %s\n' "$*"; }
h_abort() { printf '\n\033[31m✖ HARNESS ABORT:\033[0m %s\n' "$*" >&2; exit 2; }
h_pass()  { printf '  \033[32m✔ PASS\033[0m %s\n' "$*"; }
h_fail()  { printf '  \033[31m✗ FAIL\033[0m %s\n' "$*" >&2; HARNESS_FAILED=1; return 1; }
# expect_status EXPECTED ACTUAL LABEL  (used by negatives.sh, F2)
expect_status() {
  if [ "$1" = "$2" ]; then h_pass "$3 (HTTP $2)"; else h_fail "$3 — expected HTTP $1, got '${2:-}'"; fi
}

# ── DB / Redis conduits (GENERIC — callers own scope; see PHASE0A_RISK_SURFACE) ─
hsql()   { "$H_PSQL" "${DATABASE_URL:?DATABASE_URL unset}" -tAc "$1"; }
hredis() { "$H_REDIS" -u "${REDIS_URL:?REDIS_URL unset}" "$@"; }

# ── URL host extraction (postgres/redis, with or without creds) ───────────────
url_host() { printf '%s' "$1" | sed -E 's#^[a-z][a-z]*://([^@]*@)?([^:/?]+).*#\2#'; }

# ── Unique id (F14): file-backed monotonic counter + entropy. Survives $(...)
#    subshells (the counter lives in a file keyed by the parent pid). ──────────
gen_id() {
  local f="$HARNESS_STATE_DIR/.genctr" n
  n=$(( $( cat "$f" 2>/dev/null || echo 0 ) + 1 ))
  printf '%s' "$n" > "$f"
  printf '%s_%s_%s_%s_%s%s' "${1:-id}" "$( date +%s )" "$$" "$n" "$RANDOM" "$RANDOM"
}

# ── HTTP primitive: prints "<body>\n<status>" (status on the last line) ───────
_http() { # $1=method $2=path [$3=bearer] [$4=json]
  local method="$1" path="$2" tok="${3:-}" body="${4:-}" args
  args=( -s -w $'\n%{http_code}' -X "$method" "$API$path" -H 'content-type: application/json' )
  [ -n "$tok" ]  && args+=( -H "authorization: Bearer $tok" )
  [ -n "$body" ] && args+=( -d "$body" )
  "$H_CURL" "${args[@]}"
}

# ── Token store (file-backed, keyed by ROLE) — durable across subshells ──────
set_tokens() { # ROLE ACCESS REFRESH
  printf '%s' "${2:-}" > "$HARNESS_STATE_DIR/$1.at"
  printf '%s' "${3:-}" > "$HARNESS_STATE_DIR/$1.rt"
}
_tok() { cat "$HARNESS_STATE_DIR/$1.$2" 2>/dev/null || true; }   # ROLE FIELD(at|rt)

# ── Dev-safe login (F3): verify-otp ONLY (123456 bypass) — never send-otp ─────
# Echoes "<accessToken>\t<refreshToken>". Sandbox payment mode keeps NODE_ENV=
# development (isRazorpayConfigured() is key-based) so the bypass still applies.
login() { # $1=phone
  local out code body at rt
  out="$( _http POST /auth/verify-otp "" "{\"phone\":\"$1\",\"otp\":\"${HARNESS_OTP:-123456}\"}" )"
  code="$( printf '%s' "$out" | tail -n1 )"
  body="$( printf '%s' "$out" | sed '$d' )"
  [ "$code" = "200" ] || h_abort "login($1) failed (HTTP $code). Is the API up with NODE_ENV=development? Body: $body"
  at="$( printf '%s' "$body" | jq -r '.tokens.accessToken // empty' )"
  rt="$( printf '%s' "$body" | jq -r '.tokens.refreshToken // empty' )"
  [ -n "$at" ] || h_abort "login($1): no accessToken in response: $body"
  printf '%s\t%s' "$at" "$rt"
}
# login_as ROLE PHONE — logs in and stores tokens in the durable store.
login_as() { local pair; pair="$( login "$2" )"; set_tokens "$1" "$( printf '%s' "$pair" | cut -f1 )" "$( printf '%s' "$pair" | cut -f2 )"; }

# ── auth with DURABLE refresh-on-401 (F4) ─────────────────────────────────────
# Usage: auth ROLE METHOD PATH [JSON]   (ROLE keys the token store)
#   On 401 the role's tokens are refreshed and WRITTEN BACK TO THE STORE, so a
#   refresh performed inside a $(...) body-capture still persists to later calls.
#   Echoes the response body; sets REPLY_STATUS and writes it to the store too.
auth() {
  local role="$1" method="$2" path="$3" json="${4:-}"
  local at rt out code body
  at="$( _tok "$role" at )"; rt="$( _tok "$role" rt )"
  out="$( _http "$method" "$path" "$at" "$json" )"
  code="$( printf '%s' "$out" | tail -n1 )"; body="$( printf '%s' "$out" | sed '$d' )"
  if [ "$code" = "401" ] && [ -n "$rt" ]; then
    local rout rcode rbody nat nrt
    rout="$( _http POST /auth/refresh "" "{\"refreshToken\":\"$rt\"}" )"
    rcode="$( printf '%s' "$rout" | tail -n1 )"; rbody="$( printf '%s' "$rout" | sed '$d' )"
    if [ "$rcode" = "200" ]; then
      nat="$( printf '%s' "$rbody" | jq -r '.tokens.accessToken // empty' )"
      nrt="$( printf '%s' "$rbody" | jq -r '.tokens.refreshToken // empty' )"
      [ -n "$nat" ] && set_tokens "$role" "$nat" "$nrt"
      out="$( _http "$method" "$path" "$nat" "$json" )"
      code="$( printf '%s' "$out" | tail -n1 )"; body="$( printf '%s' "$out" | sed '$d' )"
    fi
  fi
  REPLY_STATUS="$code"
  printf '%s' "$code" > "$HARNESS_STATE_DIR/.last_status"   # durable across subshells
  printf '%s' "$body"
}
# last_status — the HTTP code of the most recent auth() call (subshell-safe).
last_status() { cat "$HARNESS_STATE_DIR/.last_status" 2>/dev/null || true; }
