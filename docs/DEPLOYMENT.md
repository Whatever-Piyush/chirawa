# Deployment — How Code Reaches Production

**Scope:** the API + worker on the Hetzner VPS (PM2). The three Expo apps ship through
EAS/store builds and are not covered here. Decisions and trade-offs behind this pipeline:
`docs/adr/004-deploy-pipeline.md`. Rollback runbook: `docs/ROLLBACK_DRILL.md`.

**The one rule:** a push to `main` IS a production deploy. Nothing reaches `main` without
passing CI, and nothing reaches the server except the exact SHA that CI tested.

---

## 1. Architecture

```
 PR → CI (typecheck + 400+ tests + Docker-image build check)
  │
  ▼ merge to main
 deploy.yml
  ├── job: ci      — the SAME CI workflow, called as a reusable gate (red CI = no deploy)
  └── job: deploy  — needs ci, environment: production
        │  SSH as appuser → /opt/chirawa
        │  git fetch && git checkout --detach <tested SHA>
        ▼
      scripts/server-release.sh          ← single source of truth for release steps
        1. pnpm install --frozen-lockfile
        2. prisma generate                (explicit — pnpm blocks postinstall scripts)
        3. pnpm build → apps/api/dist     (PM2 runs compiled JS, never tsx-on-source)
        4. env:check                      (bad .env fails HERE, old release keeps serving)
        5. db:migrate:prod                (backup-guarded; aborts without a verified backup)
        6. pm2 startOrReload              (zero-downtime cluster reload)
        7. local health gate              (127.0.0.1:3000/health must return 200)
        8. append /var/log/chirawa/deploy-history.log
        │
        ▼
      public health gate (https://api.chirawa.in/health from the Actions runner)
```

**On the server:** `/opt/chirawa` is a git checkout (detached at the deployed SHA).
PM2 runs `api` (4× cluster, `dist/index.js`) and `worker` (1× fork, `dist/worker/index.js`)
per `apps/api/ecosystem.config.js`. Nginx terminates TLS for `api.chirawa.in` and proxies
to :3000. Secrets live only in `/opt/chirawa/apps/api/.env` (never in git, never in CI).

## 2. Normal deploy — step by step

1. Open a PR against `main`. CI must be green (typecheck API + types package, unit tests
   against real Postgres/Redis services, Docker image build check).
2. Merge. `deploy.yml` re-runs CI as the gate job, then releases **`github.sha`** — the
   merge commit CI just tested — via `scripts/server-release.sh`. The server never runs
   "whatever main is now"; a race with a later push cannot change what this deploy ships.
3. Watch the run (Actions → Deploy to Hetzner). The deploy is done only when the public
   health gate passes.
4. If anything fails after the PM2 reload, roll back (one click / one command —
   `docs/ROLLBACK_DRILL.md`). If it fails before the reload, the old release never stopped
   serving; fix and re-push.

Concurrency: deploys and rollbacks share one lock (`production-deploy`) — they queue, never
interleave. Migrations are backup-guarded by `scripts/migrate-with-backup.ts` (see
`docs/DISASTER_RECOVERY.md`).

## 3. Gates that can stop a deploy (by design)

| Gate | Where | What it catches |
|---|---|---|
| CI job (`needs: ci`) | Actions | type errors, failing tests, unbuildable Docker image |
| `env:check` preflight | server, before migrate/reload | missing NODE_ENV, placeholder Razorpay/Fast2SMS/R2 creds, localhost URLs, template JWT keys |
| Backup-guarded migration | server | migration without a verified pre-migration backup |
| Local health gate | server | process boots but doesn't serve |
| Public health gate | Actions runner | nginx/TLS/DNS layer broken even though the process is up |

## 4. ONE-TIME server migration (this phase's changes)

Run once on the server before the first deploy from this pipeline; each step is idempotent.

```bash
# 1. pnpm must match package.json "packageManager" (corepack keeps it pinned)
corepack enable && corepack prepare pnpm@11.3.0 --activate && pnpm --version   # → 11.3.0

# 2. NODE_ENV no longer defaults — it must be explicit in the server env file
grep -q '^NODE_ENV=production' /opt/chirawa/apps/api/.env || \
  echo 'NODE_ENV=production' >> /opt/chirawa/apps/api/.env

# 3. Preflight the production .env — placeholders that used to boot now hard-fail.
#    Fix every ❌ (real Fast2SMS + R2 credentials, real FRONTEND_URLS/R2_PUBLIC_URL)
#    BEFORE merging this phase, or the first deploy will (correctly) refuse.
cd /opt/chirawa && NODE_ENV=production pnpm --filter @chirawa/api env:check

# 4. PM2 script paths changed (tsx → dist) — reload does NOT apply script-path
#    changes, so recreate the processes once:
cd /opt/chirawa && pnpm install --frozen-lockfile \
  && pnpm --filter @chirawa/api exec prisma generate \
  && pnpm --filter @chirawa/api build \
  && pm2 delete api worker \
  && pm2 start apps/api/ecosystem.config.js --env production \
  && pm2 save
```

## 5. Manual deploy (GitHub Actions down)

```bash
CHIRAWA_SSH_HOST=appuser@<server-ip> bash scripts/deploy.sh
```

Deploys the current local commit (must be pushed to origin). **This bypasses the CI gate** —
run `pnpm typecheck && pnpm test:all` yourself first. It runs the same
`scripts/server-release.sh` as Actions, so every other gate still applies.

## 6. GitHub configuration

Secrets (repo → Settings → Secrets → Actions): `HETZNER_HOST`, `HETZNER_SSH_KEY`,
`JWT_PRIVATE_KEY_TEST`, `JWT_PUBLIC_KEY_TEST` — see `docs/github-secrets.md`.
The deploy no longer pushes Docker images, so no registry credentials are involved.
Recommended (Settings → Environments → `production`): required reviewers if you ever want
a human approval step between green CI and the release.

## 7. The Docker image (contingency artifact)

CI builds the image on every PR to prove it stays deployable, but nothing runs it — the
active deploy path is PM2 + compiled `dist/` from the git checkout (`docs/adr/004`).
The image compiles TS, prunes dev dependencies, runs as non-root with a `HEALTHCHECK`,
and includes the prisma CLI so a containerized `migrate deploy` is possible. If the VPS
dies and must be rebuilt fast, `docker build` + `docker run --env-file` is the escape hatch.

## 8. Validation checklist

Before merging to main:
- [ ] CI green on the PR (typecheck, tests, image build)
- [ ] If env vars were added/renamed: schema updated (`env.schema.ts`), `.env.example`
      updated, **production `.env` on the server updated first**
- [ ] If a migration is included: additive/expand-contract (rollback never undoes
      migrations), and you know the pre-migration backup will run
- [ ] If `ecosystem.config.js` script/exec_mode changed: plan the one-time
      `pm2 delete && pm2 start` (§4 step 4)

During the deploy:
- [ ] Actions run green through both jobs, including the public health gate

After the deploy:
- [ ] `curl -s https://api.chirawa.in/health` → `"status":"ok"`, sensible `uptimeSeconds`
- [ ] `pm2 status` on the server: `api` ×4 + `worker` online, restart counters not climbing
- [ ] No new errors: `pm2 logs api --lines 50 --nostream` (and Sentry, once DSN is set)
- [ ] New line in `/var/log/chirawa/deploy-history.log` with the deployed SHA
