# LINE CRM contribution guide

## Scope

This repository implements the internal, single-account LINE CRM described in the
Milestone specification. Work one milestone at a time. Milestone 0 contains only the
application foundation: Next.js, auth, protected admin routes, Supabase RLS basics,
mock mode, tests, and documentation.

Do not implement LINE Webhook, contacts, Inbox, campaigns, surveys, survey actions,
reservations, rich menus, or analytics until the corresponding milestone is active.

## Rules

- Use TypeScript strict mode; do not introduce `any`.
- Use App Router and Server Components by default.
- Keep database access on the server. Never expose `SUPABASE_SERVICE_ROLE_KEY` to the browser.
- Missing Supabase public credentials must keep the app in mock mode and must not call external services.
- Protect admin routes at the proxy/server boundary, not only with client redirects.
- Use UTC for persisted timestamps and Asia/Tokyo for display decisions.
- Use idempotent SQL migrations under `supabase/migrations/`.
- Never put secrets, tokens, or real customer data in source, tests, fixtures, or logs.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```
