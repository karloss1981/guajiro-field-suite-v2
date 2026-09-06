/*
  # Fix tech_locations RLS policies for upsert

  The app uses upsert with onConflict:'tech_id' which requires
  both INSERT and UPDATE to work. The existing UPDATE policy
  had a WITH CHECK but no USING clause, which blocks the upsert.

  1. Changes
    - Drop existing INSERT and UPDATE policies on tech_locations
    - Recreate with proper USING and WITH CHECK clauses
*/

-- Drop old policies
DROP POLICY IF EXISTS "Public insert tech_locations" ON tech_locations;
DROP POLICY IF EXISTS "Public update tech_locations" ON tech_locations;

-- Recreate with proper clauses for upsert support
CREATE POLICY "Public insert tech_locations"
  ON tech_locations FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Public update tech_locations"
  ON tech_locations FOR UPDATE
  USING (true)
  WITH CHECK (true);
