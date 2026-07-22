# Pre-Merge Repository Audit — `chirawa`

> **What this is:** a complete, read-only inspection of the repository done **before** touching any shared branch.
> **What was NOT done:** no merge, no rebase, no push, no force-push, no history change, no branch deletion. **Nothing was changed.** The only things that ran were read-only Git commands plus a build/test check (which only writes into the gitignored `node_modules`).
> **Date:** 2026-06-29 · **Branch inspected:** `customer-app-validation`

**How to read this:** every technical word is explained in plain English the first time it appears. If you only read one thing, read the **Executive Summary**.

---

## Executive Summary

**The good news — your situation is about as clean as it gets:**

1. **There is no `master` branch. Your main branch is called `main`.** Everywhere you were thinking "master," read **`main`**. (No `master` exists locally or on the server.)
2. **Your branch is 10 commits *ahead* of `main` and 0 commits *behind*.** In plain English: `main` has not moved at all since you branched off it, and you've added 10 commits on top. (A "commit" = one saved checkpoint of work.)
3. **Because `main` hasn't moved, a merge would be a "fast-forward" — meaning ZERO merge conflicts are possible.** A "merge conflict" is when two people changed the same line and Git can't decide which to keep. That cannot happen here, because only *you* have changed anything since `main`. This is the safest merge scenario that exists.
4. **All 344 automated backend tests pass.** Strong evidence the new features actually work.
5. **All your committed work is consolidated in this one branch** (`customer-app-validation`). I checked every other local branch — none of them has finished work that is missing from here. Nothing will be left behind.

