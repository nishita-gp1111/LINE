-- Outbound image and PDF-link attachments for the one-to-one inbox.
-- Files remain in the private line-media bucket. Public access is granted only
-- through an opaque, signed application URL.

alter table public.messages
  add constraint messages_organization_id_id_key unique (organization_id, id);

create table public.message_attachments (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  message_id uuid not null,
  conversation_id uuid not null,
  contact_id uuid not null,
  attachment_type text not null check (attachment_type in ('image', 'pdf')),
  file_name text not null check (char_length(btrim(file_name)) between 1 and 200),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'application/pdf')),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  storage_bucket text not null default 'line-media',
  storage_path text not null,
  preview_storage_path text,
  checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (organization_id, id),
  unique (organization_id, message_id),
  unique (organization_id, storage_path),
  foreign key (organization_id, message_id)
    references public.messages(organization_id, id) on delete cascade,
  foreign key (organization_id, conversation_id)
    references public.conversations(organization_id, id) on delete cascade,
  foreign key (organization_id, contact_id)
    references public.contacts(organization_id, id) on delete cascade,
  check (
    (attachment_type = 'image' and mime_type in ('image/jpeg', 'image/png') and preview_storage_path is not null)
    or
    (attachment_type = 'pdf' and mime_type = 'application/pdf' and preview_storage_path is null)
  )
);

create index message_attachments_message_idx
  on public.message_attachments (organization_id, message_id)
  where deleted_at is null;

alter table public.message_attachments enable row level security;

create policy message_attachments_select_member on public.message_attachments
  for select to authenticated
  using (public.is_organization_member(organization_id));

-- Keep the bucket private while allowing PDFs to be stored alongside existing
-- LINE image/video/audio assets.
update storage.buckets
set allowed_mime_types = array[
  'image/jpeg',
  'image/png',
  'application/pdf',
  'video/mp4',
  'audio/mpeg',
  'audio/mp4',
  'audio/x-m4a'
]
where id = 'line-media';

create or replace function public.create_outbound_line_attachment_message(
  target_organization_id uuid,
  target_conversation_id uuid,
  target_contact_id uuid,
  target_message_type text,
  target_text_content text,
  target_client_request_id text,
  target_retry_key uuid,
  target_sent_by_profile_id uuid,
  target_attachment_id uuid,
  target_attachment_type text,
  target_file_name text,
  target_mime_type text,
  target_size_bytes bigint,
  target_storage_bucket text,
  target_storage_path text,
  target_preview_storage_path text,
  target_checksum_sha256 text
)
returns table(created boolean, message_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_id uuid;
begin
  if target_message_type not in ('image', 'file') then
    raise exception 'invalid attachment message type';
  end if;

  if target_attachment_type not in ('image', 'pdf') then
    raise exception 'invalid attachment type';
  end if;

  if (target_attachment_type = 'image' and target_message_type <> 'image')
    or (target_attachment_type = 'pdf' and target_message_type <> 'file') then
    raise exception 'attachment and message type mismatch';
  end if;

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
    target_message_type,
    target_text_content,
    jsonb_build_object(
      'type', target_message_type,
      'attachmentId', target_attachment_id,
      'attachmentType', target_attachment_type,
      'fileName', target_file_name,
      'mimeType', target_mime_type,
      'sizeBytes', target_size_bytes
    ),
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
    return;
  end if;

  insert into public.message_attachments (
    id,
    organization_id,
    message_id,
    conversation_id,
    contact_id,
    attachment_type,
    file_name,
    mime_type,
    size_bytes,
    storage_bucket,
    storage_path,
    preview_storage_path,
    checksum_sha256,
    created_by_profile_id
  ) values (
    target_attachment_id,
    target_organization_id,
    inserted_id,
    target_conversation_id,
    target_contact_id,
    target_attachment_type,
    target_file_name,
    target_mime_type,
    target_size_bytes,
    target_storage_bucket,
    target_storage_path,
    target_preview_storage_path,
    target_checksum_sha256,
    target_sent_by_profile_id
  );

  return query select true, inserted_id;
end
$$;

revoke all on function public.create_outbound_line_attachment_message(
  uuid, uuid, uuid, text, text, text, uuid, uuid, uuid, text, text, text,
  bigint, text, text, text, text
) from public;

grant execute on function public.create_outbound_line_attachment_message(
  uuid, uuid, uuid, text, text, text, uuid, uuid, uuid, text, text, text,
  bigint, text, text, text, text
) to service_role;

comment on table public.message_attachments is
  'Private one-to-one inbox attachments. PDF delivery uses a signed application link because LINE cannot send PDF message objects.';
