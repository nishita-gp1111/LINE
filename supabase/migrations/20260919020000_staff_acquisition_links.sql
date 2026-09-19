-- Dedicated meeting links assign a fixed named staff member. They do not read
-- or advance the shared round-robin counter, and do not grant login access.
create or replace function public.assign_acquisition_contact(
  target_organization_id uuid, target_contact_id uuid, target_route_slug text
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  rule public.acquisition_assignment_rules%rowtype;
  conversation public.conversations%rowtype;
  selected_name text;
  fixed_name text;
  conversation_id uuid;
begin
  fixed_name := case target_route_slug
    when 'meeting-imafuku' then '今福'
    when 'meeting-shimizu' then '志水'
    when 'meeting-uoi' then '魚井'
    when 'meeting-nishita' then '西田'
    else null
  end;

  if fixed_name is null then
    -- Only shared routes take the shared counter lock. Dedicated URLs remain
    -- usable even if shared round-robin assignment is paused.
    select * into rule from public.acquisition_assignment_rules
    where organization_id = target_organization_id and route_slug = target_route_slug for update;
    if not found or not rule.enabled then return jsonb_build_object('status', 'disabled'); end if;
  end if;

  if not exists (select 1 from public.contacts where organization_id = target_organization_id and id = target_contact_id) then
    raise exception 'Contact not found' using errcode = '23503';
  end if;
  conversation_id := public.ensure_conversation_for_contact(target_organization_id, target_contact_id, now());
  -- All routes lock the same conversation. The first decision wins, including
  -- races between two dedicated URLs or a dedicated and a shared URL.
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

  selected_name := coalesce(fixed_name, rule.staff_names[(rule.next_index % cardinality(rule.staff_names))::integer + 1]);
  update public.conversations set assignee_name = selected_name, updated_at = now() where id = conversation_id;
  insert into public.acquisition_assignment_decisions (organization_id, contact_id, route_slug, assigned_name, outcome)
  values (target_organization_id, target_contact_id, target_route_slug, selected_name, 'assigned');
  if fixed_name is null then
    update public.acquisition_assignment_rules set next_index = next_index + 1
    where organization_id = target_organization_id and route_slug = target_route_slug;
  end if;
  return jsonb_build_object('status', 'assigned');
end;
$$;

revoke all on function public.assign_acquisition_contact(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.assign_acquisition_contact(uuid, uuid, text) to service_role;
