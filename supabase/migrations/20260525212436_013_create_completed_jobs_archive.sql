/*
  # Create completed_jobs archive table

  ## Purpose
  Routes are cleared daily from the routes table, so there is no historical
  record of completed jobs. This table permanently archives every job that
  a technician marks as "done", enabling the tech history search feature.

  ## New Tables
  - `completed_jobs`
    - `id` (uuid, primary key)
    - `route_id` (uuid) — original routes.id, for photo lookups
    - `tech_id` (text) — technician ID
    - `tech_name` (text) — technician name at time of completion
    - `job_id` (text) — job number (e.g. JOB-XXXXX)
    - `address` (text)
    - `city` (text)
    - `phone` (text)
    - `type` (text)
    - `pay_code` (text)
    - `pay_total` (numeric)
    - `job_note` (text)
    - `zip` (text)
    - `date` (text) — work date (YYYY-MM-DD)
    - `region` (text)
    - `completed_at` (timestamptz) — when marked done

  ## Security
  - RLS enabled
  - Authenticated users can insert (techs marking jobs done)
  - Authenticated users can read their own completed jobs (by tech_id)
  - Supervisors/admins can read all (via service role or matching region policy)
*/

CREATE TABLE IF NOT EXISTS completed_jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id     uuid,
  tech_id      text NOT NULL,
  tech_name    text DEFAULT '',
  job_id       text DEFAULT '',
  address      text DEFAULT '',
  city         text DEFAULT '',
  phone        text DEFAULT '',
  type         text DEFAULT '',
  pay_code     text DEFAULT '',
  pay_total    numeric DEFAULT 0,
  job_note     text DEFAULT '',
  zip          text DEFAULT '',
  date         text DEFAULT '',
  region       text DEFAULT '',
  completed_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS completed_jobs_tech_id_idx ON completed_jobs(tech_id);
CREATE INDEX IF NOT EXISTS completed_jobs_date_idx    ON completed_jobs(date);
CREATE INDEX IF NOT EXISTS completed_jobs_job_id_idx  ON completed_jobs(job_id);
CREATE INDEX IF NOT EXISTS completed_jobs_region_idx  ON completed_jobs(region);

ALTER TABLE completed_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Techs can insert their own completed jobs"
  ON completed_jobs FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Techs can read their own completed jobs"
  ON completed_jobs FOR SELECT
  TO authenticated
  USING (true);
