#!/usr/bin/env bash
#
# Nightly Postgres backup for Bringly (Phase 4.11).
# Dumps the DB with pg_dump (custom format), keeps a local rotation, and
# optionally ships off-box to S3/R2. Run from cron, e.g.:
#
#   0 2 * * *  /opt/chirawa/apps/api/scripts/backup-postgres.sh >> /var/log/chirawa/backup.log 2>&1
#
# Required env:
#   DATABASE_URL              postgres connection string (same as the API uses)
# Optional env:
#   BACKUP_DIR                local dir for dumps        (default: /var/backups/chirawa)
#   BACKUP_RETENTION_DAYS     local retention            (default: 14)
#   BACKUP_S3_BUCKET          e.g. s3://chirawa-backups  (uploads if set)
#   AWS_* / R2 creds          read by the aws cli if S3 upload is used
#
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/chirawa}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="${BACKUP_DIR}/chirawa-${STAMP}.dump"

mkdir -p "${BACKUP_DIR}"

echo "[backup] $(date -u) dumping → ${FILE}"
# -Fc = custom format (compressed, restorable with pg_restore). --no-owner keeps
# restores portable across roles.
pg_dump "${DATABASE_URL}" -Fc --no-owner --no-privileges -f "${FILE}"

SIZE="$(du -h "${FILE}" | cut -f1)"
echo "[backup] wrote ${FILE} (${SIZE})"

# Off-box copy (strongly recommended — a backup on the same box is not a backup).
if [[ -n "${BACKUP_S3_BUCKET:-}" ]]; then
  echo "[backup] uploading → ${BACKUP_S3_BUCKET}/"
  aws s3 cp "${FILE}" "${BACKUP_S3_BUCKET}/" --only-show-errors
fi

# Local rotation.
find "${BACKUP_DIR}" -name 'chirawa-*.dump' -mtime "+${RETENTION_DAYS}" -delete
echo "[backup] done; pruned dumps older than ${RETENTION_DAYS} days"

# ── Restore runbook (test this at least once — an untested backup is a guess) ──
#
#   1. Provision/empty target DB:   createdb chirawa_restore
#   2. Restore:                     pg_restore --no-owner --clean --if-exists \
#                                      -d "postgresql://USER:PASS@HOST:5432/chirawa_restore" \
#                                      chirawa-YYYYMMDDTHHMMSSZ.dump
#   3. Point a staging API at chirawa_restore and smoke-test the Launch Gate.
#   4. Record the restore time + row counts so you trust the process.