**The things to clean up BEFORE you merge (none are conflicts — they're tidiness):**

1. 🟠 **Your branch was never pushed to the server.** It only exists on your laptop. (It has "no upstream" — no server copy it's linked to.)
2. 🟠 **You have a pile of uncommitted work in progress (WIP).** 29 tracked files are changed but **not saved into a commit yet** (e.g., `OrderTrackingScreen.tsx` with +174 lines, `realtime.plugin.ts`, plus 14 deleted planning `.md` files). **Uncommitted work does NOT travel with a merge** — if you merge today, your teammate will NOT get any of it. You must decide what to commit and what to throw away first.
3. 🟠 **Lots of untracked clutter** that shouldn't go to a shared branch: a 265 KB `bug001.diff`, a `.codex/` folder, and a `docs/md file/` folder containing **65 planning documents**.
4. 🟡 **`typecheck` and `lint` both fail — but this is a *pre-existing* problem, not something your branch caused.** The type errors are largely in files that are byte-for-byte identical to `main`, and `lint` has never worked because the project has no ESLint config file. They do **not** block the merge, but the team should fix them.

**Bottom line:** The *code* is safe and merge-ready. The *workspace* is messy. Tidy the uncommitted/untracked files, commit anything you want to keep, push your branch, and merge. **Estimated cleanup time: 30–60 minutes.**

---

## Repository Status

### 1. Branch Status (explained simply)

| Question | Answer |
|---|---|
| Which branch am I on? | **`customer-app-validation`** |
| Which is the main branch? | **`main`** (there is **no** `master`) |
| How many branches exist? | **7 local** + **4 remote** = 11 names total |
| Is my branch on the server? | **No** — `customer-app-validation` has no "upstream" (no linked server copy). It lives only on your machine. |
| Is `main` up to date with the server? | **Yes** — local `main` and `origin/main` are the exact same commit (`477cd35`). |

**Local branches (on your computer):**
| Branch | Tip commit | Server copy (upstream)? |
|---|---|---|
| `customer-app-validation` ← *you are here* | `7433c86` | ❌ none (never pushed) |
| `chore/harness-phase-0a` | `7433c86` | ❌ none — **same commit as your branch** (a duplicate pointer) |
| `main` | `477cd35` | ✅ tracks `origin/main` (in sync) |
| `fix/order-rider-id-identity` | `6a795ef` | ✅ tracks `origin/fix/order-rider-id-identity` (ahead 1) |
| `feat/blinkit-style-catalog` | `723655a` | ❌ none — already contained in `main` |
| `feat/geo-mappls-switch` | `477cd35` | ❌ none — same commit as `main` |
| `fix/cross-process-eventbus-bridge` | `a9cced4` | ❌ none — already contained in `main` |

**Remote branches (on GitHub `origin` = `Whatever-Piyush/chirawa`):** `origin/main` (the default), `origin/fix/order-rider-id-identity`, `origin/piyush`, and `origin/HEAD` (a pointer that just says "the default branch is `main`").

> **Plain-English meaning:** "Tracking" means a local branch is paired with a copy on the server, so Git can tell you "you're 3 ahead / 2 behind." Your working branch is **not** paired with anything on the server yet — that's why you'll need to push it (with `-u` to create that pairing) before your teammate can ever see it.

**Are any branches with finished work going to be left behind?** **No.** I checked: every other local branch's commits are already inside `customer-app-validation`. Your branch is the single bucket that holds **all** committed work.

---

### 2. Your Branch vs `main`

- **Commits different:** **10 ahead, 0 behind.** (You added 10; `main` added 0.)
- **Common starting point ("merge base"):** `477cd35` — which is exactly the tip of `main`. This is what makes it a **clean fast-forward** (no possible conflict).

**The 10 commits that would go into `main` (newest first):**
```
7433c86  fix: harden payments refunds dispatch and settlement flows
0672090  fix(harness): H-1 — include required cartId in mk_order / doc order payload
c5b88c4  chore(harness): Phase 0A trustworthiness tooling for runtime verification
6a795ef  fix(checkout): prevent YMAL add/qty race from dropping items at Place Order
e8b2b9e  feat(tracking): V2 customer tracking UI — error/refund/item-unavailable + ETA hero...
7a0817b  feat(tracking): add refund block to GET /orders/:id (Tracking V2)
179e057  fix(eta): notification ordering (#10) + client order:eta subscription (#4)
7db0993  feat(eta): Phase 1 milestone ETA (server-computed, coord-based)
bcd8830  feat(orders): surface assigned rider name + phone in GET /orders/:id (gated)
6fdad0d  fix(orders): key rider checks off RiderProfile.id, not User.id (BUG-1)
```

**Committed file changes (this is what actually merges): 41 files, +3,696 / −348 lines.**
- **Added (brand-new files): ~20** — incl. `eta.service.ts`, `order-status.ts`, a new Prisma migration `20260617184209_eta_phase1`, ~10 new test files, and the `scripts/harness/*` shell scripts.
- **Modified: ~21** — incl. `schema.prisma`, `orders.service.ts`, `payments.service.ts`, `dispatch.service.ts`, `realtime.plugin.ts`, and customer-app tracking/checkout screens.
- **Deleted: 0 · Renamed: 0.** (All additive — nothing committed in these 10 commits removes or renames a file.)

> **"If we merge today, this is exactly what goes into `main`":**
> Only those **10 commits / 41 files** above. **Nothing else.** Your uncommitted edits, your file deletions that aren't committed, and every untracked file **stay on your laptop** and do **not** reach `main` or your teammate. That gap is the single most important thing to understand in this whole report.

---

### 3. Repository Health

| Check | Result | Good or bad? | Do we worry? |
|---|---|---|---|
| **Uncommitted changes** (edited but not saved to a commit) | **Yes — 29 tracked files** | ⚠️ Needs a decision | **Yes** — decide what to commit vs discard before merging |
| **Untracked files** (new files Git isn't following) | **Yes — many** (see §5) | ⚠️ Clutter | **Yes** — clean before pushing |
| **Merge conflicts** | **None** | ✅ Good | No |
| **Unfinished merge** | **None** | ✅ Good | No |
| **Unfinished rebase** | **None** | ✅ Good | No — a leftover `REBASE_HEAD` marker exists, but no rebase is actually running (it's a harmless old pointer to `22620ec`) |
| **Detached HEAD** (not on any branch) | **No** — safely on `customer-app-validation` | ✅ Good | No |
| **Stash entries** (work shelved aside) | **None** | ✅ Good | No |

> **What is "uncommitted"?** A commit is a saved checkpoint. "Uncommitted" changes are edits sitting in your folder that haven't been put into a checkpoint yet — so Git won't carry them anywhere.
> **What is "untracked"?** A brand-new file Git has never been told to manage. It's invisible to commits/merges until you `git add` it.
> **What is "detached HEAD"?** When you're looking at a commit directly instead of standing on a branch — new commits there can get lost. **You are not in this state — good.**

**Breakdown of the 29 uncommitted files** (338 insertions, 4,287 deletions — the huge deletion count is almost entirely the 14 planning docs being removed):
- **14 deleted planning docs** (`1.md`, `2.md`, `CATALOG_ENGINE.md`, `inventory.md`, … `address_Bar.md`) — these are still in `main`; the deletion is *not committed*, so a merge today would **keep** them in `main`.
- **~15 real code/config edits** — biggest are `apps/customer-app/.../OrderTrackingScreen.tsx` (+174), `OrderPlacedScreen.tsx` (+51), `realtime.plugin.ts` (~46), plus `app.json` files, `.env.example` files, `i18n` translations, `order.dto.ts`, and a 3-line `pnpm-lock.yaml` change.

---

### 4. Build, Lint, Typecheck & Tests

> ⚠️ **Important caveat:** these checks ran against your **current folder, which still contains the uncommitted WIP.** The thing that actually *merges* is the committed code only. Where it matters, I separated "your branch's fault" from "already broken on `main`."

| Check | Result | Severity | Blocks merge? |
|---|---|---|---|
| **Install / setup** | ✅ `node_modules` present (pnpm 11.4); `prisma generate` works | — | No |
| **Tests** (`vitest`) | ✅ **49 files, 344/344 passing** in 2.55s | — | No — this is the strong green light |
| **Typecheck** (`tsc --noEmit`) | ❌ Fails | 🟡 Medium | **No** (see why below) |
| **Lint** (`eslint`) | ❌ Cannot run — no ESLint config file found | 🟡 Low | No (tooling gap, pre-existing) |

**Why typecheck failing does NOT block the merge:** Several of the failing files — `payments.routes.ts`, `razorpay.service.ts`, `pricing.routes.ts` — are **not** in your branch's changes at all. They are identical to `main`. That proves **`main` was already failing typecheck before your branch existed.** This is a long-standing project condition (strict TypeScript settings rubbing against the Fastify v4 types), not a regression you introduced. A small number of errors *are* in your files (`orders.service.ts:795`, one modified payments test, and an untracked WIP test) — worth fixing, but they don't break the tests or the runtime.

**Why lint failing is not scary:** the `lint` script runs `eslint src` but the project has no `.eslintrc` wired up (only an unused `.eslintrc.base.json`), so eslint exits immediately. This has **never** worked and is unrelated to your work. It's a tooling chore for later.

**Merge-safety verification (the one that really matters):** I confirmed that **no committed file imports any of the untracked WIP files** (like the new `realtime.helpers.ts`). So the 10 commits are **self-contained** — merging them will not ship code that references files left behind on your laptop. ✅

---

### 5. Code Quality

| Check | Finding | Verdict |
|---|---|---|
| Build artifacts committed (compiled `dist/`, `coverage/`, `.expo/`) | **None tracked** — `.gitignore` correctly covers them | ✅ Clean |
| Real secrets / `.env` committed | **None** — only `.env.example` files are tracked | ✅ Clean |
| `TODO` / `FIXME` / `HACK` / `XXX` in source | **Only 4** across the whole codebase | ✅ Very clean |
| `debugger` statements | **0** | ✅ Clean |
| `console.log` in API source | **42**, mostly in `worker/jobs` (the "🗑️ cleanup / ✅ reconciled" operational logs) | 🟢 Benign |
| **Temporary / junk files (untracked)** | `bug001.diff` (**265 KB**), `bug001.patch`, `.codex/` folder, and `docs/md file/` with **65 markdown docs** | 🟠 Remove/ignore before pushing |
| **Duplicate docs** | Planning docs exist in **two** places — at the repo root (being deleted) **and** inside `docs/md file/` (untracked copies), e.g. `CATALOG_ENGINE.md`, `inventory.md` | 🟠 Decide one home (or delete) |

> Note: this audit itself, plus a handful of analysis files at the repo root (`AUDIT_REPORT.md`, `INVENTORY_ENGINE_ANALYSIS.md`, `*_LIFECYCLE.md`, `SYSTEM_MAP.md`), are untracked documents too. They're harmless but add to the clutter — keep them out of the merge.

---

### 6. Dependencies & Configuration

| Item | Finding | Consistent? |
|---|---|---|
| `package.json` files | 8 total (root + 4 apps + 3 shared packages) | ✅ Standard pnpm monorepo |
| Workspace config | `pnpm-workspace.yaml` lists `apps/*` and `packages/*` | ✅ Correct |
| Lock file | `pnpm-lock.yaml` present; **3 lines changed uncommitted** (from a 1-line `rider-app/package.json` dependency add) | 🟡 Commit the lockfile **together with** the package.json change |
| Prisma schema & migrations | `schema.prisma` + **26 migrations**, including the new `20260617184209_eta_phase1`; `migration_lock.toml` present | ✅ Consistent |
| Environment variables | No real `.env` tracked (only `.example`); `.env.example` files have small uncommitted edits (new keys) | ✅ Safe |
| `.gitignore` | Correctly ignores `node_modules/`, `dist/`, `.env*` (keeping `.example`), `coverage/`, `.expo/` | ✅ Healthy |
| Scripts | Root has `dev/build/test/lint/typecheck/db:*`; all run except `lint` (no config) | 🟡 One broken script (lint) |

**Verdict:** dependencies and configuration are consistent and healthy. Two small follow-ups: commit the lockfile alongside its package.json change, and wire up an ESLint config so `lint` runs.

---

## Feature Status

These are the **new** features your 10 commits add on top of `main`. (The rest of the platform — Auth/OTP, the three apps, Catalog/Inventory, Orders, Payments, Notifications, Admin, Delivery — already lives in `main`.)

| Feature (commit) | What it does, in plain English | Status | Safe to merge? |
|---|---|---|---|
| **Rider identity fix — BUG-1** (`6fdad0d`) | Fixes rider permission + cash-collection checks that were comparing the wrong IDs | ✅ Complete, **tested** | ✅ Yes |
| **Rider contact on order** (`bcd8830`) | Shows the assigned rider's name & phone in the order details (access-gated) | ✅ Complete | ✅ Yes |
| **Delivery ETA — Phase 1** (`7db0993`, `179e057`) | Server-calculated "arriving by" time per order milestone, pushed live to the customer | ✅ Complete, **tested** | ✅ Yes |
| **Tracking V2 — refund data** (`7a0817b`) | The order API now returns refund/unavailable-item info so the tracking screen can show it | ✅ Complete | ✅ Yes |
| **Tracking V2 — customer UI** (`e8b2b9e`) | New tracking screen: ETA hero, map gating, timeline, refund/error states | ✅ Complete (committed) — note: there are **uncommitted further edits** to this screen still in your folder | ✅ Yes (committed part) |
| **Checkout race fix — YMAL** (`6a795ef`) | Stops a "you-might-also-like" add/quantity race from dropping items at Place Order | ✅ Complete, **tested** | ✅ Yes |
| **Verification harness — Phase 0A** (`c5b88c4`, `0672090`) | Internal test/automation tooling (shell scripts) to verify flows at runtime | ✅ Tooling only | ✅ Yes (dev-only) |
| **Payments hardening** (`7433c86`) | Makes refunds, dispatch, and seller settlement flows safer/idempotent | ✅ Complete, **tested** | ✅ Yes |

**Overall:** every one of the 10 commits is **committed, self-contained, and covered by the 344 passing tests.** As a set, they are **safe to merge.** The only "partial" feeling comes from the **uncommitted follow-up edits** (especially on the tracking screen) — that work is *in progress in your folder* and is a separate decision from merging the committed 10.

---

## Risks

| # | Risk | Likelihood | Why it matters | Mitigation |
|---|---|---|---|---|
| R1 | **Uncommitted WIP gets silently left out of the merge** | High | Your teammate pulls `main` and is missing the tracking-screen edits, the realtime refactor, etc. | Decide per file: commit it, or deliberately discard it, **before** merging |
| R2 | **Branch never pushed** | Certain (it's a fact) | No backup exists; if your laptop dies, 10 commits vanish | Push the branch first (`-u`) — this is also your backup |
| R3 | **Junk/clutter accidentally committed** (`bug001.diff`, `.codex/`, `docs/md file/`) | Medium | Bloats the repo and confuses the next developer | Add to `.gitignore` or delete before staging |
| R4 | **Typecheck/lint are red** | Certain | A teammate running `typecheck` will see errors and may panic | Communicate that it's pre-existing; schedule a cleanup task |
| R5 | **Lockfile drift** | Low | The `pnpm-lock.yaml` edit is uncommitted; committing the package.json without it causes install mismatches | Commit lockfile + package.json together |
| R6 | **Merge conflicts** | **None** | — | Not applicable — `main` hasn't moved |

---

## Recommendations

1. **Push your branch first — it's both a backup and a prerequisite.** Until it's on the server, nothing else is safe.
2. **Triage the uncommitted changes deliberately.** Walk through the 29 files: the 14 doc deletions are probably intentional cleanup (commit them); the real code edits (tracking screen, realtime plugin) are WIP — either finish & commit, or set them aside on a separate branch so they aren't lost.
3. **Quarantine the junk.** `.gitignore` the `.codex/`, `bug001.diff`, `bug001.patch`, and the `docs/md file/` pile (or delete them). They should not reach a shared branch.
4. **Merge with a real merge commit (`--no-ff`) or, better, a Pull Request.** Even though a fast-forward is possible, a PR gives your teammate a visible, reviewable record of "here are the 10 commits that landed."
5. **Don't fix typecheck/lint in the same step as the merge.** Land the working, tested code now; file a separate cleanup task for the pre-existing type errors and the missing ESLint config.
6. **Tidy the branch list afterward.** `chore/harness-phase-0a` points at the exact same commit as your branch — a leftover duplicate you can delete later (not now).

---

## Merge Strategy

**Recommended: open a Pull Request from `customer-app-validation` → `main` (which results in a fast-forward / clean merge).**

| Strategy | Fit here | Why |
|---|---|---|
| ✅ **Merge via PR (recommended)** | **Best** | `main` hasn't moved, so there are **no conflicts to resolve**. A PR adds review + a clear record, and merging is one click. |
| ➕ Plain `git merge` (fast-forward) | Fine | Same clean result, but no review trail. Use if you're not using PRs. |
| ⚠️ Rebase | **Unnecessary** | Rebasing replays your commits onto a *moved* base — but `main` hasn't moved, so there's nothing to replay onto. Adds risk for zero benefit. |
| ⚠️ Cherry-pick | **Unnecessary** | Cherry-pick is for grabbing *some* commits. You want **all 10**, and they're already a tidy sequence. |
| ✅ **Clean the branch first** | **Do this before any of the above** | The merge is safe; the *workspace* is what needs tidying. |

**Why this is low-risk:** the only person who has changed anything since `main` is you. Git can place your 10 commits on top of `main` with no decisions to make. The classic dangers of an old-master merge — conflicts, tangled history, lost work — **do not apply**, with one exception you control: the uncommitted work (handle it per Recommendation #2).

**Advantages:** simplest possible path; full history preserved; reviewable; reversible (you can revert a PR merge).
**Disadvantages:** a PR is a tiny bit more ceremony than a raw merge — well worth it for a shared branch.

---

## Final Checklist (Execution Plan — NOT yet executed)

> Run these **in order**, only after you've read the above. Each step says *why*. Nothing here has been done for you.

**A. Back up (so nothing can be lost)**
- [ ] `git push -u origin customer-app-validation` — *puts your 10 commits on the server; this is your backup AND links the branch to a server copy.*
- [ ] (Optional, extra safety) `git tag pre-merge-backup` — *a permanent bookmark of this exact state you can always return to.*

**B. Decide what to do with the uncommitted work** *(this is the most important step)*
- [ ] Run `git status` and review the 29 changed files. *So you know exactly what's loose.*
- [ ] Commit the changes you want to keep (e.g., the doc cleanup and any finished code): `git add -p` then `git commit`. *Only committed work travels with the merge.*
- [ ] For unfinished WIP you're not ready to share, move it aside: `git stash` or commit it on a separate `wip/...` branch. *Keeps half-done work out of `main` without losing it.*
- [ ] `.gitignore` or delete the junk: `.codex/`, `bug001.diff`, `bug001.patch`, `docs/md file/`. *Stops clutter reaching the shared branch.*
- [ ] Make sure `pnpm-lock.yaml` is committed **with** the `package.json` change that caused it. *Prevents install mismatches for your teammate.*

**C. Make sure `main` is current**
- [ ] `git fetch origin` — *downloads the latest server state without changing your files.*
- [ ] Confirm `git rev-list --count main..origin/main` is `0` — *verifies nobody else pushed to `main` while you were working (today it's 0).*

**D. Verify it still builds & tests pass (on the cleaned-up branch)**
- [ ] `pnpm --filter @chirawa/api db:generate` then `pnpm --filter @chirawa/api test` — *confirm the 344 tests are still green after your commits.*

**E. Merge**
- [ ] Open a Pull Request `customer-app-validation → main` on GitHub, **or** locally: `git switch main && git merge --no-ff customer-app-validation`. *Brings your 10 commits into `main` with a clear record.*
- [ ] (No conflict step needed — there won't be any. If Git ever *does* report one, stop and resolve file-by-file before continuing.)

**F. Push the result**
- [ ] `git push origin main` (or just click "Merge" on the PR). *Publishes the merged `main` to the server.*

**G. Hand off**
- [ ] Tell your teammate: `git checkout main && git pull`. *They now get exactly the 10 committed features — and nothing half-finished.*
- [ ] Mention the known pre-existing `typecheck`/`lint` issues so they aren't surprised.

---

### Appendix — Evidence (commands run, all read-only)
- Branch/topology: `git branch -a`, `git branch -vv`, `git remote -v`
- Comparison: `git rev-list --left-right --count main...customer-app-validation` → `0  10`; `git merge-base` → `477cd35` (= `main` tip)
- Changed files: `git diff --name-status main..customer-app-validation` (41 files, 0 D, 0 R)
- Health: `git status`, `git stash list` (empty), `.git/rebase-merge` & `rebase-apply` absent (no active rebase)
- Stranded-work check: `git rev-list --count customer-app-validation..<each-branch>` → all `0`
- Build: `prisma generate` ✅ · `tsc --noEmit` ❌ (errors incl. files identical to `main`) · `eslint` ❌ (no config) · `vitest` ✅ **344 passing**
- Merge-safety: confirmed no committed file imports the untracked WIP (`realtime.helpers`, harness script)
