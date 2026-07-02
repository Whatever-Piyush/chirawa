#!/usr/bin/env bash
# Manual deploy fallback — use ONLY when GitHub Actions is unavailable.
# Normal path: push/merge to main → deploy.yml (CI-gated). This bypasses the
# CI gate, so run `pnpm typecheck && pnpm test:all` yourself first.
#
#   CHIRAWA_SSH_HOST=appuser@<server-ip> bash scripts/deploy.sh
#
# Deploys the CURRENT LOCAL COMMIT; it must already be pushed to origin
# (the server pulls from git — it never receives code from your machine).
set -euo pipefail

HOST="${CHIRAWA_SSH_HOST:?Set CHIRAWA_SSH_HOST=appuser@<server-ip> — see docs/DEPLOYMENT.md}"
SHA=$(git rev-parse HEAD)

if ! git branch -r --contains "$SHA" 2>/dev/null | grep -q .; then
  echo "❌ HEAD ($SHA) is not on any remote branch — push it first" >&2
  exit 1
fi

echo "🚀 Manual deploy of $SHA — CI gate BYPASSED (typecheck + tests are on you)"

ssh "$HOST" bash -s -- "$SHA" <<'REMOTE'
set -euo pipefail
SHA="$1"
cd /opt/chirawa
git fetch origin
git checkout --detach "$SHA"
bash scripts/server-release.sh
REMOTE

echo "✅ Manual deploy complete — verify: curl -s https://api.chirawa.in/health"
