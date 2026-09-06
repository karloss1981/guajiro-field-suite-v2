-- Guajiro Field Operations Suite v23.5
-- Security/Auth/RLS hardening layer.
-- Apply after all previous migrations and after SUPABASE_V23_4_INCIDENTS_CENTER.sql.
-- This keeps technician PIN access available while moving Admin/Supervisor/Viewer
-- toward Supabase Auth and hashed PIN / step-up checks.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Security settings
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.app_settings(key, value, updated_at, updated_by)
values
  ('legacy_access_enabled', 'true'::jsonb, now(), auth.uid()),
  ('admin_email_required', 'true'::jsonb, now(), auth.uid()),
  ('technician_pin_access_enabled', 'true'::jsonb, now(), auth.uid()),
  ('secure_role_email_login_enabled', 'true'::jsonb, now(), auth.uid())
on conflict (key) do update
  set value = excluded.value,
      updated_at = excluded.updated_at,
      updated_by = auth.uid();

create or replace function public.is_legacy_access_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (value #>> '{}')::boolean from public.app_settings where key = 'legacy_access_enabled'), true);
$$;

create or replace function public.is_admin_email_required()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (value #>> '{}')::boolean from public.app_settings where key = 'admin_email_required'), true);
$$;

create or replace function public.is_technician_pin_access_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (value #>> '{}')::boolean from public.app_settings where key = 'technician_pin_access_enabled'), true);
$$;

create or replace function public.is_secure_role_email_login_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (value #>> '{}')::boolean from public.app_settings where key = 'secure_role_email_login_enabled'), true);
$$;

-- ---------------------------------------------------------------------------
-- Profiles, role helpers, and role resolution
-- ---------------------------------------------------------------------------
alter table if exists public.user_profiles add column if not exists email text;
alter table if exists public.user_profiles add column if not exists role text;

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select r.name
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where ur.user_id = auth.uid()
  order by case r.name
    when 'super_admin' then 1
    when 'admin' then 2
    when 'supervisor' then 3
    when 'dispatcher' then 4
    when 'viewer' then 5
    when 'technician' then 6
    else 99 end
  limit 1;
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
    join public.user_profiles up on up.user_id = ur.user_id
    where ur.user_id = auth.uid()
      and up.active = true
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

-- ---------------------------------------------------------------------------
-- Hashed role and technician PINs
-- ---------------------------------------------------------------------------
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
update public.technicians
set pin_hash = crypt(pin, gen_salt('bf'))
where pin is not null and pin <> '' and pin_hash is null;

create or replace function public.verify_role_security_pin(p_role text, p_region text, p_pin text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_role = 'admin' and public.is_admin_email_required() and auth.uid() is null then false
    else exists (
      select 1
      from public.role_security_pins
      where role_name = p_role
        and region = p_region
        and active = true
        and pin_hash = crypt(p_pin, pin_hash)
    )
  end;
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
  if p_role not in ('admin','supervisor','viewer') then
    raise exception 'Unsupported role PIN target';
  end if;
  if p_region not in ('miami','swfl') then
    raise exception 'Unsupported region';
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
  select public.is_technician_pin_access_enabled() and exists (
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

create or replace function public.admin_clear_technician_pin(p_technician_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_administer() and not public.has_any_role(array['supervisor']) then
    raise exception 'Supervisor or admin role required';
  end if;
  update public.technicians
  set pin_hash = null,
      pin = null
  where id = p_technician_id;
  if not found then raise exception 'Technician not found'; end if;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS safety rails for sensitive configuration tables
-- ---------------------------------------------------------------------------
alter table public.app_settings enable row level security;
alter table public.user_profiles enable row level security;
alter table public.role_security_pins enable row level security;

revoke all on table public.app_settings from anon;
revoke all on table public.user_profiles from anon;
revoke all on table public.user_roles from anon;
revoke all on table public.role_security_pins from anon;

revoke all on table public.role_security_pins from authenticated;
grant select on table public.user_profiles to authenticated;
grant select on table public.user_roles to authenticated;

drop policy if exists app_settings_read_admin on public.app_settings;
create policy app_settings_read_admin on public.app_settings for select to authenticated
using (public.can_administer());

drop policy if exists user_profiles_read_scoped_v235 on public.user_profiles;
create policy user_profiles_read_scoped_v235 on public.user_profiles for select to authenticated
using (user_id = auth.uid() or public.can_read_operations());

drop policy if exists user_profiles_manage_admin_v235 on public.user_profiles;
create policy user_profiles_manage_admin_v235 on public.user_profiles for all to authenticated
using (public.can_administer())
with check (public.can_administer());

drop policy if exists role_security_pins_admin_only_v235 on public.role_security_pins;
create policy role_security_pins_admin_only_v235 on public.role_security_pins for all to authenticated
using (public.can_administer())
with check (public.can_administer());

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant execute on function public.is_legacy_access_enabled() to anon, authenticated;
grant execute on function public.is_admin_email_required() to anon, authenticated;
grant execute on function public.is_technician_pin_access_enabled() to anon, authenticated;
grant execute on function public.is_secure_role_email_login_enabled() to anon, authenticated;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.verify_role_security_pin(text,text,text) to anon, authenticated;
grant execute on function public.set_role_security_pin(text,text,text) to authenticated;
grant execute on function public.verify_technician_pin(text,text) to anon, authenticated;
grant execute on function public.admin_set_technician_pin(text,text) to authenticated;
grant execute on function public.admin_clear_technician_pin(text) to authenticated;

-- IMPORTANT:
-- Do not run select public.set_legacy_access_enabled(false) until every technician
-- has a Supabase Auth session or a server-side PIN exchange. Current PWA field mode
-- still needs anon RPC verify_technician_pin for technicians.
