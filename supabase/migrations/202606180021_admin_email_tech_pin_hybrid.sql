-- Guajiro Field Operations Suite v21
-- Hybrid access model requested by operations:
--   - Admin / Super Admin access uses Supabase Auth email + password.
--   - Technicians continue using technician PIN access.
--   - Supervisor / Viewer PIN compatibility remains enabled for the transition.
-- This migration does not disable legacy access because technicians still depend on PIN sessions.

create extension if not exists pgcrypto;

insert into public.app_settings(key, value, updated_at, updated_by)
values
  ('admin_email_required', 'true'::jsonb, now(), auth.uid()),
  ('technician_pin_access_enabled', 'true'::jsonb, now(), auth.uid())
on conflict (key) do update
  set value = excluded.value,
      updated_at = excluded.updated_at,
      updated_by = auth.uid();

create or replace function public.is_admin_email_required()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select (value #>> '{}')::boolean from public.app_settings where key = 'admin_email_required'),
    true
  );
$$;

create or replace function public.is_technician_pin_access_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select (value #>> '{}')::boolean from public.app_settings where key = 'technician_pin_access_enabled'),
    true
  );
$$;

-- Admin PIN must no longer grant application login to an anonymous browser.
-- Admins authenticate with Supabase Auth email/password. The role-security PIN can
-- still exist for future step-up checks after an authenticated admin session, but
-- it is not accepted as an anonymous login method.
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

grant execute on function public.is_admin_email_required() to anon, authenticated;
grant execute on function public.is_technician_pin_access_enabled() to anon, authenticated;
grant execute on function public.verify_role_security_pin(text,text,text) to anon, authenticated;

-- Make sure security/admin configuration tables are never readable or writable by anon.
alter table if exists public.app_settings enable row level security;
alter table if exists public.user_profiles enable row level security;
alter table if exists public.role_security_pins enable row level security;

revoke all on table public.app_settings from anon;
revoke all on table public.user_profiles from anon;
revoke all on table public.user_roles from anon;
revoke all on table public.role_security_pins from anon;

-- Operational tables remain in legacy/PIN-compatible mode until technicians are moved
-- to Supabase Auth. Do not call set_legacy_access_enabled(false) yet.
