/*
# Create route_optimization_events table

1. New Tables
- `route_optimization_events`: logs route optimization events from the technician portal.
  Columns: id (uuid PK), tech_id (text), region (text), reason (text), 
  previous_order (jsonb), new_order (jsonb), latitude (double precision), 
  longitude (double precision), created_by (text), metadata (jsonb), created_at (timestamptz).
2. Security
- RLS enabled. Allow anon + authenticated CRUD (technician portal uses anon key).
*/

CREATE TABLE IF NOT EXISTS route_optimization_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tech_id text,
  region text DEFAULT 'miami',
  reason text,
  previous_order jsonb,
  new_order jsonb,
  latitude double precision,
  longitude double precision,
  created_by text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE route_optimization_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_route_optimization_events" ON route_optimization_events;
CREATE POLICY "anon_read_route_optimization_events" ON route_optimization_events FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_route_optimization_events" ON route_optimization_events;
CREATE POLICY "anon_insert_route_optimization_events" ON route_optimization_events FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_route_optimization_events" ON route_optimization_events;
CREATE POLICY "anon_update_route_optimization_events" ON route_optimization_events FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_route_optimization_events" ON route_optimization_events;
CREATE POLICY "anon_delete_route_optimization_events" ON route_optimization_events FOR DELETE
  TO anon, authenticated USING (true);
