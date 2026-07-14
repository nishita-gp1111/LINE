#!/usr/bin/env bash
set -euo pipefail

echo "Run the Milestone 3H migration first, then configure CRON_SECRET in Supabase Vault."
echo "This script never accepts or prints a secret. It only validates the migration plan."
if command -v supabase >/dev/null 2>&1; then
  supabase db push --dry-run
else
  echo "supabase CLI is not installed; run: npx supabase db push --dry-run"
fi
echo "After human review, register idempotent pg_cron jobs using docs/scheduler-supabase-cron.md."
