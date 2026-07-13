-- Milestone 2: Inbox, conversation management, internal notes, quick replies,
-- and server-owned outbound text messages.
-- Existing migrations are intentionally left unchanged.

alter table public.contacts
  add constraint contacts_organization_id_id_key unique (organization_id, id);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null,
  status text not null default 'open' check (status in ('open', 'pending', 'closed')),
  assignee_profile_id uuid references public.profiles(id) on delete set null,
  priority text not null default 'normal' check (priority in ('normal', 'high')),
  last_message_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  last_message_preview text check (last_message_preview is null or char_length(last_message_preview) <= 200),
  last_message_direction text check (last_message_direction is null or last_message_direction in ('inbound', 'outbound')),
  reopened_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, contact_id),
  unique (organization_id, id),
  foreign key (organization_id, contact_id) references public.contacts(organization_id, id) on delete cascade
);

create index conversations_organization_last_message_idx
  on public.conversations (organization_id, last_message_at desc nulls last);
create index conversations_organization_status_idx
  on public.conversations (organization_id, status, last_message_at desc nulls last);
create index conversations_organization_assignee_idx
  on public.conversations (organization_id, assignee_profile_id, last_message_at desc nulls last);

create table public.conversation_read_states (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  unread_count integer not null default 0 check (unread_count >= 0),
  last_read_at timestamptz,
  last_read_message_id uuid references public.messages(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, conversation_id, profile_id),
  foreign key (organization_id, conversation_id) references public.conversations(organization_id, id) on delete cascade
);

create index conversation_read_states_profile_unread_idx
  on public.conversation_read_states (profile_id, unread_count);

create table public.conversation_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null,
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  updated_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (organization_id, conversation_id) references public.conversations(organization_id, id) on delete cascade
);

create index conversation_notes_conversation_created_idx
  on public.conversation_notes (conversation_id, created_at);

create table public.quick_reply_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  text_content text not null check (char_length(btrim(text_content)) between 1 and 5000),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create index quick_reply_templates_organization_active_idx
  on public.quick_reply_templates (organization_id, is_active, sort_order);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id uuid,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_organization_created_idx
  on public.audit_logs (organization_id, created_at desc);

alter table public.messages
  drop constraint if exists messages_direction_check;
alter table public.messages
  drop constraint if exists messages_status_check;
alter table public.messages
  add column if not exists conversation_id uuid,
  add column if not exists client_request_id text,
  add column if not exists retry_key uuid,
  add column if not exists line_accepted_request_id text,
  add column if not exists line_sent_message_id text,
  add column if not exists sent_by_profile_id uuid,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists error_class text,
  add column if not exists error_code text,
  add column if not exists error_message_safe text,
  add column if not exists accepted_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists cancelled_at timestamptz;

alter table public.messages
  add constraint messages_direction_check check (direction in ('inbound', 'outbound'));
alter table public.messages
  add constraint messages_status_check check (status in ('received', 'deleted', 'queued', 'sending', 'accepted', 'retryable_failed', 'permanently_failed', 'cancelled'));
alter table public.messages
  add constraint messages_outbound_retry_key_check check (direction = 'outbound' or retry_key is null);
alter table public.messages
  add constraint messages_outbound_client_request_check check (direction = 'outbound' or client_request_id is null);
alter table public.messages
  add constraint messages_text_limit_check check (text_content is null or char_length(text_content) <= 5000);
alter table public.messages
  add constraint messages_conversation_fk foreign key (organization_id, conversation_id) references public.conversations(organization_id, id) on delete cascade;
alter table public.messages
  add constraint messages_sent_by_profile_fk foreign key (sent_by_profile_id) references public.profiles(id) on delete set null;

create unique index messages_organization_client_request_idx
  on public.messages (organization_id, client_request_id)
  where client_request_id is not null;
create unique index messages_organization_retry_key_idx
  on public.messages (organization_id, retry_key)
  where retry_key is not null;
create unique index messages_organization_line_message_idx
  on public.messages (organization_id, line_message_id)
  where line_message_id is not null;
create index messages_conversation_created_idx
  on public.messages (conversation_id, created_at desc);

