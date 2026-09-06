-- Guajiro Field Suite PWA v2 migration
-- Adds operational roles, audit logs, and safer helper functions.

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

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  created_at timestamptz default now(),
  unique(user_id, role_id)
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity text not null,
  entity_id text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create or replace function public.has_role(required_role text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid()
      and r.name = required_role
  );
$$;

alter table public.roles enable row level security;
alter table public.user_roles enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists roles_read_authenticated on public.roles;
create policy roles_read_authenticated on public.roles
for select to authenticated
using (true);

drop policy if exists user_roles_read_own on public.user_roles;
create policy user_roles_read_own on public.user_roles
for select to authenticated
using (user_id = auth.uid() or public.has_role('admin') or public.has_role('super_admin'));

drop policy if exists user_roles_manage_admin on public.user_roles;
create policy user_roles_manage_admin on public.user_roles
for all to authenticated
using (public.has_role('admin') or public.has_role('super_admin'))
with check (public.has_role('admin') or public.has_role('super_admin'));

drop policy if exists audit_insert_authenticated on public.audit_logs;
create policy audit_insert_authenticated on public.audit_logs
for insert to authenticated
with check (user_id = auth.uid() or user_id is null);

drop policy if exists audit_read_managers on public.audit_logs;
create policy audit_read_managers on public.audit_logs
for select to authenticated
using (public.has_role('admin') or public.has_role('super_admin') or public.has_role('supervisor'));
