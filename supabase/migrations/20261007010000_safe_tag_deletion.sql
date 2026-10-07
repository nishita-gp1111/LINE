-- Delete from daily use without erasing provenance, survey answers or messages.
-- No existing rows are modified by applying this migration.
create or replace function public.manage_crm_tag_deletion(
  target_organization_id uuid, target_actor_profile_id uuid, target_tag_id uuid,
  perform_delete boolean default false, expected_name text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  selected_tag public.tags%rowtype;
  dependency record;
  usage_count integer;
  contact_count integer;
  assignment_count integer;
  blockers jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from public.organization_members where organization_id = target_organization_id
    and profile_id = target_actor_profile_id and role in ('owner', 'admin')) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if perform_delete then
    -- Serialize with definition/assignment writes. Readers remain unblocked.
    -- The companion guards also reject stale writes arriving after deletion.
    perform set_config('lock_timeout', '2s', true);
    lock table public.automation_scenarios, public.automation_steps, public.auto_reply_rules,
      public.campaigns, public.contact_tag_assignments, public.funnel_steps, public.rich_menu_areas, public.rich_menu_rules, public.rich_menus,
      public.segments, public.survey_options, public.survey_questions, public.surveys in share row exclusive mode;
  end if;
  select * into selected_tag from public.tags
    where organization_id = target_organization_id and id = target_tag_id for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if not selected_tag.is_active then return jsonb_build_object('status', 'deleted'); end if;
  if perform_delete and expected_name is distinct from selected_tag.name then
    return jsonb_build_object('status', 'changed');
  end if;

  -- These names are automatically assigned by the built-in acquisition URLs.
  if selected_tag.name in ('面談から流入', 'アンケート経由', 'HP経由') then
    blockers := blockers || jsonb_build_array(jsonb_build_object('key', 'acquisition', 'count', 1));
  end if;
  -- Inspect nested conditions too, including negative/exclusion tag conditions.
  -- Keep draft/paused definitions protected: they may be resumed later.
  for dependency in select * from (values
    ('surveys', 'surveys'), ('survey_questions', 'surveys'), ('survey_options', 'surveys'),
    ('automation_scenarios', 'automations'), ('automation_steps', 'automations'),
    ('auto_reply_rules', 'autoReplies'), ('segments', 'segments'),
    ('rich_menu_rules', 'richMenus'), ('rich_menu_areas', 'richMenus'), ('rich_menus', 'richMenus'),
    ('funnel_steps', 'analytics'), ('campaigns', 'campaigns')
  ) as dependencies(table_name, category) loop
    execute format('select count(*)::integer from public.%I r where r.organization_id = $1
      and (jsonb_path_exists(to_jsonb(r), ''$.** ? (@ == $id)'', jsonb_build_object(''id'', $2::text))
        or ($3 = ''campaigns'' and position($2::text in coalesce(to_jsonb(r)->>''description'', '''')) > 0))
      and ($3 <> ''campaigns'' or coalesce(to_jsonb(r)->>''status'', '''') not in (''completed'', ''cancelled''))', dependency.table_name)
      into usage_count using target_organization_id, target_tag_id, dependency.table_name;
    if usage_count > 0 then
      blockers := blockers || jsonb_build_array(jsonb_build_object('key', dependency.category, 'count', usage_count));
    end if;
  end loop;
  select count(*)::integer, count(distinct contact_id)::integer into assignment_count, contact_count
    from public.contact_tag_assignments where organization_id = target_organization_id
      and tag_id = target_tag_id and removed_at is null;
  if blockers <> '[]'::jsonb then
    return jsonb_build_object('status', 'in_use', 'blockers', blockers, 'contactCount', contact_count,
      'tag', jsonb_build_object('id', selected_tag.id, 'name', selected_tag.name));
  end if;
  if perform_delete then
    update public.contact_tag_assignments set removed_at = now(), removed_by_profile_id = target_actor_profile_id, updated_at = now()
      where organization_id = target_organization_id and tag_id = target_tag_id and removed_at is null;
    update public.tags set is_active = false, updated_at = now()
      where organization_id = target_organization_id and id = target_tag_id;
    insert into public.audit_logs (organization_id, actor_profile_id, action, resource_type, resource_id, metadata_json)
      values (target_organization_id, target_actor_profile_id, 'tag.deleted', 'tag', target_tag_id,
        jsonb_build_object('contactCount', contact_count, 'assignmentCount', assignment_count));
  end if;
  return jsonb_build_object('status', case when perform_delete then 'deleted' else 'ready' end,
    'contactCount', contact_count, 'blockers', blockers,
    'tag', jsonb_build_object('id', selected_tag.id, 'name', selected_tag.name));
end;
$$;
revoke all on function public.manage_crm_tag_deletion(uuid,uuid,uuid,boolean,text) from public, anon, authenticated;
grant execute on function public.manage_crm_tag_deletion(uuid,uuid,uuid,boolean,text) to service_role;

-- A stale browser/webhook must not recreate an active assignment or save a new
-- rule pointing at an archived tag after the deletion transaction commits.
create or replace function public.reject_archived_tag_reference()
returns trigger language plpgsql security definer set search_path = public as $$
declare referenced_tag record; payload jsonb := to_jsonb(new);
begin
  if tg_table_name = 'contact_tag_assignments' then
    if payload->>'removed_at' is not null then return new; end if;
    -- Hot path: use the tag primary key, not a JSON scan, for each assignment.
    select id, is_active into referenced_tag from public.tags
      where organization_id = new.organization_id and id = (payload->>'tag_id')::uuid for share;
    if not found or not referenced_tag.is_active then
      raise exception using errcode = '23514', message = 'Archived tag cannot be used';
    end if;
    return new;
  end if;
  if tg_table_name = 'campaigns' and payload->>'status' in ('completed', 'cancelled') then return new; end if;
  for referenced_tag in select id, is_active from public.tags t
    where t.organization_id = new.organization_id
      and (jsonb_path_exists(payload, '$.** ? (@ == $id)', jsonb_build_object('id', t.id::text))
        or (tg_table_name = 'campaigns' and position(t.id::text in coalesce(payload->>'description', '')) > 0))
    order by id for share
  loop
    if not referenced_tag.is_active then
      raise exception using errcode = '23514', message = 'Archived tag cannot be used';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.reject_archived_tag_reference() from public, anon, authenticated;
do $$ declare table_name text; begin
  foreach table_name in array array['automation_scenarios','automation_steps','auto_reply_rules','campaigns',
    'contact_tag_assignments','funnel_steps','rich_menu_areas','rich_menu_rules','rich_menus','segments','survey_options','survey_questions','surveys'] loop
    execute format('drop trigger if exists reject_archived_tag_reference on public.%I', table_name);
    execute format('create trigger reject_archived_tag_reference before insert or update on public.%I
      for each row execute function public.reject_archived_tag_reference()', table_name);
  end loop;
end $$;
