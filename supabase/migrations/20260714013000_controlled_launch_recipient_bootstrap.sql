-- One-time, signed-webhook bootstrap for a single Controlled Launch recipient.

create table public.controlled_launch_recipients (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  contact_id uuid not null,
  line_user_id_hash text not null check (line_user_id_hash ~ '^[0-9a-f]{64}$'),
  enrolled_webhook_event_id text not null,
  enrolled_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, contact_id),
  unique (organization_id, enrolled_webhook_event_id),
  foreign key (organization_id, contact_id)
    references public.contacts(organization_id, id)
    on delete cascade
);

alter table public.controlled_launch_recipients enable row level security;

create or replace function public.enroll_controlled_launch_recipient(
  target_organization_id uuid,
  target_contact_id uuid,
  target_line_user_id_hash text,
  target_webhook_event_id text
)
returns table (result_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.controlled_launch_recipients%rowtype;
begin
  if target_line_user_id_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_line_user_id_hash' using errcode = '22023';
  end if;

  if nullif(btrim(target_webhook_event_id), '') is null then
    raise exception 'invalid_webhook_event_id' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.contacts
    where organization_id = target_organization_id
      and id = target_contact_id
  ) then
    raise exception 'contact_not_found' using errcode = '23503';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_organization_id::text || ':controlled-launch-recipient', 0)
  );

  select * into existing
  from public.controlled_launch_recipients
  where organization_id = target_organization_id
  for update;

  if found and existing.revoked_at is null then
    if existing.contact_id = target_contact_id
      and existing.line_user_id_hash = target_line_user_id_hash then
      -- Return enrolled again only for the original webhook event. This lets a
      -- failed webhook retry resume the idempotent follow-survey send without
      -- allowing a later repetition of the enrollment phrase to resend it.
      return query select case
        when existing.enrolled_webhook_event_id = target_webhook_event_id then 'enrolled'::text
        else 'already_enrolled'::text
      end;
    else
      return query select 'locked'::text;
    end if;
    return;
  end if;

  insert into public.controlled_launch_recipients (
    organization_id,
    contact_id,
    line_user_id_hash,
    enrolled_webhook_event_id,
    enrolled_at,
    revoked_at,
    created_at,
    updated_at
  ) values (
    target_organization_id,
    target_contact_id,
    target_line_user_id_hash,
    target_webhook_event_id,
    now(),
    null,
    now(),
    now()
  )
  on conflict (organization_id) do update
  set contact_id = excluded.contact_id,
      line_user_id_hash = excluded.line_user_id_hash,
      enrolled_webhook_event_id = excluded.enrolled_webhook_event_id,
      enrolled_at = excluded.enrolled_at,
      revoked_at = null,
      updated_at = now();

  return query select 'enrolled'::text;
end
$$;

revoke all on table public.controlled_launch_recipients from public, anon, authenticated;
revoke all on function public.enroll_controlled_launch_recipient(uuid, uuid, text, text) from public;
grant execute on function public.enroll_controlled_launch_recipient(uuid, uuid, text, text) to service_role;

comment on table public.controlled_launch_recipients is
  'Single-recipient allowlist populated only by a signed LINE webhook and a one-time enrollment message.';
