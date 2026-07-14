-- Minimum internal launch hardening for survey idempotency and tag-based rich menus.

alter table public.survey_responses
  add column if not exists response_key text;

update public.survey_responses
set response_key = 'legacy:' || id::text
where response_key is null;

alter table public.survey_responses
  alter column response_key set not null;

create unique index if not exists survey_responses_response_key_idx
  on public.survey_responses (organization_id, response_key);

alter table public.rich_menu_rules
  add column if not exists tag_id uuid;

update public.rich_menu_rules
set tag_id = (conditions_json ->> 'tagId')::uuid
where tag_id is null
  and conditions_json ->> 'tagId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'rich_menu_rules_organization_tag_fkey'
      and conrelid = 'public.rich_menu_rules'::regclass
  ) then
    alter table public.rich_menu_rules
      add constraint rich_menu_rules_organization_tag_fkey
      foreign key (organization_id, tag_id)
      references public.tags (organization_id, id)
      on delete cascade;
  end if;
end
$$;

with ranked as (
  select
    id,
    row_number() over (
      partition by organization_id, tag_id
      order by priority asc, created_at asc, id asc
    ) as position
  from public.rich_menu_rules
  where is_active = true
    and tag_id is not null
)
update public.rich_menu_rules as rule
set is_active = false,
    updated_at = now()
from ranked
where ranked.id = rule.id
  and ranked.position > 1;

create unique index if not exists rich_menu_rules_one_active_tag_idx
  on public.rich_menu_rules (organization_id, tag_id)
  where is_active = true and tag_id is not null;

create index if not exists rich_menu_rules_tag_lookup_idx
  on public.rich_menu_rules (organization_id, tag_id, priority)
  where is_active = true;

create or replace function public.minimum_assign_contact_tag(
  target_organization_id uuid,
  target_contact_id uuid,
  target_tag_id uuid,
  target_source_type text,
  target_source_id text,
  target_assignment_key text,
  target_actor_profile_id uuid
)
returns table (
  assignment_id uuid,
  effective_added boolean,
  duplicate boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_assignment public.contact_tag_assignments%rowtype;
  was_effective boolean;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(
      target_organization_id::text || ':' || target_contact_id::text || ':' || target_tag_id::text,
      0
    )
  );

  if not exists (
    select 1 from public.contacts
    where organization_id = target_organization_id and id = target_contact_id
  ) then
    raise exception 'contact_not_found' using errcode = '23503';
  end if;

  if not exists (
    select 1 from public.tags
    where organization_id = target_organization_id and id = target_tag_id and is_active = true
  ) then
    raise exception 'tag_not_found' using errcode = '23503';
  end if;

  if target_actor_profile_id is not null and not exists (
    select 1 from public.organization_members
    where organization_id = target_organization_id and profile_id = target_actor_profile_id
  ) then
    raise exception 'actor_not_in_organization' using errcode = '23503';
  end if;

  select exists (
    select 1
    from public.contact_tag_assignments
    where organization_id = target_organization_id
      and contact_id = target_contact_id
      and tag_id = target_tag_id
      and removed_at is null
  ) into was_effective;

  select * into existing_assignment
  from public.contact_tag_assignments
  where organization_id = target_organization_id
    and assignment_key = target_assignment_key;

  if found and (
    existing_assignment.contact_id <> target_contact_id
    or existing_assignment.tag_id <> target_tag_id
    or existing_assignment.source_type <> target_source_type
    or existing_assignment.source_id is distinct from target_source_id
  ) then
    raise exception 'assignment_key_conflict' using errcode = '23505';
  end if;

  if found and existing_assignment.removed_at is null then
    return query select
      existing_assignment.id,
      coalesce((existing_assignment.metadata_json ->> 'effectiveAdded')::boolean, false),
      true;
    return;
  end if;

  if found then
    update public.contact_tag_assignments
    set removed_at = null,
        removed_by_profile_id = null,
        assigned_by_profile_id = target_actor_profile_id,
        assigned_at = now(),
        metadata_json = metadata_json || jsonb_build_object('effectiveAdded', not was_effective),
        updated_at = now()
    where id = existing_assignment.id
    returning * into existing_assignment;
  else
    insert into public.contact_tag_assignments (
      organization_id,
      contact_id,
      tag_id,
      source_type,
      source_id,
      assignment_key,
      assigned_by_profile_id,
      metadata_json
    ) values (
      target_organization_id,
      target_contact_id,
      target_tag_id,
      target_source_type,
      target_source_id,
      target_assignment_key,
      target_actor_profile_id,
      jsonb_build_object('effectiveAdded', not was_effective)
    ) returning * into existing_assignment;
  end if;

  return query select existing_assignment.id, not was_effective, false;
end
$$;

create or replace function public.minimum_remove_contact_tag(
  target_organization_id uuid,
  target_assignment_id uuid,
  target_actor_profile_id uuid
)
returns table (
  assignment_id uuid,
  contact_id uuid,
  tag_id uuid,
  effective_removed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  assignment public.contact_tag_assignments%rowtype;
  remains_effective boolean;
begin
  select * into assignment
  from public.contact_tag_assignments
  where organization_id = target_organization_id
    and id = target_assignment_id
    and removed_at is null;

  if not found then
    raise exception 'active_assignment_not_found' using errcode = 'P0002';
  end if;

  if target_actor_profile_id is not null and not exists (
    select 1 from public.organization_members
    where organization_id = target_organization_id and profile_id = target_actor_profile_id
  ) then
    raise exception 'actor_not_in_organization' using errcode = '23503';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      target_organization_id::text || ':' || assignment.contact_id::text || ':' || assignment.tag_id::text,
      0
    )
  );

  select * into assignment
  from public.contact_tag_assignments
  where organization_id = target_organization_id
    and id = target_assignment_id
    and removed_at is null;

  if not found then
    raise exception 'active_assignment_not_found' using errcode = 'P0002';
  end if;

  update public.contact_tag_assignments
  set removed_at = now(),
      removed_by_profile_id = target_actor_profile_id,
      updated_at = now()
  where id = assignment.id;

  select exists (
    select 1
    from public.contact_tag_assignments as remaining_assignment
    where remaining_assignment.organization_id = target_organization_id
      and remaining_assignment.contact_id = assignment.contact_id
      and remaining_assignment.tag_id = assignment.tag_id
      and remaining_assignment.removed_at is null
  ) into remains_effective;

  return query select assignment.id, assignment.contact_id, assignment.tag_id, not remains_effective;
end
$$;

revoke all on function public.minimum_assign_contact_tag(uuid, uuid, uuid, text, text, text, uuid) from public;
revoke all on function public.minimum_remove_contact_tag(uuid, uuid, uuid) from public;
grant execute on function public.minimum_assign_contact_tag(uuid, uuid, uuid, text, text, text, uuid) to service_role;
grant execute on function public.minimum_remove_contact_tag(uuid, uuid, uuid) to service_role;
