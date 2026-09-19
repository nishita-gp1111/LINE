-- Named assignees do not create login accounts or grant access to customer data.
alter table public.conversations add column if not exists assignee_name text;
alter table public.conversations drop constraint if exists conversations_assignee_name_check;
alter table public.conversations add constraint conversations_assignee_name_check
  check (assignee_name is null or (length(btrim(assignee_name)) between 1 and 40 and assignee_profile_id is null));

create table if not exists public.acquisition_assignment_rules (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  route_slug text not null check (route_slug in ('meeting', 'survey', 'hp')),
  staff_names text[] not null default '{}',
  enabled boolean not null default false,
  next_index bigint not null default 0 check (next_index >= 0),
  updated_at timestamptz not null default now(),
  primary key (organization_id, route_slug),
  check (cardinality(staff_names) <= 20),
  check (not enabled or cardinality(staff_names) > 0)
);

-- Keep a decision even after a manual change/unassignment. A repeated claim must
-- never reclaim that conversation or consume another round-robin position.
create table if not exists public.acquisition_assignment_decisions (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null,
  route_slug text not null,
  assigned_name text,
  outcome text not null check (outcome in ('assigned', 'preserved')),
  created_at timestamptz not null default now(),
  primary key (organization_id, contact_id),
  foreign key (organization_id, contact_id) references public.contacts(organization_id, id) on delete cascade
);

alter table public.acquisition_assignment_rules enable row level security;
alter table public.acquisition_assignment_decisions enable row level security;
revoke all on public.acquisition_assignment_rules, public.acquisition_assignment_decisions from anon, authenticated;
grant all on public.acquisition_assignment_rules, public.acquisition_assignment_decisions to service_role;

create or replace function public.save_acquisition_assignment_rule(
  target_organization_id uuid, target_actor_id uuid, target_route_slug text,
  target_staff_names text[], target_enabled boolean
) returns void language plpgsql security definer set search_path = public
as $$
declare names text[];
begin
  if not exists (select 1 from public.organization_members where organization_id = target_organization_id
    and profile_id = target_actor_id and role::text in ('owner', 'admin')) then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  select coalesce(array_agg(btrim(n) order by position), '{}'::text[]) into names
    from unnest(target_staff_names) with ordinality as input(n, position);
  if target_enabled is null or cardinality(names) > 20 or (target_enabled and cardinality(names) = 0)
    or exists (select 1 from unnest(names) n where n is null or length(n) not between 1 and 40)
    or (select count(*) from unnest(names) n) <> (select count(distinct n) from unnest(names) n) then
    raise exception 'Invalid assignee names' using errcode = '22023';
  end if;
  insert into public.acquisition_assignment_rules (organization_id, route_slug, staff_names, enabled)
  values (target_organization_id, target_route_slug, names, target_enabled)
  on conflict (organization_id, route_slug) do update
  set staff_names = excluded.staff_names, enabled = excluded.enabled,
      next_index = case when acquisition_assignment_rules.staff_names = excluded.staff_names
        then acquisition_assignment_rules.next_index else 0 end,
      updated_at = now();
end;
$$;

create or replace function public.assign_acquisition_contact(
  target_organization_id uuid, target_contact_id uuid, target_route_slug text
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  rule public.acquisition_assignment_rules%rowtype;
  conversation public.conversations%rowtype;
  selected_name text;
  conversation_id uuid;
begin
  -- The rule row is the shared counter lock for concurrent registrations.
  select * into rule from public.acquisition_assignment_rules
  where organization_id = target_organization_id and route_slug = target_route_slug for update;
  if not found or not rule.enabled then return jsonb_build_object('status', 'disabled'); end if;

  if not exists (select 1 from public.contacts where organization_id = target_organization_id and id = target_contact_id) then
    raise exception 'Contact not found' using errcode = '23503';
  end if;
  conversation_id := public.ensure_conversation_for_contact(target_organization_id, target_contact_id, now());
  -- Also serialize claims through different routes and manual assignment writes.
  select * into conversation from public.conversations where id = conversation_id for update;
  if exists (select 1 from public.acquisition_assignment_decisions
    where organization_id = target_organization_id and contact_id = target_contact_id) then
    return jsonb_build_object('status', 'duplicate');
  end if;

  if conversation.assignee_profile_id is not null or conversation.assignee_name is not null then
    insert into public.acquisition_assignment_decisions (organization_id, contact_id, route_slug, assigned_name, outcome)
    values (target_organization_id, target_contact_id, target_route_slug, conversation.assignee_name, 'preserved');
    return jsonb_build_object('status', 'preserved');
  end if;

  selected_name := rule.staff_names[(rule.next_index % cardinality(rule.staff_names))::integer + 1];
  update public.conversations set assignee_name = selected_name, updated_at = now() where id = conversation_id;
  insert into public.acquisition_assignment_decisions (organization_id, contact_id, route_slug, assigned_name, outcome)
  values (target_organization_id, target_contact_id, target_route_slug, selected_name, 'assigned');
  update public.acquisition_assignment_rules set next_index = next_index + 1
  where organization_id = target_organization_id and route_slug = target_route_slug;
  return jsonb_build_object('status', 'assigned');
end;
$$;

revoke all on function public.save_acquisition_assignment_rule(uuid, uuid, text, text[], boolean) from public, anon, authenticated;
revoke all on function public.assign_acquisition_contact(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.save_acquisition_assignment_rule(uuid, uuid, text, text[], boolean) to service_role;
grant execute on function public.assign_acquisition_contact(uuid, uuid, text) to service_role;
