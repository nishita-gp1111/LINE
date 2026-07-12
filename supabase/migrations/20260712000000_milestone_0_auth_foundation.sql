-- Milestone 0: Auth and organization RLS foundation.
-- No LINE, campaign, survey, or CRM business tables are included here.

create extension if not exists pgcrypto;

create type public.app_role as enum ('owner', 'admin', 'member');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (organization_id, profile_id)
);

create index organization_members_profile_idx
  on public.organization_members (profile_id);

create index organization_members_organization_idx
  on public.organization_members (organization_id);

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(coalesce(new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1)), '')
  )
  on conflict (id) do update
    set email = excluded.email,
        display_name = coalesce(excluded.display_name, public.profiles.display_name),
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create or replace function public.is_organization_member(target_organization_id uuid)
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
  );
$$;

create or replace function public.is_organization_admin(target_organization_id uuid)
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
      and role in ('owner', 'admin')
  );
$$;

create or replace function public.can_bootstrap_organization(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organizations
    where id = target_organization_id
      and created_by = auth.uid()
  )
  and not exists (
    select 1
    from public.organization_members
    where organization_id = target_organization_id
  );
$$;

revoke execute on function public.handle_new_auth_user() from public;
revoke execute on function public.is_organization_member(uuid) from public;
revoke execute on function public.is_organization_admin(uuid) from public;
revoke execute on function public.can_bootstrap_organization(uuid) from public;
grant execute on function public.is_organization_member(uuid) to authenticated;
grant execute on function public.is_organization_admin(uuid) to authenticated;
grant execute on function public.can_bootstrap_organization(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy organizations_insert_creator on public.organizations
  for insert to authenticated with check (created_by = auth.uid());

create policy organizations_member_access on public.organizations
  for select to authenticated using (public.is_organization_member(id));

create policy organizations_admin_update on public.organizations
  for update to authenticated
  using (public.is_organization_admin(id))
  with check (public.is_organization_admin(id));

create policy organization_members_select_member on public.organization_members
  for select to authenticated
  using (public.is_organization_member(organization_id));

create policy organization_members_bootstrap_owner on public.organization_members
  for insert to authenticated
  with check (
    profile_id = auth.uid()
    and role = 'owner'
    and public.can_bootstrap_organization(organization_id)
  );

create policy organization_members_manage_admin on public.organization_members
  for all to authenticated
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));
