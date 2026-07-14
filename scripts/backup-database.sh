#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL only in a secure shell environment}"
output_dir="${BACKUP_OUTPUT_DIR:-./backups}"
mkdir -p "$output_dir"
file="$output_dir/line-crm-$(date -u +%Y%m%dT%H%M%SZ).dump"
command -v pg_dump >/dev/null 2>&1 || { echo "pg_dump is required" >&2; exit 2; }
pg_dump --format=custom --no-owner --file "$file" "$SUPABASE_DB_URL"
echo "Database backup written to $file"
