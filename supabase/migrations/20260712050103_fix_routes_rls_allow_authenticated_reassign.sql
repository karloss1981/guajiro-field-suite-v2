/*
# Fix routes RLS to allow authenticated users to reassign jobs

The existing `anon_update_routes_no_reassign` policy blocks any tech_id change
even for authenticated admin/supervisor sessions, because it applies to both
anon AND authenticated roles.

Fix:
- Scope the no-reassign restriction to `anon` only (technicians in the field).
- Add a separate policy that lets authenticated users update freely (including changing tech_id).
*/

DROP POLICY IF EXISTS "anon_update_routes_no_reassign" ON routes;

-- Anon (field technicians): can update but cannot change tech_id
CREATE POLICY "anon_update_routes_no_reassign" ON routes FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (tech_id = (SELECT routes_1.tech_id FROM routes routes_1 WHERE routes_1.id = routes.id));

-- Authenticated (supervisors, admins): full update including reassignment
DROP POLICY IF EXISTS "authenticated_update_routes" ON routes;
CREATE POLICY "authenticated_update_routes" ON routes FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
