-- Temporary compatibility policy for the current pre-Supabase-Auth application.
--
-- The browser currently writes audit events with the Supabase anon role and no
-- authenticated session. The original audit_insert_authenticated policy therefore
-- rejects those inserts under RLS.
--
-- Security limitation: anon clients can still fabricate action/entity/metadata.
-- Keep user_id NULL for anon inserts so an anonymous client cannot impersonate an
-- auth.users identity. Remove this policy after Supabase Auth and role-based RLS
-- are fully deployed.

alter table public.audit_logs enable row level security;

grant insert on table public.audit_logs to anon;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'audit_logs'
      and policyname = 'audit_insert_anon_legacy_compat'
  ) then
    create policy audit_insert_anon_legacy_compat
      on public.audit_logs
      for insert
      to anon
      with check (user_id is null);
  end if;
end
$$;

comment on policy audit_insert_anon_legacy_compat on public.audit_logs is
  'TEMPORARY: allows the legacy anonymous PWA to persist audit rows with user_id NULL. Remove after Supabase Auth and role-scoped RLS are live.';
