/*
  # Fix completed_jobs RLS — allow anon access

  ## Problem
  The app uses the Supabase anon key throughout (no Supabase Auth / JWT).
  The existing policies on completed_jobs required `authenticated` role,
  so both INSERT (from markDone) and SELECT (from history search) were
  silently blocked — jobs never archived, history always empty.

  ## Changes
  - Drop the two `authenticated`-only policies
  - Add public (anon) policies matching the routes table pattern:
    SELECT, INSERT, UPDATE, DELETE all open to public role
*/

DROP POLICY IF EXISTS "Techs can read their own completed jobs" ON completed_jobs;
DROP POLICY IF EXISTS "Techs can insert their own completed jobs" ON completed_jobs;

CREATE POLICY "Public read completed_jobs"
  ON completed_jobs FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Public insert completed_jobs"
  ON completed_jobs FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Public update completed_jobs"
  ON completed_jobs FOR UPDATE
  TO public
  USING (true);

CREATE POLICY "Public delete completed_jobs"
  ON completed_jobs FOR DELETE
  TO public
  USING (true);
