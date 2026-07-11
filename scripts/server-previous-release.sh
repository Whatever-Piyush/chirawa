#!/usr/bin/env bash
# Prints the SHA of the previous release — the most recent entry in the deploy
# history whose SHA differs from the currently checked-out commit. Run ON THE
# SERVER. Used by rollback.yml / scripts/rollback.sh to resolve "roll back to
# whatever ran before this".
#
# Works after a half-failed deploy too: history only records SUCCESSFUL
# releases, so if the checkout advanced but the release died, the last history
# line is already the last-good SHA.
set -euo pipefail

cd /opt/chirawa
HIST=/var/log/chirawa/deploy-history.log

if [ ! -f "$HIST" ]; then
  echo "No deploy history at $HIST — pass an explicit SHA to roll back to" >&2
  exit 1
fi

HEAD_SHA=$(git rev-parse HEAD)
TARGET=$(awk -v cur="$HEAD_SHA" '$3 != cur && $3 != "" { t = $3 } END { print t }' "$HIST")

if [ -z "$TARGET" ]; then
  echo "No previous release distinct from $HEAD_SHA found in $HIST — pass an explicit SHA" >&2
  exit 1
fi

echo "$TARGET"
