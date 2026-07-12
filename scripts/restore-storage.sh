#!/usr/bin/env bash
set -euo pipefail

[[ "${ALLOW_RESTORE:-}" == "YES" ]] || { echo "Set ALLOW_RESTORE=YES after human approval." >&2; exit 2; }
: "${STORAGE_BACKUP_MANIFEST:?Set STORAGE_BACKUP_MANIFEST to a reviewed manifest}"
echo "Review $STORAGE_BACKUP_MANIFEST and restore private line-media objects through Supabase Storage API."
echo "Direct writes to storage.objects are prohibited."
