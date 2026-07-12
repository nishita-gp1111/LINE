-- Milestone 3A: tag provenance, typed custom fields, suppression and safe segments.
-- Existing migrations are intentionally left unchanged. Apply this file after Milestone 2.

create table public.tag_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  description text not null default '' check (char_length(description) <= 500),
  is_exclusive boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tag_group_id uuid references public.tag_groups(id) on delete set null,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  description text not null default '' check (char_length(description) <= 500),
  color_token text not null default 'moss' check (color_token ~ '^[a-z0-9-]{1,40}$'),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, tag_group_id) references public.tag_groups(organization_id, id)
);
create unique index tags_active_name_idx on public.tags (organization_id, lower(name)) where is_active;
create index tags_group_idx on public.tags (organization_id, tag_group_id, sort_order);

create table public.contact_tag_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null,
  tag_id uuid not null,
  source_type text not null check (source_type in ('manual','survey','automation','campaign','form','import','system')),
  source_id text,
  assignment_key text not null,
  assigned_by_profile_id uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by_profile_id uuid references public.profiles(id) on delete set null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, assignment_key),
  foreign key (organization_id, contact_id) references public.contacts(organization_id, id) on delete cascade,
  foreign key (organization_id, tag_id) references public.tags(organization_id, id) on delete cascade
);
create index contact_tag_assignments_active_idx on public.contact_tag_assignments (organization_id, contact_id, tag_id) where removed_at is null;
create index contact_tag_assignments_tag_idx on public.contact_tag_assignments (organization_id, tag_id) where removed_at is null;

create table public.custom_field_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,63}$'),
  field_type text not null check (field_type in ('text','long_text','number','date','datetime','boolean','single_select','multi_select')),
  description text not null default '' check (char_length(description) <= 500),
  options_json jsonb not null default '[]'::jsonb,
  is_required boolean not null default false,
  is_active boolean not null default true,
  is_segmentable boolean not null default true,
  sort_order integer not null default 0,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, key)
);
create index custom_field_definitions_segmentable_idx on public.custom_field_definitions (organization_id, is_active, is_segmentable, sort_order);

create table public.contact_custom_values (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null,
  field_id uuid not null references public.custom_field_definitions(id) on delete restrict,
  value_text text,
  value_number numeric,
  value_boolean boolean,
  value_date date,
  value_datetime timestamptz,
  value_json jsonb,
  source_type text not null default 'manual' check (source_type in ('manual','survey','automation','import','system')),
  source_id text,
  updated_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, contact_id, field_id),
  foreign key (organization_id, contact_id) references public.contacts(organization_id, id) on delete cascade,
  foreign key (organization_id, field_id) references public.custom_field_definitions(organization_id, id) on delete restrict,
  check (num_nonnulls(value_text, value_number, value_boolean, value_date, value_datetime, value_json) <= 1)
);
create index contact_custom_values_field_value_idx on public.contact_custom_values (organization_id, field_id, value_text, value_number);

create table public.contact_delivery_preferences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null,
  marketing_status text not null default 'eligible' check (marketing_status in ('eligible','suppressed','transactional_only')),
  suppression_reason text check (suppression_reason is null or char_length(suppression_reason) <= 500),
  suppressed_at timestamptz,
  suppressed_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, contact_id),
  foreign key (organization_id, contact_id) references public.contacts(organization_id, id) on delete cascade
);
create index contact_delivery_preferences_org_status_idx on public.contact_delivery_preferences (organization_id, marketing_status);

create table public.segments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  description text not null default '' check (char_length(description) <= 500),
  conditions_json jsonb not null default '{"conjunction":"and","conditions":[],"groups":[]}'::jsonb,
  status text not null default 'active' check (status in ('active','inactive')),
  is_dynamic boolean not null default true,
  last_estimated_count integer check (last_estimated_count is null or last_estimated_count >= 0),
  last_evaluated_at timestamptz,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);
create index segments_organization_status_idx on public.segments (organization_id, status, updated_at desc);

create or replace function public.m3a_is_deliverable(target_organization_id uuid, target_contact_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.contacts c
    left join public.contact_delivery_preferences p on p.organization_id = c.organization_id and p.contact_id = c.id
    where c.organization_id = target_organization_id and c.id = target_contact_id
      and c.friend_status = 'following'
      and coalesce(p.marketing_status, 'eligible') = 'eligible'
  );
$$;
revoke execute on function public.m3a_is_deliverable(uuid, uuid) from public;
grant execute on function public.m3a_is_deliverable(uuid, uuid) to service_role;

do $$ declare table_name text; begin
  foreach table_name in array array['tag_groups','tags','contact_tag_assignments','custom_field_definitions','contact_custom_values','contact_delivery_preferences','segments'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('create policy %I_select_member on public.%I for select to authenticated using (public.is_organization_member(organization_id))', table_name, table_name);
    execute format('create policy %I_manage_admin on public.%I for all to authenticated using (public.is_organization_admin(organization_id)) with check (public.is_organization_admin(organization_id))', table_name, table_name);
  end loop;
end $$;
