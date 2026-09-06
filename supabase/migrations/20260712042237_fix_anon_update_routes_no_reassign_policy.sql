/*
# Fix anon_update_routes_no_reassign policy subquery

1. Security
- The `anon_update_routes_no_reassign` policy on `routes` has a broken subquery:
  `tech_id = (SELECT routes_1.tech_id FROM routes routes_1 WHERE routes_1.id = routes_1.id)`
  This compares `routes_1.id` to itself (always true), returning ALL rows → "more than one row returned by a subquery used as an expression".
- Fixed to reference the outer `routes.id`:
  `tech_id = (SELECT routes_1.tech_id FROM routes routes_1 WHERE routes_1.id = routes.id)`
  Now returns exactly one row (the row being updated), preventing tech_id reassignment.
*/

DROP POLICY IF EXISTS "anon_update_routes_no_reassign" ON routes;
CREATE POLICY "anon_update_routes_no_reassign" ON routes FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (tech_id = (SELECT routes_1.tech_id FROM routes routes_1 WHERE routes_1.id = routes.id));
