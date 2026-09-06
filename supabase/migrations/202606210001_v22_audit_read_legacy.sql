-- v22.0 Audit/RLS compatibility fix.
-- Current PWA still runs in legacy browser mode with the anon key. This keeps
-- audit inserts and supervisor trace reads working until full Supabase Auth is
-- turned on and legacy access is disabled with public.set_legacy_access_enabled(false).

alter table public.audit_logs enable row level security;

grant select, insert on table public.audit_logs to anon, authenticated;

drop policy if exists audit_insert_anon_legacy_compat on public.audit_logs;
create policy audit_insert_anon_legacy_compat
  on public.audit_logs
  for insert
  to anon
  with check (public.is_legacy_access_enabled() and user_id is null);

drop policy if exists audit_read_anon_legacy_compat on public.audit_logs;
create policy audit_read_anon_legacy_compat
  on public.audit_logs
  for select
  to anon
  using (public.is_legacy_access_enabled());

drop policy if exists audit_read_managers on public.audit_logs;
create policy audit_read_managers
  on public.audit_logs
  for select
  to authenticated
  using (
    public.has_role('admin')
    or public.has_role('super_admin')
    or public.has_role('supervisor')
    or public.has_role('dispatcher')
  );

comment on policy audit_read_anon_legacy_compat on public.audit_logs is
  'TEMPORARY v22.0: lets the legacy PWA supervisor Trace tab read audit rows while legacy_access_enabled is true. Remove after real Auth/RLS rollout.';