create table public.outbound_message_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  http_status integer,
  line_request_id text,
  line_accepted_request_id text,
  error_class text,
  error_message_safe text,
  created_at timestamptz not null default now(),
  unique (message_id, attempt_number)
);

create index outbound_message_attempts_message_attempt_idx
  on public.outbound_message_attempts (message_id, attempt_number);

-- Backfill conversations and message ownership without copying deleted message text.
with message_rollup as (
  select
    m.organization_id,
    m.contact_id,
    max(m.line_event_timestamp) as line_event_timestamp,
    max(m.line_event_timestamp) filter (where m.direction = 'inbound') as inbound_at,
    max(m.line_event_timestamp) filter (where m.direction = 'outbound') as outbound_at,
    (array_agg(
      case
        when m.status = 'deleted' then '（メッセージが送信取消されました）'
        else left(coalesce(m.text_content, '（本文なし）'), 200)
      end
      order by m.line_event_timestamp desc nulls last, m.created_at desc nulls last
    ))[1] as preview,
    (array_agg(
      m.direction
      order by m.line_event_timestamp desc nulls last, m.created_at desc nulls last
    ))[1] as direction
  from public.messages m
  where m.contact_id is not null
  group by m.organization_id, m.contact_id
)
insert into public.conversations (organization_id, contact_id, last_message_at, last_inbound_at, last_message_preview, last_message_direction)
select c.organization_id,
       c.id,
       message_rollup.line_event_timestamp,
       message_rollup.inbound_at,
       message_rollup.preview,
       message_rollup.direction
from public.contacts c
left join message_rollup
  on message_rollup.organization_id = c.organization_id
 and message_rollup.contact_id = c.id
on conflict (organization_id, contact_id) do nothing;

update public.messages m
set conversation_id = c.id
from public.conversations c
where c.organization_id = m.organization_id
  and c.contact_id = m.contact_id
  and m.conversation_id is null;

with latest as (
  select
    m.conversation_id,
    max(m.line_event_timestamp) as line_event_timestamp,
    max(m.line_event_timestamp) filter (where m.direction = 'inbound') as inbound_at,
    max(m.line_event_timestamp) filter (where m.direction = 'outbound') as outbound_at,
    (array_agg(
      case
        when m.status = 'deleted' then '（メッセージが送信取消されました）'
        else left(coalesce(m.text_content, '（本文なし）'), 200)
      end
      order by m.line_event_timestamp desc nulls last, m.created_at desc nulls last
    ))[1] as preview,
    (array_agg(
      m.direction
      order by m.line_event_timestamp desc nulls last, m.created_at desc nulls last
    ))[1] as direction
  from public.messages m
  where m.conversation_id is not null
  group by m.conversation_id
)
update public.conversations c
set last_message_at = latest.line_event_timestamp,
    last_inbound_at = latest.inbound_at,
    last_outbound_at = latest.outbound_at,
    last_message_preview = latest.preview,
    last_message_direction = latest.direction,
    updated_at = now()
from latest
where latest.conversation_id = c.id
  and latest.line_event_timestamp is not null;

insert into public.conversation_read_states (organization_id, conversation_id, profile_id, unread_count)
select c.organization_id, c.id, om.profile_id,
       (select count(*)::integer from public.messages m where m.organization_id = c.organization_id and m.conversation_id = c.id and m.direction = 'inbound')
from public.conversations c
join public.organization_members om on om.organization_id = c.organization_id
where om.role::text in ('member', 'viewer', 'operator', 'admin', 'owner')
on conflict (organization_id, conversation_id, profile_id) do nothing;

