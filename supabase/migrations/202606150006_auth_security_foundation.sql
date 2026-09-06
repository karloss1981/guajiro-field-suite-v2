-- Guajiro Field Operations Suite
-- Supabase Auth, user profiles, role bootstrap, hashed PINs, and staged security controls.
-- This migration is intentionally backward compatible: legacy_access_enabled starts TRUE.
-- After accounts, profiles, and roles are assigned, an admin can call:
--   select public.set_legacy_access_enabled(false);

create extension if not exists pgcrypto;

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.app_settings(key, value)
values ('legacy_access_enabled', 'true'::jsonb)
on conflict (key) do nothing;

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  region text check (region in ('miami','swfl')),
  technician_id text references public.technicians(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists user_profiles_technician_unique
  on public.user_profiles(technician_id)
  where technician_id is not null;

create table if not exists public.role_security_pins (
  id uuid primary key default gen_random_uuid(),
  role_name text not null references public.roles(name) on delete cascade,
  region text not null check (region in ('miami','swfl')),
  pin_hash text not null,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  unique(role_name, region)
);

alter table public.technicians add column if not exists pin_hash text;

-- Backfill hashes without deleting the temporary plaintext PIN yet.
update public.technicians
set pin_hash = crypt(pin, gen_salt('bf'))
where pin is not null
  and pin <> ''
  and pin_hash is null;

create or replace function public.is_legacy_access_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select (value #>> '{}')::boolean from public.app_settings where key = 'legacy_access_enabled'),
    true
  );
$$;

create or replace function public.has_any_role(required_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid()
      and r.name = any(required_roles)
  );
$$;

create or replace function public.current_technician_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select technician_id from public.user_profiles where user_id = auth.uid() and active = true;
$$;

create or replace function public.current_user_region()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select region from public.user_profiles where user_id = auth.uid() and active = true;
$$;

create or replace function public.can_read_operations()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_any_role(array['super_admin','admin','supervisor','dispatcher','viewer']);
$$;

create or replace function public.can_manage_operations()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_any_role(array['super_admin','admin','supervisor','dispatcher']);
$$;

create or replace function public.can_administer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_any_role(array['super_admin','admin']);
$$;

create or replace function public.set_legacy_access_enabled(enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_administer() then
    raise exception 'Admin role required';
  end if;
  insert into public.app_settings(key, value, updated_at, updated_by)
  values ('legacy_access_enabled', to_jsonb(enabled), now(), auth.uid())
  on conflict (key) do update
    set value = excluded.value,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;
  return enabled;
end;
$$;

create or replace function public.bootstrap_first_super_admin()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  super_role_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if exists(select 1 from public.user_roles) then
    raise exception 'Bootstrap is only available before the first role assignment';
  end if;
  select id into super_role_id from public.roles where name = 'super_admin';
  if super_role_id is null then
    raise exception 'super_admin role is missing';
  end if;
  insert into public.user_roles(user_id, role_id)
  values (auth.uid(), super_role_id)
  on conflict do nothing;
  insert into public.user_profiles(user_id, display_name, region, active)
  values (
    auth.uid(),
    coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', auth.jwt() ->> 'email', 'Super Admin'),
    coalesce(auth.jwt() -> 'user_metadata' ->> 'region', 'miami'),
    true
  )
  on conflict (user_id) do nothing;
  return true;
end;
$$;

create or replace function public.assign_user_role(target_user_id uuid, target_role text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_role_id uuid;
begin
  if not public.can_administer() then
    raise exception 'Admin role required';
  end if;
  select id into target_role_id from public.roles where name = target_role;
  if target_role_id is null then
    raise exception 'Unknown role: %', target_role;
  end if;
  insert into public.user_roles(user_id, role_id)
  values (target_user_id, target_role_id)
  on conflict do nothing;
  return true;
end;
$$;

create or replace function public.upsert_user_profile(
  target_user_id uuid,
  target_display_name text,
  target_region text,
  target_technician_id text default null,
  target_active boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_administer() then
    raise exception 'Admin role required';
  end if;
  insert into public.user_profiles(user_id, display_name, region, technician_id, active, updated_at)
  values (target_user_id, target_display_name, target_region, target_technician_id, target_active, now())
  on conflict (user_id) do update
    set display_name = excluded.display_name,
        region = excluded.region,
        technician_id = excluded.technician_id,
        active = excluded.active,
        updated_at = now();
  return true;
end;
$$;

create or replace function public.verify_role_security_pin(p_role text, p_region text, p_pin text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.role_security_pins
    where role_name = p_role
      and region = p_region
      and active = true
      and pin_hash = crypt(p_pin, pin_hash)
  );
$$;

create or replace function public.set_role_security_pin(p_role text, p_region text, p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_administer() then
    raise exception 'Admin role required';
  end if;
  if p_pin !~ '^\d{4,8}$' then
    raise exception 'PIN must contain 4 to 8 digits';
  end if;
  insert into public.role_security_pins(role_name, region, pin_hash, active, updated_at, updated_by)
  values (p_role, p_region, crypt(p_pin, gen_salt('bf')), true, now(), auth.uid())
  on conflict (role_name, region) do update
    set pin_hash = excluded.pin_hash,
        active = true,
        updated_at = now(),
        updated_by = auth.uid();
  return true;
end;
$$;

create or replace function public.verify_technician_pin(p_technician_id text, p_pin text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.technicians
    where id = p_technician_id
      and active = true
      and (
        (pin_hash is not null and pin_hash = crypt(p_pin, pin_hash))
        or (public.is_legacy_access_enabled() and pin is not null and pin = p_pin)
      )
  );
$$;

create or replace function public.admin_set_technician_pin(p_technician_id text, p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_administer() and not public.has_any_role(array['supervisor']) then
    raise exception 'Supervisor or admin role required';
  end if;
  if p_pin !~ '^\d{4,8}$' then
    raise exception 'PIN must contain 4 to 8 digits';
  end if;
  update public.technicians
  set pin_hash = crypt(p_pin, gen_salt('bf')),
      pin = case when public.is_legacy_access_enabled() then p_pin else null end
  where id = p_technician_id;
  if not found then raise exception 'Technician not found'; end if;
  return true;
end;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles(user_id, display_name, region, technician_id, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', new.email),
    case when new.raw_user_meta_data ->> 'region' in ('miami','swfl') then new.raw_user_meta_data ->> 'region' else 'miami' end,
    nullif(new.raw_user_meta_data ->> 'technician_id',''),
    true
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_gfs on auth.users;
create trigger on_auth_user_created_gfs
after insert on auth.users
for each row execute function public.handle_new_auth_user();

alter table public.app_settings enable row level security;
alter table public.user_profiles enable row level security;
alter table public.role_security_pins enable row level security;

drop policy if exists app_settings_read_admin on public.app_settings;
create policy app_settings_read_admin on public.app_settings
for select to authenticated
using (public.can_administer());

drop policy if exists user_profiles_read on public.user_profiles;
create policy user_profiles_read on public.user_profiles
for select to authenticated
using (user_id = auth.uid() or public.can_read_operations());

drop policy if exists user_profiles_manage_admin on public.user_profiles;
create policy user_profiles_manage_admin on public.user_profiles
for all to authenticated
using (public.can_administer())
with check (public.can_administer());

drop policy if exists role_security_pins_admin_only on public.role_security_pins;
create policy role_security_pins_admin_only on public.role_security_pins
for all to authenticated
using (public.can_administer())
with check (public.can_administer());

revoke all on public.role_security_pins from anon, authenticated;
grant execute on function public.verify_role_security_pin(text,text,text) to authenticated, anon;
grant execute on function public.verify_technician_pin(text,text) to authenticated, anon;
grant execute on function public.set_role_security_pin(text,text,text) to authenticated;
grant execute on function public.admin_set_technician_pin(text,text) to authenticated;
grant execute on function public.bootstrap_first_super_admin() to authenticated;
grant execute on function public.assign_user_role(uuid,text) to authenticated;
grant execute on function public.upsert_user_profile(uuid,text,text,text,boolean) to authenticated;
grant execute on function public.set_legacy_access_enabled(boolean) to authenticated;
