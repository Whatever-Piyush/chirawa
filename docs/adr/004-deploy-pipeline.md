# ADR 004 — Deploy Pipeline: CI-Gated PM2 Releases, Docker as Contingency

**Date:** 2026-07-02
**Status:** Accepted
**Deciders:** Founders + production-hardening audit (docs/ENGINEERING_AUDIT_2026-07.md, P0-3 + P0-6)

## Context

Before this ADR the pipeline was incoherent (audit P0-3): `deploy.yml` built and pushed a
Docker image that **nothing ever ran**, then SSH'd in and did `git pull` + PM2 running `tsx`
on TypeScript source. The deploy was not gated on CI (`deploy.yml` triggered independently of
`ci.yml`; both had been red for weeks while manual server deploys happened anyway). Its inline
test step declared Postgres/Redis URLs but no service containers, and its `pm2 reload
ecosystem.config.js` ran from `/opt/chirawa` where no such file exists — the workflow could
never have gone green. There was no rollback story and no `packageManager` pin (corepack
picked latest pnpm 11.x, which crashes on Node 20).

The audit offered two exits: (a) actually deploy the image being built, or (b) drop the image
push and make the git+PM2 path safe. It leaned (a) ("you already pay for the build").

## Decision

**(b), plus compilation.** One deploy path: push to `main` → the real CI workflow as a
reusable gate (`workflow_call` + `needs`) → SSH release of the exact tested SHA via
`scripts/server-release.sh` (install → `prisma generate` → `tsc` build → env preflight →
backup-guarded migration → `pm2 startOrReload` of **compiled `dist/`** → health gate →
history log). Rollback re-runs the same script at a previous SHA with migrations skipped
(`rollback.yml` / `scripts/rollback.sh`). The Docker image is **demoted to a contingency
artifact**: CI proves it builds on every PR; the deploy neither pushes nor runs it.

## Rationale

1. **Why not (a), against the audit's lean:** running containers in prod is not a workflow
   edit — it needs server-side orchestration (compose/systemd), a port/nginx cutover, a
   registry-credential path on the box, and a PM2 decommission, none of which can be built or
   verified from this repo alone. Phase 2 rules exclude feature/infra work; a botched cutover
   on a single-VPS production is exactly the risk this phase exists to remove. The audit's
   real complaints — unused artifact, no rollback, tsx in prod, CI-less deploys — are all
   fixed by (b)+compile at a fraction of the blast radius.
2. **Compile instead of tsx-on-source (also fixes P1-6):** prod now executes the same
   artifact shape CI type-checked; type errors can no longer first surface at runtime;
   cluster workers start faster and drop the tsx/TS overhead. Verified: compiled API and
   worker boot cleanly and `@chirawa/types` (whose `main` points at `.ts` source) is
   type-only for the API, so nothing requires TS at runtime.
3. **One release script on the server, not YAML-embedded steps:** deploy, rollback, manual
   fallback and a 2 AM by-hand release are the same audited code path; the workflows shrink
   to "checkout SHA, run script".
4. **Exact-SHA releases (`git checkout --detach $SHA`), not `git pull origin main`:** the
   server runs what CI tested, immune to the race where main moves between gate and release;
   deploy and rollback become the same operation pointed at different SHAs.
5. **Rollback skips migrations by design:** Prisma has no down-migrations; pretending
   otherwise automates data loss. Old-code-on-newer-schema is safe under the existing
   additive/expand-contract migration norm; schema-level incidents route to the backup
   restore path (ADR 003).
6. **Keep building the image in CI:** ~2 min buys a continuously-verified escape hatch (VPS
   loss, future migration to containers/second node) — now compiled, dev-deps pruned,
   non-root, `HEALTHCHECK`, prisma CLI included for containerized `migrate deploy`.

## Consequences

- Deploys are impossible while CI is red; the previously-decorative gate is now structural.
- Rollback is one click / one command, 2–5 min, drilled via docs/ROLLBACK_DRILL.md.
- One-time server migration required (pnpm pin via corepack, explicit `NODE_ENV`, PM2
  process recreation for the dist script paths) — docs/DEPLOYMENT.md §4.
- pnpm is pinned to 9.15.9 (`packageManager`): the newest major that runs on the Node 20
  used by CI, the image and the server. Local newer standalone pnpm still works
  (`package-manager-strict=false`). Bumping to pnpm 11+ requires Node ≥ 22 everywhere first.
- Server still builds from source at release time (accepted: ~2–5 min rollbacks). If that
  ever hurts, the next step is shipping the CI-built image — the contingency artifact is the
  ready-made upgrade path.

## Revisit when

A second app server / autoscaling appears; deploy frequency makes 2–5 min releases painful;
or the team can spend a maintenance window on a supervised container cutover.
