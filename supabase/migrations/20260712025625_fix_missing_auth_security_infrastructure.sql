/*
# Fix Missing Auth/Security Infrastructure & Route Columns

## Purpose
Brings the database schema in sync with the frontend code so that technician PIN
login, supervisor PIN login, admin email login, route loading, GPS consent, and
audit logging all work correctly. Migrations 006-024 were never applied.

## New Tables
- roles, user_roles, user_profiles, app_settings, role_security_pins, audit_logs

## Modified Tables
- routes: add reason, job_note, updated_at
- technicians: add gps_consent, pin_hash, specialties

## New RPCs
- verify_technician_pin, verify_role_security_pin, set_role_security_pin
- admin_set_technician_pin, admin_clear_technician_pin
- is_legacy_access_enabled, is_admin_email_required, is_technician_pin_access_enabled
- is_secure_role_email_login_enabled, current_app_role, current_technician_id
- current_user_region, has_any_role, can_read_operations, can_manage_operations
- can_administer, bootstrap_first_super_admin, assign_user_role, upsert_user_profile

## Security
- RLS enabled on all new tables
- Operational tables remain anon-accessible (PIN-based field mode)
*/

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  label text,
  created_at timestamptz default now()
);

insert into public.roles(name, label) values
  ('super_admin', 'Super Admin'),
  ('admin', 'Admin'),
  ('supervisor', 'Supervisor'),
  ('dispatcher', 'Dispatcher'),
  ('technician', 'Technician'),
  ('viewer', 'Viewer')
on conflict (name) do update set label = excluded.label;

-- ---------------------------------------------------------------------------
-- User roles
-- ---------------------------------------------------------------------------
create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  created_at timestamptz default now(),
  unique(user_id, role_id)
);