create or replace function public.is_conversation_operator(target_organization_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$ select public.is_organization_operator(target_organization_id); $$;

create or replace function public.is_conversation_admin(target_organization_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.organization_members where organization_id = target_organization_id and profile_id = auth.uid() and role::text in ('owner', 'admin')); $$;

create or replace function public.is_profile_in_organization(target_organization_id uuid, target_profile_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.organization_members where organization_id = target_organization_id and profile_id = target_profile_id and role::text in ('member', 'viewer', 'operator', 'admin', 'owner')); $$;

create or replace function public.refresh_conversation_preview(target_organization_id uuid, target_conversation_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  with latest as (
    select
      m.conversation_id,
      max(m.line_event_timestamp) as line_event_timestamp,
      max(m.line_event_timestamp) filter (where m.direction = 'inbound') as inbound_at,
      max(m.line_event_timestamp) filter (where m.direction = 'outbound') as outbound_at,
      (array_agg(
        case
          when m.status = 'deleted' then '（メッセージが送信取消されました）'
          else left(coalesce(m.text_content, '（本文なし）'), 200)
        end
        order by m.line_event_timestamp desc nulls last, m.created_at desc nulls last
      ))[1] as preview,
      (array_agg(
        m.direction
        order by m.line_event_timestamp desc nulls last, m.created_at desc nulls last
      ))[1] as direction
    from public.messages m
    where m.organization_id = target_organization_id
      and m.conversation_id = target_conversation_id
    group by m.conversation_id
  )
  update public.conversations c
  set last_message_at = latest.line_event_timestamp,
      last_inbound_at = latest.inbound_at,
      last_outbound_at = latest.outbound_at,
      last_message_preview = latest.preview,
      last_message_direction = latest.direction,
      updated_at = now()
  from latest
  where latest.conversation_id = c.id
    and c.organization_id = target_organization_id
    and c.id = target_conversation_id;
end;
$$;

create or replace function public.ensure_conversation_for_contact(target_organization_id uuid, target_contact_id uuid, target_event_at timestamptz)
returns uuid language plpgsql security definer set search_path = public
as $$
declare conversation_id uuid;
begin
  insert into public.conversations (organization_id, contact_id, last_message_at)
  values (target_organization_id, target_contact_id, null)
  on conflict (organization_id, contact_id) do nothing
  returning id into conversation_id;
  if conversation_id is null then
    select id into conversation_id from public.conversations where organization_id = target_organization_id and contact_id = target_contact_id;
  end if;
  return conversation_id;
end;
$$;

-- Replace the Milestone 1 insert function with an atomic message + conversation + unread update.
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
returns uuid language plpgsql security definer set search_path = public
as $$
declare message_id uuid; conversation_record_id uuid;
begin
  insert into public.messages (organization_id, contact_id, line_message_id, line_request_id, message_type, text_content, payload_json, line_event_timestamp, direction, source, status)
  values (target_organization_id, target_contact_id, target_line_message_id, target_line_request_id, target_message_type, case when target_message_type = 'text' then left(target_text_content, 5000) else null end, coalesce(target_payload_json, '{}'::jsonb), target_event_at, 'inbound', 'line', 'received')
  on conflict (organization_id, line_message_id) do nothing
  returning id into message_id;
  if message_id is null then return null; end if;

  conversation_record_id := public.ensure_conversation_for_contact(target_organization_id, target_contact_id, target_event_at);
  update public.messages set conversation_id = conversation_record_id where id = message_id;
  insert into public.conversation_read_states (organization_id, conversation_id, profile_id, unread_count)
  select target_organization_id, conversation_record_id, om.profile_id, 1
  from public.organization_members om
  where om.organization_id = target_organization_id and om.role::text in ('member', 'viewer', 'operator', 'admin', 'owner')
  on conflict (organization_id, conversation_id, profile_id) do update set unread_count = conversation_read_states.unread_count + 1, updated_at = now();
  update public.conversations
  set status = case when status = 'closed' then 'open' else status end,
      reopened_at = case when status = 'closed' then target_event_at else reopened_at end,
      closed_at = case when status = 'closed' then null else closed_at end,
      last_message_at = greatest(coalesce(last_message_at, target_event_at), target_event_at),
      last_inbound_at = greatest(coalesce(last_inbound_at, target_event_at), target_event_at),
      last_message_preview = case when target_message_type = 'text' then left(coalesce(target_text_content, ''), 200) else '（非テキストメッセージ）' end,
      last_message_direction = 'inbound', updated_at = now()
  where id = conversation_record_id;
  return message_id;
end;
$$;

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
language plpgsql security definer set search_path = public
as $$
declare inserted_id uuid;
begin
  if not public.is_profile_in_organization(target_organization_id, target_sent_by_profile_id) then raise exception 'invalid sender'; end if;
  if exists (select 1 from public.contacts where id = target_contact_id and organization_id = target_organization_id and friend_status = 'blocked') then raise exception 'contact is blocked'; end if;
  if not exists (select 1 from public.conversations where id = target_conversation_id and organization_id = target_organization_id and contact_id = target_contact_id) then raise exception 'conversation not found'; end if;
  insert into public.messages (organization_id, contact_id, conversation_id, direction, source, message_type, text_content, payload_json, status, client_request_id, retry_key, sent_by_profile_id, line_event_timestamp)
  values (target_organization_id, target_contact_id, target_conversation_id, 'outbound', 'line', 'text', target_text_content, jsonb_build_object('type', 'text'), 'queued', target_client_request_id, target_retry_key, target_sent_by_profile_id, now())
  on conflict (organization_id, client_request_id) do nothing
  returning id into inserted_id;
  if inserted_id is null then
    select id into inserted_id from public.messages where organization_id = target_organization_id and client_request_id = target_client_request_id;
    return query select false, inserted_id;
  else
    return query select true, inserted_id;
  end if;
end;
$$;

create or replace function public.claim_outbound_line_message(target_organization_id uuid, target_message_id uuid, target_profile_id uuid)
returns uuid language plpgsql security definer set search_path = public
as $$
declare claimed_id uuid;
begin
  update public.messages
  set status = 'sending', attempt_count = attempt_count + 1, updated_at = now()
  where id = target_message_id and organization_id = target_organization_id and direction = 'outbound' and sent_by_profile_id = target_profile_id and status in ('queued', 'retryable_failed')
  returning id into claimed_id;
  if claimed_id is null then raise exception 'message cannot be sent'; end if;
  return claimed_id;
end;
$$;

create or replace function public.update_outbound_line_message(
  target_organization_id uuid,
  target_message_id uuid,
  target_status text,
  target_line_request_id text,
  target_line_accepted_request_id text,
  target_line_sent_message_id text,
  target_error_class text,
  target_error_code text,
  target_error_message_safe text,
  target_accepted_at timestamptz,
  target_failed_at timestamptz,
  target_cancelled_at timestamptz
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare updated_id uuid;
begin
  if target_status not in ('sending', 'accepted', 'retryable_failed', 'permanently_failed', 'cancelled') then raise exception 'invalid outbound status'; end if;
  update public.messages set status = target_status, line_request_id = coalesce(target_line_request_id, line_request_id), line_accepted_request_id = coalesce(target_line_accepted_request_id, line_accepted_request_id), line_sent_message_id = coalesce(target_line_sent_message_id, line_sent_message_id), error_class = target_error_class, error_code = target_error_code, error_message_safe = left(target_error_message_safe, 500), accepted_at = target_accepted_at, failed_at = target_failed_at, cancelled_at = target_cancelled_at, updated_at = now() where id = target_message_id and organization_id = target_organization_id and direction = 'outbound' returning id into updated_id;
  if target_status = 'accepted' then
    update public.conversations c set last_message_at = greatest(coalesce(c.last_message_at, m.line_event_timestamp), m.line_event_timestamp), last_outbound_at = greatest(coalesce(c.last_outbound_at, m.line_event_timestamp), m.line_event_timestamp), last_message_preview = left(coalesce(m.text_content, ''), 200), last_message_direction = 'outbound', updated_at = now() from public.messages m where c.id = m.conversation_id and m.id = target_message_id;
  end if;
  return updated_id;
end;
$$;

create or replace function public.redact_line_message(target_organization_id uuid, target_line_message_id text)
returns boolean language plpgsql security definer set search_path = public
as $$
declare affected boolean := false; target_conversation_id uuid;
begin
  select conversation_id into target_conversation_id from public.messages where organization_id = target_organization_id and line_message_id = target_line_message_id;
  update public.messages set text_content = null, payload_json = jsonb_build_object('deleted', true), status = 'deleted', deleted_at = coalesce(deleted_at, now()), updated_at = now() where organization_id = target_organization_id and line_message_id = target_line_message_id and status <> 'deleted';
  affected := found;
  if target_conversation_id is not null then perform public.refresh_conversation_preview(target_organization_id, target_conversation_id); end if;
  return affected;
end;
$$;

create or replace function public.record_inbox_audit(target_organization_id uuid, target_actor_profile_id uuid, target_action text, target_resource_type text, target_resource_id uuid, target_metadata_json jsonb)
returns void language sql security definer set search_path = public
as $$ insert into public.audit_logs (organization_id, actor_profile_id, action, resource_type, resource_id, metadata_json) values (target_organization_id, target_actor_profile_id, target_action, target_resource_type, target_resource_id, coalesce(target_metadata_json, '{}'::jsonb)); $$;

alter table public.conversations enable row level security;
alter table public.conversation_read_states enable row level security;
alter table public.conversation_notes enable row level security;
alter table public.quick_reply_templates enable row level security;
alter table public.audit_logs enable row level security;
alter table public.outbound_message_attempts enable row level security;

create policy conversations_select_member on public.conversations for select to authenticated using (public.is_organization_member(organization_id));
create policy conversations_operator_update on public.conversations for update to authenticated using (public.is_conversation_operator(organization_id)) with check (public.is_conversation_operator(organization_id) and (assignee_profile_id is null or public.is_profile_in_organization(organization_id, assignee_profile_id)));
create policy read_states_select_member on public.conversation_read_states for select to authenticated using (public.is_organization_member(organization_id));
create policy read_states_update_self on public.conversation_read_states for update to authenticated using (public.is_organization_member(organization_id) and profile_id = auth.uid()) with check (public.is_organization_member(organization_id) and profile_id = auth.uid());
create policy notes_select_member on public.conversation_notes for select to authenticated using (public.is_organization_member(organization_id));
create policy notes_insert_operator on public.conversation_notes for insert to authenticated with check (public.is_conversation_operator(organization_id) and created_by_profile_id = auth.uid());
create policy notes_update_author_admin on public.conversation_notes for update to authenticated using (public.is_conversation_admin(organization_id) or created_by_profile_id = auth.uid()) with check (public.is_conversation_admin(organization_id) or created_by_profile_id = auth.uid());
create policy quick_replies_select_member on public.quick_reply_templates for select to authenticated using (public.is_organization_member(organization_id));
create policy quick_replies_manage_admin on public.quick_reply_templates for all to authenticated using (public.is_conversation_admin(organization_id)) with check (public.is_conversation_admin(organization_id));
create policy audit_logs_select_admin on public.audit_logs for select to authenticated using (public.is_conversation_admin(organization_id));
create policy attempts_select_member on public.outbound_message_attempts for select to authenticated using (public.is_organization_member(organization_id));

revoke execute on function public.create_outbound_line_message(uuid, uuid, uuid, text, text, uuid, uuid) from public;
revoke execute on function public.claim_outbound_line_message(uuid, uuid, uuid) from public;
revoke execute on function public.update_outbound_line_message(uuid, uuid, text, text, text, text, text, text, text, timestamptz, timestamptz, timestamptz) from public;
revoke execute on function public.record_inbox_audit(uuid, uuid, text, text, uuid, jsonb) from public;
revoke execute on function public.ensure_conversation_for_contact(uuid, uuid, timestamptz) from public;
revoke execute on function public.refresh_conversation_preview(uuid, uuid) from public;
grant execute on function public.create_outbound_line_message(uuid, uuid, uuid, text, text, uuid, uuid) to service_role;
grant execute on function public.claim_outbound_line_message(uuid, uuid, uuid) to service_role;
grant execute on function public.update_outbound_line_message(uuid, uuid, text, text, text, text, text, text, text, timestamptz, timestamptz, timestamptz) to service_role;
grant execute on function public.record_inbox_audit(uuid, uuid, text, text, uuid, jsonb) to service_role;
grant execute on function public.ensure_conversation_for_contact(uuid, uuid, timestamptz) to service_role;
grant execute on function public.refresh_conversation_preview(uuid, uuid) to service_role;
