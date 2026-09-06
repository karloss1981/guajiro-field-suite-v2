/*
  # Fix routes UPDATE policy

  The existing UPDATE policy had no USING clause, which in Supabase means
  the policy cannot match existing rows and silently blocks all updates.
  This replaces it with a policy that allows updates on all rows (matching
  the existing public read/delete/insert posture of this table).
*/

DROP POLICY IF EXISTS "Public update routes" ON routes;

CREATE POLICY "Public update routes"
  ON routes
  FOR UPDATE
  USING (true)
  WITH CHECK (true);
