-- Booking Management: public applications, questionnaires, staff calendars and reminders.
-- This migration is additive and does not modify existing LINE CRM data.

create extension if not exists btree_gist;

create table public.booking_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 1000),
  duration_minutes integer not null default 30 check (duration_minutes between 10 and 240),
  slot_interval_minutes integer not null default 30 check (slot_interval_minutes between 5 and 240),
  buffer_before_minutes integer not null default 0 check (buffer_before_minutes between 0 and 180),
  buffer_after_minutes integer not null default 10 check (buffer_after_minutes between 0 and 180),
  minimum_notice_minutes integer not null default 1440 check (minimum_notice_minutes between 0 and 43200),
  maximum_advance_days integer not null default 30 check (maximum_advance_days between 1 and 365),
  timezone text not null default 'Asia/Tokyo' check (char_length(timezone) between 1 and 100),
  available_weekdays smallint[] not null default array[1,2,3,4,5]::smallint[],
  daily_start_time time not null default '10:00',
  daily_end_time time not null default '18:00',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, slug),
  check (daily_start_time < daily_end_time),
  check (cardinality(available_weekdays) between 1 and 7),
  check (available_weekdays <@ array[0,1,2,3,4,5,6]::smallint[])
);

create table public.booking_forms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  booking_type_id uuid not null,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  description text not null default '' check (char_length(description) <= 2000),
  completion_message text not null default 'ご予約ありがとうございます。',
  is_active boolean not null default true,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, slug),
  foreign key (organization_id, booking_type_id)
    references public.booking_types(organization_id, id) on delete no action
);

create table public.booking_questions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  booking_form_id uuid not null,
  question_key text not null check (question_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  label text not null check (char_length(btrim(label)) between 1 and 500),
  description text not null default '' check (char_length(description) <= 1000),
  question_type text not null check (question_type in ('text','long_text','radio','checkbox','select')),
  is_required boolean not null default false,
  options_json jsonb not null default '[]'::jsonb check (jsonb_typeof(options_json) = 'array'),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, booking_form_id, question_key),
  foreign key (organization_id, booking_form_id)
    references public.booking_forms(organization_id, id) on delete cascade
);
create index booking_questions_form_order_idx
  on public.booking_questions (organization_id, booking_form_id, sort_order, created_at);

create table public.booking_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  booking_type_id uuid not null,
  profile_id uuid references public.profiles(id) on delete set null,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 100),
  email text not null check (char_length(btrim(email)) between 3 and 320),
  priority integer not null default 100 check (priority between 0 and 10000),
  daily_capacity integer check (daily_capacity is null or daily_capacity between 1 and 100),
  is_active boolean not null default true,
  last_assigned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, booking_type_id, email),
  foreign key (organization_id, booking_type_id)
    references public.booking_types(organization_id, id) on delete no action
);
create index booking_members_type_active_idx
  on public.booking_members (organization_id, booking_type_id, is_active, priority);

