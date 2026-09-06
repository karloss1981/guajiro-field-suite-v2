-- ============================================================================
-- GUAJIRO V25.1 — Super Admin route delete RPC
-- Migration: 202607010001_v25_1_super_admin_route_delete_rpc.sql
--
-- Purpose:
--   Close the DB-level gap where the frontend blocked whole-route deletion
--   for non-Super-Admins, but a direct API call could still delete rows in
--   public.routes whenever legacy mode was enabled or the caller had the
--   'admin' role (policy routes_delete_scoped).
--
--   This RPC is the ONLY sanctioned path for whole-route deletion from
--   V25.1 onward. It validates Super Admin INSIDE the function (SECURITY
--   DEFINER), so the check cannot be bypassed by the anon key, legacy mode,
--   or a lesser role.
--
-- Phased plan (do NOT skip ahead):
--   V25.1 (this file): whole-route delete goes through this RPC.
--   V25.2: move Publish/Replace Route to a dedicated RPC.
--   V25.3: harden routes_delete_scoped to block direct DELETE entirely.
--   The delete policy is intentionally NOT tightened here because
--   Publish Route still replaces existing routes with delete+insert.
-- ============================================================================

-- Who counts as Super Admin at the database level:
--   1) the account holds the 'super_admin' role in user_roles, OR
--   2) the JWT email is the official Super Admin email.
-- The email is a safety net mirroring src/services/superAdminAuth.service.ts.
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.has_any_role(array['super_admin'])
    or lower(coalesce(auth.jwt() ->> 'email', '')) = 'karloss1981@gmail.com';
$$;

revoke all on function public.is_super_admin() from public;
grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.is_super_admin() to anon;

create or replace function public.super_admin_delete_route(
  p_region text,
  p_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  -- Hard requirement #1: a real authenticated Supabase session.
  -- The anon key alone (auth.uid() is null) can NEVER run this, which is
  -- what structurally excludes every PIN/legacy login.
  if auth.uid() is null then
    raise exception 'Active Super Admin session required (authenticated email/password login).';
  end if;

  -- Hard requirement #2: Super Admin role or official Super Admin email.
  if not public.is_super_admin() then
    -- Server-side denial trail, independent of the frontend audit log.
    insert into public.audit_logs (user_id, action, entity, entity_id, metadata)
    values (
      auth.uid(),
      'route_delete_denied',
      'route',
      p_region || ':' || p_date::text,
      jsonb_build_object(
        'source', 'super_admin_delete_route',
        'attempted_by_email', v_email,
        'attempted_by_uid', auth.uid()::text
      )
    );
    raise exception 'Only a Super Admin can delete a whole route.';
  end if;

  -- Basic input safety: only known regions, never an open-ended delete.
  if p_region is null or p_region not in ('miami', 'swfl') then
    raise exception 'Invalid region: %', coalesce(p_region, '(null)');
  end if;
  if p_date is null then
    raise exception 'Route date is required.';
  end if;

  delete from public.routes
  where region = p_region
    and date = p_date;
  get diagnostics v_deleted = row_count;

  -- Server-side success trail.
  insert into public.audit_logs (user_id, action, entity, entity_id, metadata)
  values (
    auth.uid(),
    'route_delete_success',
    'route',
    p_region || ':' || p_date::text,
    jsonb_build_object(
      'source', 'super_admin_delete_route',
      'actor_email', v_email,
      'actor_uid', auth.uid()::text,
      'deleted_count', v_deleted
    )
  );

  return jsonb_build_object(
    'ok', true,
    'region', p_region,
    'date', p_date::text,
    'deleted_count', v_deleted
  );
end;
$$;

-- Only authenticated sessions may even attempt the RPC. The anon role is
-- deliberately excluded: PIN/legacy logins run on the anon key.
revoke all on function public.super_admin_delete_route(text, date) from public;
revoke all on function public.super_admin_delete_route(text, date) from anon;
grant execute on function public.super_admin_delete_route(text, date) to authenticated;
