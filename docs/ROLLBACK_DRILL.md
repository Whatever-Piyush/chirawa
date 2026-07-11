# Rollback — Runbook & Drill

**Scope:** returning production to a previously released commit after a bad deploy.
Deploy flow: `docs/DEPLOYMENT.md`. Database restore (a different, heavier lever):
`docs/DISASTER_RECOVERY.md`.

**One line to remember:** *Actions → "Rollback production" → Run workflow → leave `sha`
empty.* That re-releases the previous successful commit and skips migrations.

---

## 1. Decide: roll back, fix forward, or restore?

| Situation | Do this |
|---|---|
| New release errors/crashes/misbehaves, previous release was fine | **Roll back** (this doc) |
| Bug is small, understood, and prod is degraded but functional | Fix forward: revert/patch PR → merge → normal deploy |
| The **migration** broke data, or old code can't read the new schema | **Stop.** This is a restore decision → `docs/DISASTER_RECOVERY.md` (pre-migration backup exists — the migration could not have run without one) |
| Deploy failed **before** `pm2 startOrReload` (install/build/env:check/migration gate) | Nothing to roll back — the old release never stopped serving. Fix and re-push. |

Rollback is cheap and safe by design — when in doubt between rollback and debugging live,
roll back first, debug after.

## 2. What a rollback does (and deliberately does not)

Both entry points run the same `scripts/server-release.sh` with `SKIP_MIGRATIONS=1`:
checkout target SHA → `pnpm install --frozen-lockfile` → `prisma generate` → build →
`env:check` → **no migrations** → `pm2 startOrReload` → health gate → history entry.

- **Migrations are forward-only.** Rollback never runs `migrate deploy` backwards (Prisma
  has no down-migrations) and never restores the DB. Old code runs against the newer
  schema — safe as long as migrations stay additive/expand-contract (the default here;
  enforced culturally by the checklist in `docs/DEPLOYMENT.md` §8).
- Target resolution: explicit SHA if given; otherwise the newest entry in
  `/var/log/chirawa/deploy-history.log` whose SHA differs from the current checkout —
  correct even after a half-failed deploy, because only successful releases are recorded.
- Concurrency: shares the `production-deploy` lock, so it queues behind (never interleaves
  with) any in-flight deploy.

## 3. The three ways to roll back

1. **One click (preferred):** GitHub → Actions → *Rollback production* → *Run workflow* →
   leave `sha` empty (or paste a specific SHA from the deploy history / `git log`).
2. **One command (Actions down):**
   `CHIRAWA_SSH_HOST=appuser@<server-ip> bash scripts/rollback.sh [sha]`
3. **By hand (everything down)** — on the server:
   ```bash
   cd /opt/chirawa
   TARGET=$(bash scripts/server-previous-release.sh)   # or pick a SHA yourself
   git fetch origin && git checkout --detach "$TARGET"
   SKIP_MIGRATIONS=1 bash scripts/server-release.sh
   ```

Expected duration: **2–5 minutes** (install is cached; build ≈ 30 s; reload is
zero-downtime). If the rollback itself fails its health gate → `docs/DISASTER_RECOVERY.md`.

## 4. Verify after any rollback

- [ ] `curl -s https://api.chirawa.in/health` → `"status":"ok"` and `uptimeSeconds` reset
- [ ] On the server: `git -C /opt/chirawa rev-parse HEAD` == intended SHA
- [ ] `pm2 status`: `api` ×4 + `worker` online, restart counters stable
- [ ] `pm2 logs api --lines 50 --nostream`: the errors that triggered the rollback are gone
- [ ] Business smoke test: place a COD order in the customer app (or drive one API flow)
- [ ] `/var/log/chirawa/deploy-history.log` has a new `rollback <sha>` line
- [ ] Tell the team what was rolled back and why; open the fix-forward issue immediately —
      a rollback parks the problem, it doesn't solve it

## 5. The drill — practice before you need it

Run this **quarterly** (and once right after merging this phase). Total time ≈ 15 min.
The point is that the on-call person has done a real rollback before doing one at 2 AM.

1. **Deploy a marker:** merge a trivial visible change to main (e.g. bump the `service`
   string in `/health` to `chirawa-api+drill`). Wait for the deploy to go green.
2. **Confirm it's live:** `curl -s https://api.chirawa.in/health` shows the marker.
3. **Roll back one-click:** Actions → Rollback production → empty `sha`. Start a timer.
4. **Verify** with §4 (marker gone, health 200, PM2 stable). Stop the timer.
5. **Roll forward:** re-run the normal deploy (Actions → re-run the deploy workflow on the
   marker commit, or merge the next change). Confirm the marker is back.
6. **Record the result** below; if any step surprised you, fix the doc/script in the same PR
   that records the drill.

| Date | Who | Rollback took | Issues found |
|---|---|---|---|
| _(fill on first drill)_ | | | |

## 6. Known limitations (accepted for now)

- Rollback rebuilds on the server (~2–5 min), it doesn't swap a prebuilt artifact. If this
  ever feels slow in an incident, the Docker image path (ADR 004) is the upgrade.
- `pnpm install` at the rollback target uses that commit's lockfile — a rollback across a
  dependency upgrade is slower (cold packages) but correct.
- No automated rollback-on-failed-health-gate yet; the deploy fails loudly and a human
  clicks the rollback. Deliberate: auto-rollback that skips migrations needs more careful
  schema-compat automation than we have evidence to trust.
