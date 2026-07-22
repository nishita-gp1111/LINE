-- Keep accepted campaign deliveries visible in each recipient's 1:1 inbox.
-- The idempotency key prevents retries and migration backfills from duplicating
-- the same campaign message. This migration never calls the LINE API.

create or replace function public.record_campaign_outbound_batch_history(
  target_organization_id uuid,
  target_campaign_id uuid,
  target_batch_id uuid,
  target_line_request_id text,
  target_accepted_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  batch_contact_ids uuid[];
  campaign_text text;
  campaign_name text;
  sender_profile_id uuid;
  effective_accepted_at timestamptz := coalesce(target_accepted_at, now());
  recorded_count integer := 0;
begin
  select
    cb.contact_ids,
    c.message_snapshot_json #>> '{0,text}',
    c.name,
    c.created_by_profile_id
  into
    batch_contact_ids,
    campaign_text,
    campaign_name,
    sender_profile_id
  from public.campaign_batches cb
  join public.campaigns c
    on c.organization_id = cb.organization_id
   and c.id = cb.campaign_id
  where cb.organization_id = target_organization_id
    and cb.campaign_id = target_campaign_id
    and cb.id = target_batch_id;

  if batch_contact_ids is null then
    raise exception 'campaign batch not found';
  end if;

  if campaign_text is null or char_length(btrim(campaign_text)) = 0 then
    raise exception 'campaign text not found';
  end if;

  if (
    select count(*)
    from public.contacts c
    where c.organization_id = target_organization_id
      and c.id = any(batch_contact_ids)
  ) <> cardinality(batch_contact_ids) then
    raise exception 'campaign contacts do not match organization';
  end if;

  insert into public.conversations (organization_id, contact_id)
  select target_organization_id, c.id
  from public.contacts c
  where c.organization_id = target_organization_id
    and c.id = any(batch_contact_ids)
  on conflict (organization_id, contact_id) do nothing;

  insert into public.messages (
    organization_id,
    contact_id,
    conversation_id,
    direction,
    source,
    line_request_id,
    message_type,
    text_content,
    payload_json,
    status,
    client_request_id,
    sent_by_profile_id,
    accepted_at,
    line_event_timestamp
  )
  select
    target_organization_id,
    c.id,
    conversation.id,
    'outbound',
    'line',
    target_line_request_id,
    'text',
    left(campaign_text, 5000),
    jsonb_build_object(
      'type', 'text',
      'delivery', 'campaign',
      'campaignId', target_campaign_id,
      'campaignName', campaign_name,
      'batchId', target_batch_id
    ),
    'accepted',
    format('campaign:%s:%s', target_campaign_id, c.id),
    sender_profile_id,
    effective_accepted_at,
    effective_accepted_at
  from public.contacts c
  join public.conversations conversation
    on conversation.organization_id = c.organization_id
   and conversation.contact_id = c.id
  where c.organization_id = target_organization_id
    and c.id = any(batch_contact_ids)
  on conflict (organization_id, client_request_id)
    where client_request_id is not null
    do nothing;

  get diagnostics recorded_count = row_count;

  update public.conversations conversation
  set
    last_message_at = greatest(
      coalesce(conversation.last_message_at, effective_accepted_at),
      effective_accepted_at
    ),
    last_outbound_at = greatest(
      coalesce(conversation.last_outbound_at, effective_accepted_at),
      effective_accepted_at
    ),
    last_message_preview = case
      when conversation.last_message_at is null
        or conversation.last_message_at <= effective_accepted_at
      then left(campaign_text, 200)
      else conversation.last_message_preview
    end,
    last_message_direction = case
      when conversation.last_message_at is null
        or conversation.last_message_at <= effective_accepted_at
      then 'outbound'
      else conversation.last_message_direction
    end,
    updated_at = now()
  where conversation.organization_id = target_organization_id
    and conversation.contact_id = any(batch_contact_ids);

  return recorded_count;
end
$$;

revoke all on function public.record_campaign_outbound_batch_history(uuid, uuid, uuid, text, timestamptz) from public;
grant execute on function public.record_campaign_outbound_batch_history(uuid, uuid, uuid, text, timestamptz) to service_role;

-- Backfill accepted text campaigns into the CRM inbox without resending them.
do $$
declare
  accepted_batch record;
begin
  for accepted_batch in
    select
      cb.organization_id,
      cb.campaign_id,
      cb.id as batch_id,
      cb.line_request_id,
      coalesce(cb.accepted_at, c.completed_at, cb.updated_at) as accepted_at
    from public.campaign_batches cb
    join public.campaigns c
      on c.organization_id = cb.organization_id
     and c.id = cb.campaign_id
    where cb.status = 'accepted'
      and c.message_snapshot_json #>> '{0,type}' = 'text'
      and nullif(btrim(c.message_snapshot_json #>> '{0,text}'), '') is not null
  loop
    perform public.record_campaign_outbound_batch_history(
      accepted_batch.organization_id,
      accepted_batch.campaign_id,
      accepted_batch.batch_id,
      accepted_batch.line_request_id,
      accepted_batch.accepted_at
    );
  end loop;
end
$$;
