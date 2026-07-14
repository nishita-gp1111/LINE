-- Allow one active survey per organization to be sent when a user follows.

alter table public.surveys
  add column if not exists send_on_follow boolean not null default false;

with ranked as (
  select
    id,
    row_number() over (
      partition by organization_id
      order by created_at desc, id desc
    ) as position
  from public.surveys
  where status = 'active'
    and send_on_follow = true
)
update public.surveys as survey
set send_on_follow = false,
    updated_at = now()
from ranked
where ranked.id = survey.id
  and ranked.position > 1;

create unique index if not exists surveys_one_active_follow_idx
  on public.surveys (organization_id)
  where status = 'active' and send_on_follow = true;

create or replace function public.minimum_set_follow_survey(
  target_organization_id uuid,
  target_survey_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_id uuid;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(target_organization_id::text || ':follow-survey', 0)
  );

  if target_survey_id is not null and not exists (
    select 1
    from public.surveys
    where organization_id = target_organization_id
      and id = target_survey_id
      and status = 'active'
  ) then
    raise exception 'active_survey_not_found' using errcode = '23503';
  end if;

  update public.surveys
  set send_on_follow = false,
      updated_at = now()
  where organization_id = target_organization_id
    and send_on_follow = true;

  if target_survey_id is not null then
    update public.surveys
    set send_on_follow = true,
        updated_at = now()
    where organization_id = target_organization_id
      and id = target_survey_id
      and status = 'active'
    returning id into selected_id;
  end if;

  return selected_id;
end
$$;

revoke all on function public.minimum_set_follow_survey(uuid, uuid) from public;
grant execute on function public.minimum_set_follow_survey(uuid, uuid) to service_role;
