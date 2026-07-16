-- Keep LINE mark-as-read tokens server-side. Authenticated browser clients must
-- never be able to read or mutate these one-time webhook capabilities.
create table public.line_message_read_tokens (
  message_id uuid primary key references public.messages(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mark_as_read_token text not null check (char_length(mark_as_read_token) between 1 and 2048),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index line_message_read_tokens_organization_idx
  on public.line_message_read_tokens (organization_id, updated_at desc);

alter table public.line_message_read_tokens enable row level security;

revoke all on table public.line_message_read_tokens from anon, authenticated;
grant all on table public.line_message_read_tokens to service_role;
