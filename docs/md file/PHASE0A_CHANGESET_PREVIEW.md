# PHASE0A_CHANGESET_PREVIEW.md

> Pre-implementation changeset for **Phase 0A (Trustworthiness / Blockers)** from
> `HARNESS_REMEDIATION_PLAN.md` (findings F1, F2, F3, F4, F5, F6, F7, F8, F14).
> **Nothing has been modified.** This is a preview of the exact files the Phase 0A work would
> create or change, for sign-off before implementation.
>
> Verified against the working tree on branch `fix/order-rider-id-identity`:
> `scripts/harness/` does not exist (all scripts are net-new); `RUNTIME_VERIFICATION_HARNESS.md`
> exists; no file under `apps/` or `packages/` references `scripts/harness` (the harness is
> standalone and not wired into the app/build).

---

## 1. Files to create / modify

| # | File path | New / Existing | Reason for change (findings) | Approx. lines | Risk |
|---|---|---|---|---|---|
| 1 | `scripts/harness/00_preflight.sh` | **New** | Isolation guard (abort unless disposable DB / non-prod), operating-hours guard, OTP rate-key clear, health/ready + sandbox-mode assertion (**F8, F5, F3**) | ~80 new | **Medium** |
| 2 | `scripts/harness/lib.sh` | **New** | Shared helpers: dev-safe `login` (verify-only), `auth` with refresh-on-401, `gen_id` (per-run-unique ids), `sql`/`redis` wrappers (**F3, F4, F14**) | ~100 new | Low |
| 3 | `scripts/harness/.env.sandbox.example` | **New** | Committed reference for the sandbox creds profile (placeholders only; the filled `.env.sandbox` stays git-ignored) (**F1, F8**) | ~30 new | Low |
| 4 | `scripts/harness/10_fixtures.sh` | **New** | `mk_order <method>` returning a fresh, status-pinned order; account/token bootstrap; per-block fixtures so no shared `$OID` (**F6**) | ~150 new | **Medium** |
| 5 | `scripts/harness/99_cleanup.sh` | **New** | Ordered, harness-scoped, FK-safe teardown (child→parent), replacing the unsafe blanket cleanup (**F7**) | ~90 new | **Medium** |
| 6 | `scripts/harness/negatives.sh` | **New** | Negative/rejection assertions: wrong signature → 4xx, cross-role/cross-shop/non-admin → 403, replayed payment id → no second capture (**F2**) | ~80 new | Low |
| 7 | `RUNTIME_VERIFICATION_HARNESS.md` | **Existing (modified)** | Wire §B.1 to sandbox-mode + isolation; §C money blocks to sandbox-gate + negatives + unique ids; §C spine blocks to `mk_order` fresh fixtures; §D gate labels + hours precondition; §E to call `99_cleanup.sh` (**F1, F2, F5, F6, F7, F8, F14**) | ~200 changed | Low |

**Totals:** 6 new files (~530 new lines), 1 existing doc (~200 lines changed). No other files.

### Notes on the Medium-risk files
- **`00_preflight.sh` (linchpin).** Contains the **isolation guard** that every destructive step
  depends on. It also `DEL`s existing `otp:rate:*` / `otp:lockout:*` Redis keys (clears rate
  counters). Risk is Medium because a wrong guard could let a run proceed against the wrong DB.
  Mitigation: implement and self-check this **first** (it is finding 0A-1), require an explicit
  `HARNESS_DB=1` marker + `NODE_ENV != production` + a small `orders` row-count ceiling.
- **`99_cleanup.sh`.** The only file issuing `DELETE`s. Its safety is **gated by** `00_preflight.sh`'s
  isolation guard (runs only on a disposable DB) and is scoped to harness-created reference ids.
  This file is the fix for the F7 "unsafe cleanup" finding, so it is deliberately the careful one.
- **`10_fixtures.sh`.** Writes rows (orders/addresses/tokens) and drives the order flow — but only
  at execution time, only against the disposable harness DB, behind the isolation guard.

### `.gitignore` — no change required
The existing root `.gitignore` already contains `.env.*` (ignores the filled `scripts/harness/.env.sandbox`)
and `!.env.*.example` (re-includes `scripts/harness/.env.sandbox.example`). **No `.gitignore` edit is
needed**; the example is tracked and the secret-bearing copy is ignored automatically.

---

## 2. Finding → file traceability

