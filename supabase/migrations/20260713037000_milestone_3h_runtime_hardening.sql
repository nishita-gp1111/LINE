-- Milestone 3H runtime hardening. Existing migrations remain unchanged.
-- This migration creates a private bucket and uses Storage API for object operations.

create extension if not exists pg_cron;
create extension if not exists pg_net;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('line-media', 'line-media', false, 52428800, array['image/jpeg','image/png','video/mp4','audio/mpeg','audio/mp4','audio/x-m4a'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
alter table public.media_assets alter column storage_bucket set default 'line-media';
alter table public.media_assets alter column public_url drop not null;

drop policy if exists line_media_select_member on storage.objects;
create policy line_media_select_member on storage.objects for select to authenticated
  using (bucket_id = 'line-media' and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' and public.is_organization_member((storage.foldername(name))[1]::uuid));
drop policy if exists line_media_insert_operator on storage.objects;
create policy line_media_insert_operator on storage.objects for insert to authenticated
  with check (bucket_id = 'line-media' and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' and public.is_organization_operator((storage.foldername(name))[1]::uuid));
drop policy if exists line_media_update_operator on storage.objects;
create policy line_media_update_operator on storage.objects for update to authenticated
  using (bucket_id = 'line-media' and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' and public.is_organization_operator((storage.foldername(name))[1]::uuid))
  with check (bucket_id = 'line-media' and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' and public.is_organization_operator((storage.foldername(name))[1]::uuid));
drop policy if exists line_media_delete_admin on storage.objects;
create policy line_media_delete_admin on storage.objects for delete to authenticated
  using (bucket_id = 'line-media' and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' and public.is_organization_admin((storage.foldername(name))[1]::uuid));

create or replace function public.claim_due_scheduled_jobs(target_limit integer, target_lease_owner text, target_now timestamptz, target_lease_seconds integer)
returns setof public.scheduled_jobs language plpgsql security definer set search_path = public as $$
begin
  return query
  with candidates as (
    select j.id from public.scheduled_jobs j
    where (j.status in ('pending','retry_wait') and coalesce(j.next_retry_at, j.run_at) <= target_now)
       or (j.status in ('leased','running') and j.lease_expires_at < target_now)
    order by j.priority desc, j.run_at
    for update skip locked limit least(greatest(target_limit, 1), 50)
  )
  update public.scheduled_jobs j
  set status = 'running', attempt_count = j.attempt_count + 1, lease_owner = target_lease_owner,
      lease_expires_at = target_now + make_interval(secs => least(greatest(target_lease_seconds, 30), 900)), updated_at = target_now
  from candidates c where j.id = c.id returning j.*;
end;
$$;

create or replace function public.complete_scheduled_job(target_job_id uuid, target_lease_owner text, target_status text, target_error_safe text)
returns boolean language sql security definer set search_path = public as $$
  update public.scheduled_jobs set status = target_status, last_error_safe = left(target_error_safe, 500), lease_owner = null, lease_expires_at = null, completed_at = case when target_status = 'succeeded' then now() else completed_at end, updated_at = now() where id = target_job_id and lease_owner = target_lease_owner returning true;
$$;

create or replace function public.record_scheduler_heartbeat(target_organization_id uuid, target_provider text, target_status text, target_error_safe text)
returns void language sql security definer set search_path = public as $$
  insert into public.scheduler_heartbeats (organization_id, provider, status, last_started_at, last_completed_at, last_error_safe)
  values (target_organization_id, target_provider, target_status, now(), case when target_status = 'healthy' then now() else null end, left(target_error_safe, 500))
  on conflict (organization_id, provider) do update set status = excluded.status, last_started_at = excluded.last_started_at, last_completed_at = excluded.last_completed_at, last_error_safe = excluded.last_error_safe, updated_at = now();
$$;

revoke execute on function public.claim_due_scheduled_jobs(integer, text, timestamptz, integer) from public;
revoke execute on function public.complete_scheduled_job(uuid, text, text, text) from public;
revoke execute on function public.record_scheduler_heartbeat(uuid, text, text, text) from public;
grant execute on function public.claim_due_scheduled_jobs(integer, text, timestamptz, integer) to service_role;
grant execute on function public.complete_scheduled_job(uuid, text, text, text) to service_role;
grant execute on function public.record_scheduler_heartbeat(uuid, text, text, text) to service_role;
