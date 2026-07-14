#!/usr/bin/env bash
set -euo pipefail

echo "Storage setup is migration/API driven; this script performs no file upload and prints no credentials."
if command -v supabase >/dev/null 2>&1; then
  supabase db push --dry-run
else
  echo "supabase CLI is not installed; run: npx supabase db push --dry-run"
fi
echo "Human action: apply the reviewed migration, then verify private bucket line-media and its Storage policies in Supabase Dashboard."
