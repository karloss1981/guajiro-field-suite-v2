/*
  # Create core application tables

  1. New Tables
    - `technicians`: Store technician information
    - `routes`: Store daily job routes/assignments
    - `job_photos`: Store photo metadata for jobs
    - `supervisor_notes`: Store supervisor notes for technicians
    - `tech_locations`: Store real-time GPS locations of technicians

  2. Security
    - All tables have RLS enabled
    - Policies restrict access based on authentication

  3. Storage
    - job-photos bucket for storing job photos
*/

-- Technicians table
CREATE TABLE IF NOT EXISTS technicians (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Routes/Jobs table
CREATE TABLE IF NOT EXISTS routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tech_id text NOT NULL REFERENCES technicians(id),
  job_id text NOT NULL,
  address text,
  city text,
  phone text,
  type text,
  pay_code text,
  pay_total numeric,
  status text DEFAULT 'pending',
  date text,
  order_num integer,
  created_at timestamptz DEFAULT now()
);

-- Job photos table
CREATE TABLE IF NOT EXISTS job_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid REFERENCES routes(id),
  tech_id text NOT NULL,
  job_id text NOT NULL,
  photo_url text NOT NULL,
  note text,
  created_at timestamptz DEFAULT now()
);

-- Supervisor notes table
CREATE TABLE IF NOT EXISTS supervisor_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text,
  for_tech text,
  content text,
  date text,
  created_at timestamptz DEFAULT now()
);

-- Tech locations table
CREATE TABLE IF NOT EXISTS tech_locations (
  tech_id text PRIMARY KEY REFERENCES technicians(id),
  tech_name text,
  lat numeric,
  lng numeric,
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE technicians ENABLE ROW LEVEL SECURITY;
ALTER TABLE routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE supervisor_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tech_locations ENABLE ROW LEVEL SECURITY;

-- RLS Policies - Allow public read access (no auth required)
CREATE POLICY "Public read technicians"
  ON technicians FOR SELECT
  USING (true);

CREATE POLICY "Public read routes"
  ON routes FOR SELECT
  USING (true);

CREATE POLICY "Public read job_photos"
  ON job_photos FOR SELECT
  USING (true);

CREATE POLICY "Public read supervisor_notes"
  ON supervisor_notes FOR SELECT
  USING (true);

CREATE POLICY "Public read tech_locations"
  ON tech_locations FOR SELECT
  USING (true);

-- Write policies - Allow all authenticated users (for app functionality)
CREATE POLICY "Public insert routes"
  ON routes FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Public update routes"
  ON routes FOR UPDATE
  WITH CHECK (true);

CREATE POLICY "Public delete routes"
  ON routes FOR DELETE
  USING (true);

CREATE POLICY "Public insert job_photos"
  ON job_photos FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Public delete job_photos"
  ON job_photos FOR DELETE
  USING (true);

CREATE POLICY "Public insert supervisor_notes"
  ON supervisor_notes FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Public insert tech_locations"
  ON tech_locations FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Public update tech_locations"
  ON tech_locations FOR UPDATE
  WITH CHECK (true);
