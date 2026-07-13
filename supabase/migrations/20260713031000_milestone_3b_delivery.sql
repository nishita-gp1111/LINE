-- Milestone 3B: media, templates, campaigns, compact batches and scheduler jobs.

create table public.media_assets (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_type text not null check (asset_type in ('image','video','audio','preview_image')), name text not null check (char_length(btrim(name)) between 1 and 200),
  storage_bucket text not null default 'line-public-media', storage_path text not null, public_url text not null,
  preview_asset_id uuid, mime_type text not null, size_bytes bigint not null check (size_bytes > 0),
  duration_ms integer check (duration_ms is null or duration_ms > 0), width integer, height integer, checksum_sha256 text,
  status text not null default 'uploading' check (status in ('uploading','ready','rejected','deleted')),
  uploaded_by_profile_id uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (organization_id, id), unique (organization_id, storage_path),
  foreign key (organization_id, preview_asset_id) references public.media_assets(organization_id, id) on delete no action
);
create index media_assets_org_status_idx on public.media_assets (organization_id, status, created_at desc);

create table public.message_templates (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100), description text not null default '', status text not null default 'active' check (status in ('active','inactive')),
  created_by_profile_id uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (organization_id, id), unique (organization_id, name)
);
create table public.message_template_items (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, template_id uuid not null,
  item_order integer not null check (item_order between 0 and 4), message_type text not null check (message_type in ('text','image','video','audio')),
  text_content text, media_asset_id uuid, payload_json jsonb not null default '{}'::jsonb, alt_text text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (organization_id, template_id, item_order),
  foreign key (organization_id, template_id) references public.message_templates(organization_id, id) on delete cascade,
  foreign key (organization_id, media_asset_id) references public.media_assets(organization_id, id) on delete no action
);
create index message_template_items_template_idx on public.message_template_items (organization_id, template_id, item_order);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, name text not null check (char_length(btrim(name)) between 1 and 150), description text not null default '',
  status text not null default 'draft' check (status in ('draft','validating','ready','approved','scheduled','preparing','sending','completed','partially_failed','paused_quota','paused_manual','cancelled','failed')),
  delivery_mode text not null default 'multicast' check (delivery_mode in ('multicast','broadcast')), segment_id uuid,
  message_snapshot_json jsonb not null default '[]'::jsonb, scheduled_at timestamptz, approved_at timestamptz, approved_by_profile_id uuid references public.profiles(id) on delete set null,
  estimated_recipients integer not null default 0 check (estimated_recipients >= 0), excluded_recipients integer not null default 0 check (excluded_recipients >= 0), accepted_recipients integer not null default 0 check (accepted_recipients >= 0), failed_batches integer not null default 0 check (failed_batches >= 0),
  quota_total_snapshot integer, quota_used_snapshot integer, reserve_percent_snapshot integer not null default 3, started_at timestamptz, completed_at timestamptz, cancelled_at timestamptz,
  created_by_profile_id uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, segment_id) references public.segments(organization_id, id) on delete no action
);
create index campaigns_org_status_schedule_idx on public.campaigns (organization_id, status, scheduled_at);

create table public.campaign_batches (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, campaign_id uuid not null,
  batch_number integer not null check (batch_number > 0), contact_ids uuid[] not null check (cardinality(contact_ids) between 1 and 500), recipient_count integer not null check (recipient_count between 1 and 500), audience_hash text not null,
  retry_key uuid not null default gen_random_uuid(), status text not null default 'pending' check (status in ('pending','sending','accepted','retry_wait','failed','cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0), line_request_id text, line_accepted_request_id text, accepted_at timestamptz, next_retry_at timestamptz, last_error_class text, last_error_safe text,
  lease_owner text, lease_expires_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (organization_id, campaign_id, batch_number), unique (organization_id, retry_key), foreign key (organization_id, campaign_id) references public.campaigns(organization_id, id) on delete cascade
);
create index campaign_batches_dispatch_idx on public.campaign_batches (organization_id, status, next_retry_at, lease_expires_at);

create table public.campaign_events (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, campaign_id uuid not null, event_type text not null, metadata_redacted_json jsonb not null default '{}'::jsonb, profile_id uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(), foreign key (organization_id, campaign_id) references public.campaigns(organization_id, id) on delete cascade
);
create index campaign_events_campaign_created_idx on public.campaign_events (organization_id, campaign_id, created_at desc);

create table public.scheduled_jobs (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, job_type text not null, resource_type text not null, resource_id uuid,
  contact_id uuid, run_at timestamptz not null, status text not null default 'pending' check (status in ('pending','leased','running','succeeded','retry_wait','failed','cancelled')), priority integer not null default 0,
  attempt_count integer not null default 0, max_attempts integer not null default 3, idempotency_key text not null, lease_owner text, lease_expires_at timestamptz, next_retry_at timestamptz, payload_json jsonb not null default '{}'::jsonb, last_error_class text, last_error_safe text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz, unique (organization_id, idempotency_key), foreign key (organization_id, contact_id) references public.contacts(organization_id, id) on delete cascade
);
create index scheduled_jobs_dispatch_idx on public.scheduled_jobs (status, run_at, priority desc);
create index scheduled_jobs_lease_idx on public.scheduled_jobs (status, lease_expires_at);

do $$ declare table_name text; begin
  foreach table_name in array array['media_assets','message_templates','message_template_items','campaigns','campaign_batches','campaign_events','scheduled_jobs'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('create policy %I_select_member on public.%I for select to authenticated using (public.is_organization_member(organization_id))', table_name, table_name);
    execute format('create policy %I_manage_admin on public.%I for all to authenticated using (public.is_organization_admin(organization_id)) with check (public.is_organization_admin(organization_id))', table_name, table_name);
  end loop;
end $$;

comment on table public.media_assets is 'Public LINE delivery media only; do not store PII. Storage bucket setup is manual.';
comment on table public.campaign_batches is 'Compact UUID audience snapshots; LINE user IDs are resolved immediately before dispatch.';