create table public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  booking_member_id uuid not null,
  provider text not null default 'google' check (provider = 'google'),
  provider_user_id text,
  provider_email text,
  calendar_id text not null default 'primary',
  encrypted_refresh_token text not null,
  granted_scopes text[] not null default '{}'::text[],
  connected_at timestamptz not null default now(),
  last_verified_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, booking_member_id),
  foreign key (organization_id, booking_member_id)
    references public.booking_members(organization_id, id) on delete cascade
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  booking_form_id uuid,
  booking_type_id uuid not null,
  contact_id uuid,
  assigned_member_id uuid,
  applicant_name text not null check (char_length(btrim(applicant_name)) between 1 and 120),
  applicant_email text not null check (char_length(btrim(applicant_email)) between 3 and 320),
  cloudworks_name text,
  source text not null default 'direct' check (char_length(source) between 1 and 100),
  questionnaire_answer jsonb not null default '{}'::jsonb check (jsonb_typeof(questionnaire_answer) = 'object'),
  questionnaire_completed_at timestamptz,
  status text not null default 'unbooked'
    check (status in ('unbooked','calendar_pending','confirmed','attended','no_show','rescheduled','cancelled','won','calendar_failed')),
  starts_at timestamptz,
  ends_at timestamptz,
  busy_starts_at timestamptz,
  busy_ends_at timestamptz,
  timezone text not null default 'Asia/Tokyo',
  calendar_event_id text,
  meet_url text,
  public_token_hash text not null unique check (public_token_hash ~ '^[0-9a-f]{64}$'),
  reschedule_token_hash text not null unique check (reschedule_token_hash ~ '^[0-9a-f]{64}$'),
  encrypted_reschedule_token text not null,
  booking_version integer not null default 1 check (booking_version >= 1),
  reschedule_count integer not null default 0 check (reschedule_count >= 0),
  confirmation_email_status text not null default 'pending'
    check (confirmation_email_status in ('pending','sent','failed','not_configured')),
  confirmation_email_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, booking_form_id)
    references public.booking_forms(organization_id, id) on delete no action,
  foreign key (organization_id, booking_type_id)
    references public.booking_types(organization_id, id) on delete no action,
  foreign key (organization_id, contact_id)
    references public.contacts(organization_id, id) on delete no action,
  foreign key (organization_id, assigned_member_id)
    references public.booking_members(organization_id, id) on delete no action,
  check (
    (starts_at is null and ends_at is null and busy_starts_at is null and busy_ends_at is null)
    or
    (starts_at is not null and ends_at is not null and busy_starts_at is not null and busy_ends_at is not null
      and starts_at < ends_at and busy_starts_at <= starts_at and busy_ends_at >= ends_at)
  )
);
create index bookings_org_start_idx on public.bookings (organization_id, starts_at desc);
create index bookings_member_start_idx on public.bookings (organization_id, assigned_member_id, starts_at);
create index bookings_status_idx on public.bookings (organization_id, status, updated_at desc);
create index bookings_contact_idx on public.bookings (organization_id, contact_id, created_at desc) where contact_id is not null;

alter table public.bookings
  add constraint bookings_member_busy_time_excl
  exclude using gist (
    organization_id with =,
    assigned_member_id with =,
    tstzrange(busy_starts_at, busy_ends_at, '[)') with &&
  )
  where (
    assigned_member_id is not null
    and busy_starts_at is not null
    and busy_ends_at is not null
    and status in ('calendar_pending','confirmed','rescheduled')
  );

create table public.booking_answers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  booking_id uuid not null,
  question_id uuid not null,
  answer_text text,
  answer_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, booking_id, question_id),
  foreign key (organization_id, booking_id)
    references public.bookings(organization_id, id) on delete cascade,
  foreign key (organization_id, question_id)
    references public.booking_questions(organization_id, id) on delete no action,
  check (num_nonnulls(answer_text, answer_json) = 1)
);

create table public.booking_reminders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  booking_id uuid not null,
  booking_version integer not null check (booking_version >= 1),
  reminder_type text not null check (reminder_type in ('confirmation','reschedule','day_before','hour_before')),
  scheduled_for timestamptz not null,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  provider_message_id text,
  error_code_safe text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, booking_id, booking_version, reminder_type),
  foreign key (organization_id, booking_id)
    references public.bookings(organization_id, id) on delete cascade
);
create index booking_reminders_due_idx
  on public.booking_reminders (status, scheduled_for)
  where status in ('pending','failed');

