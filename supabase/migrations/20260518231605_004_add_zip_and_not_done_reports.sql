/*
  # Add missing columns and tables

  1. Changes
    - Add `zip` column to `routes` table (used by Excel import)
    - Create `not_done_reports` table (used by tech report form and EOD)

  2. Security
    - Enable RLS on `not_done_reports`
    - Add public read/write policies for app functionality
*/

-- Add zip column to routes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'routes' AND column_name = 'zip'
  ) THEN
    ALTER TABLE routes ADD COLUMN zip text;
  END IF;
END $$;

-- Create not_done_reports table
CREATE TABLE IF NOT EXISTS not_done_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date text,
  tech_id text,
  tech_name text,
  job_id text,
  address text,
  reason text,
  notes text,
  zone text,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE not_done_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read not_done_reports"
  ON not_done_reports FOR SELECT
  USING (true);

CREATE POLICY "Public insert not_done_reports"
  ON not_done_reports FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Public update not_done_reports"
  ON not_done_reports FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Public delete not_done_reports"
  ON not_done_reports FOR DELETE
  USING (true);
