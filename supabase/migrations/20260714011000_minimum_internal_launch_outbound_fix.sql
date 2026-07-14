-- Match the outbound message ON CONFLICT target to its partial unique index.
-- Without the predicate PostgreSQL raises SQLSTATE 42P10 at send time.

create or replace function public.create_outbound_line_message(
  target_organization_id uuid,
  target_conversation_id uuid,
  target_contact_id uuid,
  target_text_content text,
  target_client_request_id text,
  target_retry_key uuid,
  target_sent_by_profile_id uuid
)
returns table(created boolean, message_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_id uuid;
begin
  if not public.is_profile_in_organization(target_organization_id, target_sent_by_profile_id) then
    raise exception 'invalid sender';
  end if;

  if exists (
    select 1
    from public.contacts
    where id = target_contact_id
      and organization_id = target_organization_id
      and friend_status = 'blocked'
  ) then
    raise exception 'contact is blocked';
  end if;

  if not exists (
    select 1
    from public.conversations
    where id = target_conversation_id
      and organization_id = target_organization_id
      and contact_id = target_contact_id
  ) then
    raise exception 'conversation not found';
  end if;

  insert into public.messages (
    organization_id,
    contact_id,
    conversation_id,
    direction,
    source,
    message_type,
    text_content,
    payload_json,
    status,
    client_request_id,
    retry_key,
    sent_by_profile_id,
    line_event_timestamp
  ) values (
    target_organization_id,
    target_contact_id,
    target_conversation_id,
    'outbound',
    'line',
    'text',
    target_text_content,
    jsonb_build_object('type', 'text'),
    'queued',
    target_client_request_id,
    target_retry_key,
    target_sent_by_profile_id,
    now()
  )
  on conflict (organization_id, client_request_id)
    where client_request_id is not null
    do nothing
  returning id into inserted_id;

  if inserted_id is null then
    select id into inserted_id
    from public.messages
    where organization_id = target_organization_id
      and client_request_id = target_client_request_id;

    return query select false, inserted_id;
  else
    return query select true, inserted_id;
  end if;
end
$$;

revoke all on function public.create_outbound_line_message(uuid, uuid, uuid, text, text, uuid, uuid) from public;
grant execute on function public.create_outbound_line_message(uuid, uuid, uuid, text, text, uuid, uuid) to service_role;
