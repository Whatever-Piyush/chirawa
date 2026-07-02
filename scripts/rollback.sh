#!/usr/bin/env bash
# One-command production rollback — SSH fallback for when GitHub Actions is
# unavailable (otherwise prefer: Actions → "Rollback production" → Run workflow).
#
#   CHIRAWA_SSH_HOST=appuser@<server-ip> bash scripts/rollback.sh          # previous release
#   CHIRAWA_SSH_HOST=appuser@<server-ip> bash scripts/rollback.sh <sha>    # specific commit
#
# Skips DB migrations by design (forward-only policy). Full runbook, including
# when NOT to roll back: docs/ROLLBACK_DRILL.md.
set -euo pipefail

HOST="${CHIRAWA_SSH_HOST:?Set CHIRAWA_SSH_HOST=appuser@<server-ip> — see docs/ROLLBACK_DRILL.md}"
TARGET="${1:-}"

ssh "$HOST" bash -s -- "$TARGET" <<'REMOTE'
set -euo pipefail
TARGET="${1:-}"
cd /opt/chirawa
if [ -z "$TARGET" ]; then
  TARGET=$(bash scripts/server-previous-release.sh)
fi
echo "⏪ Rolling back to $TARGET"
git fetch origin
git checkout --detach "$TARGET"
SKIP_MIGRATIONS=1 bash scripts/server-release.sh
REMOTE

echo "✅ Rollback complete — verify from outside: curl -s https://api.chirawa.in/health"
