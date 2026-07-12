#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${SUPABASE_PROJECT_REF:-}" ]]; then
  echo "Set SUPABASE_PROJECT_REF in the secure shell environment to inspect the project." >&2
  exit 2
fi
echo "Run the Supabase Dashboard/API bucket check for private line-media and organization-path RLS."
echo "This check intentionally does not print SUPABASE_SERVICE_ROLE_KEY or private object URLs."
