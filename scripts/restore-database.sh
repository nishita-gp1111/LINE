#!/usr/bin/env bash
set -euo pipefail

[[ "${ALLOW_RESTORE:-}" == "YES" ]] || { echo "Set ALLOW_RESTORE=YES after human approval." >&2; exit 2; }
: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL only in a secure shell environment}"
: "${BACKUP_FILE:?Set BACKUP_FILE to a reviewed custom-format dump}"
command -v pg_restore >/dev/null 2>&1 || { echo "pg_restore is required" >&2; exit 2; }
pg_restore --clean --if-exists --no-owner --dbname "$SUPABASE_DB_URL" "$BACKUP_FILE"