| Finding | Implemented in |
|---|---|
| F1 (sandbox-gate money paths) | `RUNTIME_VERIFICATION_HARNESS.md` §B.1/§C/§D, `.env.sandbox.example` |
| F2 (negative/rejection cases) | `negatives.sh`, `RUNTIME_VERIFICATION_HARNESS.md` §C money blocks |
| F3 (OTP rate self-DoS) | `lib.sh` (`login`), `00_preflight.sh` (rate-key clear) |
| F4 (token expiry) | `lib.sh` (`auth` refresh-on-401) |
| F5 (operating-hours) | `00_preflight.sh`, `RUNTIME_VERIFICATION_HARNESS.md` §D |
| F6 (shared `$OID`) | `10_fixtures.sh` (`mk_order`/pin), `RUNTIME_VERIFICATION_HARNESS.md` §C spine |
| F7 (unsafe cleanup) | `99_cleanup.sh`, `RUNTIME_VERIFICATION_HARNESS.md` §E |
| F8 (env isolation) | `00_preflight.sh`, `.env.sandbox.example`, `RUNTIME_VERIFICATION_HARNESS.md` §B.1 |
| F14 (unique ids) | `lib.sh` (`gen_id`), `RUNTIME_VERIFICATION_HARNESS.md` §C-A10/§C-E3 |

---

## 3. Required confirmations

### 3.1 Will any application code be modified?
**No.** No files under `apps/api/src`, `apps/customer-app`, `apps/seller-app`, `apps/rider-app`,
or `packages/*` are touched. No `.ts`/`.tsx` application source, no Fastify routes/services/plugins,
no worker code, no `package.json`/build config, no PM2 `ecosystem.config.js`. All changes are
harness-only scripts under a new `scripts/harness/` directory plus one Markdown doc. Confirmed by
grep: nothing in `apps/`/`packages/` imports or references `scripts/harness`.

### 3.2 Will any database schema be modified?
**No.** No Prisma migrations are added, `apps/api/prisma/schema.prisma` is not edited, and no
`apps/api/prisma/seed*` files are changed. No DDL of any kind.
*Clarification:* the harness scripts will INSERT/DELETE **rows** (test fixtures + cleanup) — but only
at **execution time** (Phase 0A run), only against the **disposable harness database** behind the
isolation guard, and never any structural/DDL change. Applying *this changeset* (creating the files)
writes nothing to any database.

### 3.3 Will any Redis structures be modified?
**No new Redis structures or key schema.** The harness reuses the application's existing key patterns
(`cart:{userId}`, `fcm:token:{userId}`, `rider:{userId}:location`, `otp:*`) and, at execution time,
clears `otp:rate:*`/`otp:lockout:*` and scoped harness keys against the **harness Redis instance only**.
Applying this changeset (creating files) modifies no Redis data. No persistent Redis structure is added.

### 3.4 Can any production behavior change?
**No.** None of these files is imported, `require`d, or executed by the API or worker processes, the
build, the Docker image, the deploy pipeline, or PM2. They are standalone scripts an operator runs
by hand against a disposable environment. The Markdown change is documentation. The `.gitignore`
needs no change. There is **zero** impact on production runtime, build output, deploy, or schema.

### 3.5 Rollback procedure
All changes are **additive harness files + one doc edit + zero migrations**, so rollback is trivial
and carries no data/redeploy risk:

- **Before committing** (changes still in working tree):
  ```bash
  rm -rf scripts/harness/                          # remove the 6 new files
  git checkout -- RUNTIME_VERIFICATION_HARNESS.md  # revert the doc edit
  ```
- **After committing** (isolated commit recommended — see below):
  ```bash
  git revert <phase0a_commit_sha>     # or: git reset --hard <pre-changeset_sha>
  ```
- **No other rollback steps:** no DB migration to reverse, no Prisma client regenerate, no app
  rebuild/redeploy, no PM2 restart, no Redis flush. Because nothing is wired into the app, even an
  un-reverted or partially-applied changeset has **no production effect**.
- **Hygiene recommendation (preview, not an action):** commit the Phase 0A changeset as its **own
  commit/branch**, separate from the unrelated uncommitted changes currently on
  `fix/order-rider-id-identity`, so the revert is cleanly isolated.

---

## 4. Status

**No files have been created or modified by this preview** (other than this `PHASE0A_CHANGESET_PREVIEW.md`
deliverable itself). Implementation of the 7-file changeset above is pending your approval.