-- ---------------------------------------------------------------------------
-- User profiles
-- ---------------------------------------------------------------------------
create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  email text,
  region text check (region in ('miami','swfl')),
  role text,
  technician_id text references public.technicians(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists user_profiles_technician_unique
  on public.user_profiles(technician_id)
  where technician_id is not null;

-- ---------------------------------------------------------------------------
-- App settings
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.app_settings(key, value)
values
  ('legacy_access_enabled', 'true'::jsonb),
  ('admin_email_required', 'true'::jsonb),
  ('technician_pin_access_enabled', 'true'::jsonb),
  ('secure_role_email_login_enabled', 'true'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Role security pins (hashed)
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

-- ---------------------------------------------------------------------------
-- Audit logs
-- ---------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity text not null,
  entity_id text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_audit_logs_created_at on public.audit_logs(created_at desc);
create index if not exists idx_audit_logs_entity on public.audit_logs(entity, entity_id);

-- ---------------------------------------------------------------------------
-- Add missing columns to routes
-- ---------------------------------------------------------------------------
alter table public.routes add column if not exists reason text;
alter table public.routes add column if not exists job_note text;
alter table public.routes add column if not exists updated_at timestamptz default now();

-- ---------------------------------------------------------------------------
-- Add missing columns to technicians
-- ---------------------------------------------------------------------------
alter table public.technicians add column if not exists gps_consent boolean default true;
alter table public.technicians add column if not exists pin_hash text;
alter table public.technicians add column if not exists specialties text[] default '{}';

-- Backfill pin_hash from plaintext pin (pgcrypto is in schema "extensions")
update public.technicians
set pin_hash = extensions.crypt(pin, extensions.gen_salt('bf'))
where pin is not null and pin <> '' and pin_hash is null;

-- ---------------------------------------------------------------------------
-- RPC: Settings helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_legacy_access_enabled()
returns boolean
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce((select (value #>> '{}')::boolean from public.app_settings where key = 'legacy_access_enabled'), true);
$$;

create or replace function public.is_admin_email_required()
returns boolean
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce((select (value #>> '{}')::boolean from public.app_settings where key = 'admin_email_required'), true);
$$;

create or replace function public.is_technician_pin_access_enabled()
returns boolean
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce((select (value #>> '{}')::boolean from public.app_settings where key = 'technician_pin_access_enabled'), true);
$$;

create or replace function public.is_secure_role_email_login_enabled()
returns boolean
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce((select (value #>> '{}')::boolean from public.app_settings where key = 'secure_role_email_login_enabled'), true);
$$;

-- ---------------------------------------------------------------------------
-- RPC: Role helpers
-- ---------------------------------------------------------------------------
create or replace function public.has_any_role(required_roles text[])
returns boolean
language sql stable security definer set search_path = public
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

create or replace function public.current_app_role()
returns text
language sql stable security definer set search_path = public
as $$
  select r.name
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  join public.user_profiles up on up.user_id = ur.user_id
  where ur.user_id = auth.uid() and up.active = true
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

create or replace function public.current_technician_id()
returns text
language sql stable security definer set search_path = public
as $$
  select technician_id from public.user_profiles where user_id = auth.uid() and active = true;
$$;

create or replace function public.current_user_region()
returns text
language sql stable security definer set search_path = public
as $$
  select region from public.user_profiles where user_id = auth.uid() and active = true;
$$;

create or replace function public.can_read_operations()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.has_any_role(array['super_admin','admin','supervisor','dispatcher','viewer']);
$$;

create or replace function public.can_manage_operations()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.has_any_role(array['super_admin','admin','supervisor','dispatcher']);
$$;

create or replace function public.can_administer()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.has_any_role(array['super_admin','admin']);
$$;

-- ---------------------------------------------------------------------------
-- RPC: PIN verification
-- ---------------------------------------------------------------------------
create or replace function public.verify_technician_pin(p_technician_id text, p_pin text)
returns boolean
language sql stable security definer set search_path = public, extensions
as $$
  select public.is_technician_pin_access_enabled() and exists (
    select 1
    from public.technicians
    where id = p_technician_id
      and active = true
      and (
        (pin_hash is not null and pin_hash = extensions.crypt(p_pin, pin_hash))
        or (public.is_legacy_access_enabled() and pin is not null and pin = p_pin)
      )
  );
$$;

create or replace function public.verify_role_security_pin(p_role text, p_region text, p_pin text)
returns boolean
language sql stable security definer set search_path = public, extensions
as $$
  select case
    when p_role = 'admin' and public.is_admin_email_required() and auth.uid() is null then false
    else exists (
      select 1
      from public.role_security_pins
      where role_name = p_role
        and region = p_region
        and active = true
        and pin_hash = extensions.crypt(p_pin, pin_hash)
    )
  end;
$$;

create or replace function public.set_role_security_pin(p_role text, p_region text, p_pin text)
returns boolean
language plpgsql security definer set search_path = public, extensions
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
  values (p_role, p_region, extensions.crypt(p_pin, extensions.gen_salt('bf')), true, now(), auth.uid())
  on conflict (role_name, region) do update
    set pin_hash = excluded.pin_hash,
        active = true,
        updated_at = now(),
        updated_by = auth.uid();
  return true;
end;
$$;

create or replace function public.admin_set_technician_pin(p_technician_id text, p_pin text)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if not public.can_administer() and not public.has_any_role(array['supervisor']) then
    raise exception 'Supervisor or admin role required';
  end if;
  if p_pin !~ '^\d{4,8}$' then
    raise exception 'PIN must contain 4 to 8 digits';
  end if;
  update public.technicians
  set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')),
      pin = case when public.is_legacy_access_enabled() then p_pin else null end
  where id = p_technician_id;
  if not found then raise exception 'Technician not found'; end if;
  return true;
end;
$$;

create or replace function public.admin_clear_technician_pin(p_technician_id text)
returns boolean
language plpgsql security definer set search_path = public
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
-- RPC: Bootstrap & user management
-- ---------------------------------------------------------------------------
create or replace function public.bootstrap_first_super_admin()
returns boolean
language plpgsql security definer set search_path = public
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
language plpgsql security definer set search_path = public
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
language plpgsql security definer set search_path = public
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

-- ---------------------------------------------------------------------------
-- Trigger: auto-create profile on new auth user
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.user_profiles(user_id, display_name, region, email, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', new.email),
    case when new.raw_user_meta_data ->> 'region' in ('miami','swfl') then new.raw_user_meta_data ->> 'region' else 'miami' end,
    new.email,
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

-- ---------------------------------------------------------------------------
-- RLS: Enable on all new tables
-- ---------------------------------------------------------------------------
alter table public.roles enable row level security;
alter table public.user_roles enable row level security;
alter table public.user_profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.role_security_pins enable row level security;
alter table public.audit_logs enable row level security;

-- ---------------------------------------------------------------------------
-- RLS: Policies
-- ---------------------------------------------------------------------------
drop policy if exists roles_read_authenticated on public.roles;
create policy roles_read_authenticated on public.roles
  for select to authenticated using (true);

drop policy if exists user_roles_read_own on public.user_roles;
create policy user_roles_read_own on public.user_roles
  for select to authenticated
  using (user_id = auth.uid() or public.can_administer());

drop policy if exists user_roles_manage_admin on public.user_roles;
create policy user_roles_manage_admin on public.user_roles
  for all to authenticated
  using (public.can_administer())
  with check (public.can_administer());

drop policy if exists user_profiles_read on public.user_profiles;
create policy user_profiles_read on public.user_profiles
  for select to authenticated
  using (user_id = auth.uid() or public.can_read_operations());

drop policy if exists user_profiles_manage_admin on public.user_profiles;
create policy user_profiles_manage_admin on public.user_profiles
  for all to authenticated
  using (public.can_administer())
  with check (public.can_administer());

drop policy if exists app_settings_read_admin on public.app_settings;
create policy app_settings_read_admin on public.app_settings
  for select to authenticated
  using (public.can_administer());

drop policy if exists role_security_pins_admin_only on public.role_security_pins;
create policy role_security_pins_admin_only on public.role_security_pins
  for all to authenticated
  using (public.can_administer())
  with check (public.can_administer());

drop policy if exists audit_insert_authenticated on public.audit_logs;
create policy audit_insert_authenticated on public.audit_logs
  for insert to authenticated
  with check (user_id = auth.uid() or user_id is null);

drop policy if exists audit_insert_anon on public.audit_logs;
create policy audit_insert_anon on public.audit_logs
  for insert to anon
  with check (user_id is null);

drop policy if exists audit_read_managers on public.audit_logs;
create policy audit_read_managers on public.audit_logs
  for select to authenticated
  using (public.has_any_role(array['super_admin','admin','supervisor']));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on table public.app_settings from anon;
revoke all on table public.user_profiles from anon;
revoke all on table public.user_roles from anon;
revoke all on table public.role_security_pins from anon;

revoke all on table public.role_security_pins from authenticated;
grant select on table public.user_profiles to authenticated;
grant select on table public.user_roles to authenticated;
grant select on table public.roles to authenticated;

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
grant execute on function public.bootstrap_first_super_admin() to authenticated;
grant execute on function public.assign_user_role(uuid,text) to authenticated;
grant execute on function public.upsert_user_profile(uuid,text,text,text,boolean) to authenticated;
