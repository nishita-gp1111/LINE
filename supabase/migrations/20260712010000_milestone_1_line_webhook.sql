-- Milestone 1: LINE webhook, contacts, and inbound message foundation.
-- Existing migrations are intentionally left unchanged.

alter type public.app_role add value if not exists 'viewer';
alter type public.app_role add value if not exists 'operator';

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  line_user_id text not null,
  display_name text,
  picture_url text,
  status_message text,
  language text,
  friend_status text not null default 'unknown'
    check (friend_status in ('following', 'blocked', 'unknown')),
  followed_at timestamptz,
  unfollowed_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_message_at timestamptz,
  last_line_event_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, line_user_id)
);

create index contacts_organization_updated_idx
  on public.contacts (organization_id, updated_at desc);
create index contacts_organization_status_idx
  on public.contacts (organization_id, friend_status, updated_at desc);

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  webhook_event_id text not null,
  event_type text not null,
  line_user_id text,
  line_message_id text,
  event_timestamp timestamptz not null,
  is_redelivery boolean not null default false,
  payload_redacted_json jsonb not null default '{}'::jsonb,
  status text not null default 'processing'
    check (status in ('received', 'processing', 'processed', 'ignored', 'failed')),
  processing_started_at timestamptz,
  processed_at timestamptz,
  error_message_safe text,
  created_at timestamptz not null default now(),
  unique (organization_id, webhook_event_id)
);

create index webhook_events_organization_timestamp_idx
  on public.webhook_events (organization_id, event_timestamp desc);
create index webhook_events_organization_status_idx
  on public.webhook_events (organization_id, status, created_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  direction text not null default 'inbound' check (direction = 'inbound'),
  source text not null default 'line' check (source = 'line'),
  line_message_id text,
  line_request_id text,
  message_type text not null,
  text_content text,
  payload_json jsonb not null default '{}'::jsonb,
  status text not null default 'received' check (status in ('received', 'deleted')),
  line_event_timestamp timestamptz not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, line_message_id)
);

create index messages_contact_timestamp_idx
  on public.messages (organization_id, contact_id, line_event_timestamp desc);

create or replace function public.is_organization_operator(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members
    where organization_id = target_organization_id
      and profile_id = auth.uid()
      and role::text in ('owner', 'admin', 'operator')
  );
$$;

revoke execute on function public.is_organization_operator(uuid) from public;
grant execute on function public.is_organization_operator(uuid) to authenticated;

alter table public.contacts enable row level security;
alter table public.webhook_events enable row level security;
alter table public.messages enable row level security;

create policy contacts_select_member on public.contacts
  for select to authenticated
  using (public.is_organization_member(organization_id));

create policy contacts_operator_update on public.contacts
  for update to authenticated
  using (public.is_organization_operator(organization_id))
  with check (public.is_organization_operator(organization_id));

create policy webhook_events_select_member on public.webhook_events
  for select to authenticated
  using (public.is_organization_member(organization_id));

create policy messages_select_member on public.messages
  for select to authenticated
  using (public.is_organization_member(organization_id));

