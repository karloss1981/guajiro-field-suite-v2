-- Guajiro Field Operations Suite
-- Admin user-management helpers and safer Auth profile provisioning.
-- Apply after 202606150006_auth_security_foundation.sql.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_technician_id text;
begin
  requested_technician_id := nullif(new.raw_user_meta_data ->> 'technician_id','');
  if requested_technician_id is not null and not exists (
    select 1 from public.technicians where id = requested_technician_id
  ) then
    requested_technician_id := null;
  end if;

  insert into public.user_profiles(user_id, display_name, region, technician_id, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', new.email),
    case when new.raw_user_meta_data ->> 'region' in ('miami','swfl') then new.raw_user_meta_data ->> 'region' else 'miami' end,
    requested_technician_id,
    true
  )
  on conflict (user_id) do update
    set display_name = coalesce(excluded.display_name, public.user_profiles.display_name),
        region = coalesce(excluded.region, public.user_profiles.region),
        technician_id = coalesce(excluded.technician_id, public.user_profiles.technician_id),
        updated_at = now();
  return new;
end;
$$;

create or replace function public.replace_user_role(target_user_id uuid, target_role text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_role_id uuid;
  target_is_super_admin boolean;
  super_admin_count integer;
begin
  if not public.can_administer() then
    raise exception 'Admin role required';
  end if;

  if target_role = 'super_admin' and not public.has_any_role(array['super_admin']) then
    raise exception 'Only a Super Admin can assign the Super Admin role';
  end if;

  select id into target_role_id from public.roles where name = target_role;
  if target_role_id is null then
    raise exception 'Unknown role: %', target_role;
  end if;

  select exists(
    select 1 from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = target_user_id and r.name = 'super_admin'
  ) into target_is_super_admin;

  select count(*) into super_admin_count
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where r.name = 'super_admin';

  if target_is_super_admin and target_role <> 'super_admin' and super_admin_count <= 1 then
    raise exception 'The last Super Admin cannot be demoted';
  end if;

  delete from public.user_roles
  where user_id = target_user_id
    and role_id in (select id from public.roles where name in ('super_admin','admin','supervisor','dispatcher','technician','viewer'));

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
declare
  target_is_last_super_admin boolean;
begin
  if not public.can_administer() then
    raise exception 'Admin role required';
  end if;

  if target_region not in ('miami','swfl') then
    raise exception 'Unsupported region';
  end if;

  select (
    exists(
      select 1 from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.user_id = target_user_id and r.name = 'super_admin'
    )
    and (select count(*) from public.user_roles ur join public.roles r on r.id = ur.role_id where r.name = 'super_admin') <= 1
  ) into target_is_last_super_admin;

  if target_is_last_super_admin and not target_active then
    raise exception 'The last Super Admin cannot be deactivated';
  end if;

  if target_technician_id is not null and not exists(select 1 from public.technicians where id = target_technician_id) then
    raise exception 'Technician not found';
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

grant execute on function public.replace_user_role(uuid,text) to authenticated;

grant execute on function public.upsert_user_profile(uuid,text,text,text,boolean) to authenticated;
