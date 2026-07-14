#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_PROJECT_REF:?Set SUPABASE_PROJECT_REF only in a secure shell environment}"
echo "Storage backup requires a human-approved Supabase Storage export/API procedure for private bucket line-media."
echo "This script intentionally does not download or claim a backup was taken. Record the export artifact and checksum in the launch checklist."