create or replace function public.claim_webhook_event(
  target_organization_id uuid,
  target_webhook_event_id text,
  target_event_type text,
  target_line_user_id text,
  target_line_message_id text,
  target_event_timestamp timestamptz,
  target_is_redelivery boolean,
  target_payload_redacted_json jsonb
)
returns table(claimed boolean, event_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_id uuid;
  current_event public.webhook_events%rowtype;
begin
  insert into public.webhook_events (
    organization_id,
    webhook_event_id,
    event_type,
    line_user_id,
    line_message_id,
    event_timestamp,
    is_redelivery,
    payload_redacted_json,
    status,
    processing_started_at
  ) values (
    target_organization_id,
    target_webhook_event_id,
    target_event_type,
    target_line_user_id,
    target_line_message_id,
    target_event_timestamp,
    target_is_redelivery,
    coalesce(target_payload_redacted_json, '{}'::jsonb),
    'processing',
    now()
  )
  on conflict (organization_id, webhook_event_id) do nothing
  returning id into inserted_id;

  if inserted_id is not null then
    return query select true, inserted_id;
    return;
  end if;

  select * into current_event
  from public.webhook_events
  where organization_id = target_organization_id
    and webhook_event_id = target_webhook_event_id
  for update;

  if current_event.status in ('processed', 'ignored') then
    return query select false, current_event.id;
    return;
  end if;

  if current_event.status = 'failed'
     or (current_event.status = 'processing'
         and current_event.processing_started_at < now() - interval '5 minutes') then
    update public.webhook_events
    set status = 'processing',
        processing_started_at = now(),
        error_message_safe = null
    where id = current_event.id;
    return query select true, current_event.id;
    return;
  end if;

  return query select false, current_event.id;
end;
$$;

create or replace function public.complete_webhook_event(
  target_event_id uuid,
  target_status text,
  target_error_message_safe text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_status not in ('processed', 'ignored', 'failed') then
    raise exception 'invalid webhook status';
  end if;

  update public.webhook_events
  set status = target_status,
      processed_at = case when target_status in ('processed', 'ignored') then now() else processed_at end,
      error_message_safe = left(target_error_message_safe, 500),
      processing_started_at = null
  where id = target_event_id;
end;
$$;

create or replace function public.apply_line_contact_event(
  target_organization_id uuid,
  target_line_user_id text,
  target_event_type text,
  target_event_at timestamptz,
  target_display_name text,
  target_picture_url text,
  target_status_message text,
  target_language text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  contact_id uuid;
  target_status text := case
    when target_event_type = 'follow' then 'following'
    when target_event_type = 'unfollow' then 'blocked'
    else 'unknown'
  end;
begin
  if target_event_type not in ('follow', 'unfollow', 'message') then
    raise exception 'invalid contact event type';
  end if;

  insert into public.contacts (
    organization_id,
    line_user_id,
    display_name,
    picture_url,
    status_message,
    language,
    friend_status,
    followed_at,
    unfollowed_at,
    first_seen_at,
    last_seen_at,
    last_message_at,
    last_line_event_at
  ) values (
    target_organization_id,
    target_line_user_id,
    target_display_name,
    target_picture_url,
    target_status_message,
    target_language,
    target_status,
    case when target_event_type = 'follow' then target_event_at end,
    case when target_event_type = 'unfollow' then target_event_at end,
    target_event_at,
    target_event_at,
    case when target_event_type = 'message' then target_event_at end,
    target_event_at
  )
  on conflict (organization_id, line_user_id) do update set
    display_name = case when excluded.last_line_event_at >= contacts.last_line_event_at then coalesce(excluded.display_name, contacts.display_name) else contacts.display_name end,
    picture_url = case when excluded.last_line_event_at >= contacts.last_line_event_at then coalesce(excluded.picture_url, contacts.picture_url) else contacts.picture_url end,
    status_message = case when excluded.last_line_event_at >= contacts.last_line_event_at then coalesce(excluded.status_message, contacts.status_message) else contacts.status_message end,
    language = case when excluded.last_line_event_at >= contacts.last_line_event_at then coalesce(excluded.language, contacts.language) else contacts.language end,
    friend_status = case when target_event_type in ('follow', 'unfollow') and excluded.last_line_event_at >= contacts.last_line_event_at then excluded.friend_status else contacts.friend_status end,
    followed_at = case when target_event_type = 'follow' and excluded.last_line_event_at >= contacts.last_line_event_at then excluded.followed_at else contacts.followed_at end,
    unfollowed_at = case when target_event_type = 'follow' and excluded.last_line_event_at >= contacts.last_line_event_at then null when target_event_type = 'unfollow' and excluded.last_line_event_at >= contacts.last_line_event_at then excluded.unfollowed_at else contacts.unfollowed_at end,
    first_seen_at = least(contacts.first_seen_at, excluded.first_seen_at),
    last_seen_at = greatest(contacts.last_seen_at, excluded.last_seen_at),
    last_message_at = case when target_event_type = 'message' then greatest(coalesce(contacts.last_message_at, excluded.last_message_at), excluded.last_message_at) else contacts.last_message_at end,
    last_line_event_at = greatest(contacts.last_line_event_at, excluded.last_line_event_at),
    updated_at = now()
  returning id into contact_id;

  return contact_id;
end;
$$;

create or replace function public.insert_inbound_line_message(
  target_organization_id uuid,
  target_contact_id uuid,
  target_line_message_id text,
  target_line_request_id text,
  target_message_type text,
  target_text_content text,
  target_payload_json jsonb,
  target_event_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  message_id uuid;
begin
  insert into public.messages (
    organization_id,
    contact_id,
    line_message_id,
    line_request_id,
    message_type,
    text_content,
    payload_json,
    line_event_timestamp
  ) values (
    target_organization_id,
    target_contact_id,
    target_line_message_id,
    target_line_request_id,
    target_message_type,
    target_text_content,
    coalesce(target_payload_json, '{}'::jsonb),
    target_event_at
  )
  on conflict (organization_id, line_message_id) do nothing
  returning id into message_id;
  return message_id;
end;
$$;

create or replace function public.redact_line_message(
  target_organization_id uuid,
  target_line_message_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.messages
  set text_content = null,
      payload_json = jsonb_build_object('deleted', true),
      status = 'deleted',
      deleted_at = coalesce(deleted_at, now()),
      updated_at = now()
  where organization_id = target_organization_id
    and line_message_id = target_line_message_id
    and status <> 'deleted';
  return found;
end;
$$;

revoke execute on function public.claim_webhook_event(uuid, text, text, text, text, timestamptz, boolean, jsonb) from public;
revoke execute on function public.complete_webhook_event(uuid, text, text) from public;
revoke execute on function public.apply_line_contact_event(uuid, text, text, timestamptz, text, text, text, text) from public;
revoke execute on function public.insert_inbound_line_message(uuid, uuid, text, text, text, text, jsonb, timestamptz) from public;
revoke execute on function public.redact_line_message(uuid, text) from public;
grant execute on function public.claim_webhook_event(uuid, text, text, text, text, timestamptz, boolean, jsonb) to service_role;
grant execute on function public.complete_webhook_event(uuid, text, text) to service_role;
grant execute on function public.apply_line_contact_event(uuid, text, text, timestamptz, text, text, text, text) to service_role;
grant execute on function public.insert_inbound_line_message(uuid, uuid, text, text, text, text, jsonb, timestamptz) to service_role;
grant execute on function public.redact_line_message(uuid, text) to service_role;
