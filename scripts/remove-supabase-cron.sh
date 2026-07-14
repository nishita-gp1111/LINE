#!/usr/bin/env bash
set -euo pipefail

echo "Remove only these named jobs after human confirmation: line-crm-dispatch and line-crm-maintenance."
echo "Use Supabase SQL editor or psql with SUPABASE_DB_URL from a secure environment; no secret is read or printed by this script."
echo "select cron.unschedule('line-crm-dispatch');"
echo "select cron.unschedule('line-crm-maintenance');"
