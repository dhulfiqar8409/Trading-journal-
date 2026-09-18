#!/usr/bin/env bash
# Dumps the Darkpools PostgreSQL database from the docker compose "db" service
# into a timestamped, gzip-compressed SQL file.
#
#   scripts/backup-db.sh                # writes ./backups/darkpools-YYYYmmdd-HHMMSS.sql.gz
#   BACKUP_DIR=/srv/backups scripts/backup-db.sh
#   BACKUP_KEEP=30 scripts/backup-db.sh # keep the newest 30 dumps (default 14, 0 = keep all)
#
# Restore with:
#   gunzip -c backups/darkpools-....sql.gz | docker compose exec -T db psql -U darkpools -d darkpools
set -euo pipefail

cd "$(dirname "$0")/.."

BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"
DB_USER="${POSTGRES_USER:-darkpools}"
DB_NAME="${POSTGRES_DB:-darkpools}"

mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%d-%H%M%S)"
file="$BACKUP_DIR/darkpools-$stamp.sql.gz"
tmp="$file.part"

docker compose exec -T db pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges | gzip -9 > "$tmp"
mv "$tmp" "$file"
echo "Wrote $file ($(du -h "$file" | cut -f1))"

if [ "$BACKUP_KEEP" -gt 0 ]; then
  ls -1t "$BACKUP_DIR"/darkpools-*.sql.gz 2>/dev/null | tail -n +$((BACKUP_KEEP + 1)) | xargs -r rm -f --
fi
