-- Milestone 3G: launch checklist, scheduler heartbeat and usage snapshots.
create table public.scheduler_heartbeats (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, provider text not null, status text not null check (status in ('healthy','stale','failed')), last_started_at timestamptz, last_completed_at timestamptz, last_error_safe text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (organization_id, provider)
);
create table public.usage_snapshots (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, snapshot_at timestamptz not null default now(), metric_key text not null, value_number numeric not null default 0, warning_threshold numeric, stop_threshold numeric, metadata_json jsonb not null default '{}', unique (organization_id, snapshot_at, metric_key)
);
create table public.launch_checklist (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, item_key text not null, status text not null default 'pending' check (status in ('pending','confirmed','blocked')), confirmed_by_profile_id uuid references public.profiles(id) on delete set null, confirmed_at timestamptz, notes_safe text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (organization_id, item_key)
);
create index usage_snapshots_metric_idx on public.usage_snapshots (organization_id, metric_key, snapshot_at desc);
do $$ declare table_name text; begin foreach table_name in array array['scheduler_heartbeats','usage_snapshots','launch_checklist'] loop execute format('alter table public.%I enable row level security', table_name); execute format('create policy %I_select_member on public.%I for select to authenticated using (public.is_organization_member(organization_id))', table_name, table_name); execute format('create policy %I_manage_admin on public.%I for all to authenticated using (public.is_organization_admin(organization_id)) with check (public.is_organization_admin(organization_id))', table_name, table_name); end loop; end $$;
