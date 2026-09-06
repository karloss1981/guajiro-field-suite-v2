/*
# Create technician_breaks table

1. New Tables
- `technician_breaks`: tracks technician lunch/rest breaks from the field portal.
  Columns: id (uuid PK), tech_id (text), region (text), break_type (text),
  start_latitude (double precision), start_longitude (double precision),
  metadata (jsonb), started_at (timestamptz), ended_at (timestamptz), created_at (timestamptz).
2. Security
- RLS enabled. Allow anon + authenticated CRUD (technician portal uses anon key).
*/

CREATE TABLE IF NOT EXISTS technician_breaks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tech_id text,
  region text DEFAULT 'miami',
  break_type text DEFAULT 'lunch',
  start_latitude double precision,
  start_longitude double precision,
  metadata jsonb DEFAULT '{}'::jsonb,
  started_at timestamptz DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE technician_breaks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_technician_breaks" ON technician_breaks;
CREATE POLICY "anon_read_technician_breaks" ON technician_breaks FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_technician_breaks" ON technician_breaks;
CREATE POLICY "anon_insert_technician_breaks" ON technician_breaks FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_technician_breaks" ON technician_breaks;
CREATE POLICY "anon_update_technician_breaks" ON technician_breaks FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_technician_breaks" ON technician_breaks;
CREATE POLICY "anon_delete_technician_breaks" ON technician_breaks FOR DELETE
  TO anon, authenticated USING (true);
