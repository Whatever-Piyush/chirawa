#!/usr/bin/env bash
# What every production release runs ON THE SERVER (/opt/chirawa), after the
# target commit has been checked out. Single source of truth for the release
# steps — deploy.yml, rollback.yml, scripts/rollback.sh and scripts/deploy.sh
# all funnel here. Documented step-by-step in docs/DEPLOYMENT.md.
#
# Usage (on the server, from /opt/chirawa):
#   bash scripts/server-release.sh                    # deploy: runs migrations
#   SKIP_MIGRATIONS=1 bash scripts/server-release.sh  # rollback: skips them
set -euo pipefail

export NODE_ENV=production
cd /opt/chirawa

SHA=$(git rev-parse HEAD)
if [ "${SKIP_MIGRATIONS:-0}" = "1" ]; then MODE=rollback; else MODE=deploy; fi
echo "── release $SHA ($MODE) ──"

# 1. Dependencies — exact lockfile, no drift
pnpm install --frozen-lockfile

# 2. Prisma client — pnpm blocks dependency postinstall scripts (pnpm.yaml
#    onlyBuiltDependencies), so generation must be explicit or it goes stale
pnpm --filter @chirawa/api exec prisma generate

# 3. Compile TypeScript — PM2 runs dist/, never tsx-on-source. Clean first:
#    tsc doesn't delete outputs for files that no longer exist, and stale
#    compiled modules from a previous release are exactly the kind of ghost a
#    rollback drill can't reproduce.
rm -rf apps/api/dist
pnpm --filter @chirawa/api build

# 4. Env preflight — a bad .env fails HERE, while the old release still serves
pnpm --filter @chirawa/api env:check

# 5. Migrations — backup-guarded (scripts/migrate-with-backup.ts aborts unless
#    a verified pre-migration backup succeeded). Skipped on rollback: schema
#    migrations are forward-only; undoing one means a DB restore, which is a
#    deliberate human decision (docs/ROLLBACK_DRILL.md, docs/DISASTER_RECOVERY.md).
if [ "$MODE" = "deploy" ]; then
  pnpm --filter @chirawa/api db:migrate:prod
else
  echo "SKIP_MIGRATIONS=1 — not running migrations (rollback mode)"
fi

# 6. Zero-downtime reload. NOTE: pm2 reload does NOT apply script-path changes
#    to already-running apps — after editing ecosystem.config.js script/exec_mode,
#    run once: pm2 delete api worker && pm2 start apps/api/ecosystem.config.js --env production && pm2 save
pm2 startOrReload apps/api/ecosystem.config.js --env production --update-env
pm2 save

# 7. Local health gate — don't report success for a dead process
STATUS=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  sleep 3
  STATUS=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/health || true)
  [ "$STATUS" = "200" ] && break
done
if [ "$STATUS" != "200" ]; then
  echo "❌ local health check FAILED (last status: ${STATUS:-none})"
  pm2 logs api --lines 30 --nostream || true
  exit 1
fi

# 8. Record history — scripts/server-previous-release.sh reads this to resolve
#    "previous release" for rollbacks. Only successful releases are recorded.
mkdir -p /var/log/chirawa
echo "$(date -u +%FT%TZ) $MODE $SHA" >> /var/log/chirawa/deploy-history.log

echo "✅ release complete: $SHA ($MODE)"