create or replace function public.ensure_default_booking_management(target_organization_id uuid)
returns table(default_form_id uuid, default_booking_type_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_type_id uuid;
  target_form_id uuid;
begin
  if not exists (select 1 from public.organizations where id = target_organization_id) then
    raise exception 'organization not found';
  end if;

  insert into public.booking_types (
    organization_id, slug, name, description, duration_minutes,
    slot_interval_minutes, buffer_after_minutes, minimum_notice_minutes,
    maximum_advance_days, timezone, available_weekdays, daily_start_time, daily_end_time
  ) values (
    target_organization_id, 'monitor-interview', 'モニター・副業相談 面談',
    '応募後のオンライン面談（Google Meet）', 30,
    30, 10, 1440, 30, 'Asia/Tokyo', array[1,2,3,4,5]::smallint[], '10:00', '18:00'
  )
  on conflict (organization_id, slug) do nothing
  returning id into target_type_id;

  if target_type_id is null then
    select id into target_type_id from public.booking_types
    where organization_id = target_organization_id and slug = 'monitor-interview';
  end if;

  insert into public.booking_forms (
    organization_id, booking_type_id, slug, title, description, completion_message
  ) values (
    target_organization_id, target_type_id, 'monitor', 'モニター・副業相談のお申し込み',
    '簡単なアンケートのあと、そのまま面談日時を選べます。所要時間は約2分です。',
    'ご予約ありがとうございます。確認メールに面談日時とGoogle Meet URLをお送りしました。'
  )
  on conflict (organization_id, slug) do nothing
  returning id into target_form_id;

  if target_form_id is null then
    select id into target_form_id from public.booking_forms
    where organization_id = target_organization_id and slug = 'monitor';
  end if;

  insert into public.booking_questions (
    organization_id, booking_form_id, question_key, label, question_type,
    is_required, options_json, sort_order
  ) values
    (target_organization_id, target_form_id, 'cloudworks_name', 'CloudWorksのアカウント名', 'text', true, '[]', 10),
    (target_organization_id, target_form_id, 'side_job_experience', '副業経験を教えてください', 'radio', true, '["未経験","1年未満","1〜3年","3年以上"]', 20),
    (target_organization_id, target_form_id, 'income_goal', '副業で毎月いくら稼ぎたいですか？', 'select', true, '["3万円未満","3〜5万円","5〜10万円","10〜30万円","30万円以上"]', 30),
    (target_organization_id, target_form_id, 'interests', '興味のあるジャンルを選んでください', 'checkbox', true, '["AIを使った副業","営業代行","Web制作","SNS運用","アフィリエイト","起業・独立","自分に合う副業を知りたい"]', 40),
    (target_organization_id, target_form_id, 'consultation', '相談したいことがあれば教えてください', 'long_text', false, '[]', 50)
  on conflict (organization_id, booking_form_id, question_key) do nothing;

  insert into public.booking_members (
    organization_id, booking_type_id, profile_id, display_name, email, priority
  )
  select
    target_organization_id,
    target_type_id,
    om.profile_id,
    coalesce(nullif(p.display_name, ''), split_part(p.email, '@', 1), '担当者'),
    p.email,
    row_number() over (order by om.created_at)::integer * 100
  from public.organization_members om
  join public.profiles p on p.id = om.profile_id
  where om.organization_id = target_organization_id
    and btrim(p.email) <> ''
  on conflict (organization_id, booking_type_id, email) do nothing;

  return query select target_form_id, target_type_id;
end;
$$;

revoke execute on function public.ensure_default_booking_management(uuid) from public;
grant execute on function public.ensure_default_booking_management(uuid) to service_role;

do $$
declare organization_record record;
begin
  for organization_record in select id from public.organizations loop
    perform public.ensure_default_booking_management(organization_record.id);
  end loop;
end $$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'booking_types','booking_forms','booking_questions','booking_members',
    'bookings','booking_answers','booking_reminders'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create policy %I_select_member on public.%I for select to authenticated using (public.is_organization_member(organization_id))',
      table_name, table_name
    );
    execute format(
      'create policy %I_manage_operator on public.%I for all to authenticated using (public.is_organization_operator(organization_id)) with check (public.is_organization_operator(organization_id))',
      table_name, table_name
    );
  end loop;
end $$;

alter table public.calendar_connections enable row level security;
create policy calendar_connections_select_admin on public.calendar_connections
  for select to authenticated using (public.is_organization_admin(organization_id));
create policy calendar_connections_manage_admin on public.calendar_connections
  for all to authenticated
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));
