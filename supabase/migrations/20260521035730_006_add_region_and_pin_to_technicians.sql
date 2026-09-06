/*
  # Add region and pin columns to technicians table

  ## Changes
  - Adds `region` column (TEXT) to `technicians`: values 'miami' or 'swfl'
  - Adds `pin` column (TEXT, nullable) — 4-6 digit numeric PIN set by supervisor
  - Adds `active` column (BOOLEAN, default true)
  - Seeds all existing Miami techs with region = 'miami'
  - Updates RLS to allow supervisors (anon key) to update technician pins/region

  ## Notes
  - Existing techs get region 'miami' by default
  - SWFL techs will be added with region 'swfl' when IDs are known
  - pin column replaces the reversed-ID logic — NULL means no PIN assigned yet
*/

-- Add columns if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'technicians' AND column_name = 'region'
  ) THEN
    ALTER TABLE technicians ADD COLUMN region TEXT DEFAULT 'miami';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'technicians' AND column_name = 'pin'
  ) THEN
    ALTER TABLE technicians ADD COLUMN pin TEXT DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'technicians' AND column_name = 'active'
  ) THEN
    ALTER TABLE technicians ADD COLUMN active BOOLEAN DEFAULT true;
  END IF;
END $$;

-- Upsert all Miami techs
INSERT INTO technicians (id, name, region, active)
VALUES
  ('6017','Rayner Hernandez Perez','miami',true),
  ('6053','Jorge Luis Plana','miami',true),
  ('7045','Adalberto Plana','miami',true),
  ('7065','Michael','miami',true),
  ('7102','Yandy Gonzalez','miami',true),
  ('7111','Yandy Gonzalez (Barroso)','miami',true),
  ('7113','Vladimir Pujol','miami',true),
  ('7163','Alberto Amaya','miami',true),
  ('7164','Omar','miami',true),
  ('7191','Wilfredo','miami',true),
  ('7235','Bernal','miami',true),
  ('7260','Anier Borroto Villar','miami',true),
  ('7270','Julito','miami',true),
  ('7272','Renier Alejandro','miami',true),
  ('7419','Juan Guillermo','miami',true),
  ('7570','Maikel Sanchez','miami',true),
  ('8723','Onil','miami',true),
  ('8799','Michel','miami',true),
  ('8804','Yunior Barba','miami',true),
  ('8807','Idan Caballero (Papin)','miami',true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  region = EXCLUDED.region,
  active = EXCLUDED.active;

-- Ensure RLS allows reading and updating technicians
ALTER TABLE technicians ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read technicians (needed for login PIN check)
DROP POLICY IF EXISTS "Anyone can read technicians" ON technicians;
CREATE POLICY "Anyone can read technicians"
  ON technicians FOR SELECT
  TO anon, authenticated
  USING (true);

-- Allow anyone to update pin (supervisor manages pins without auth)
DROP POLICY IF EXISTS "Anyone can update technician pin" ON technicians;
CREATE POLICY "Anyone can update technician pin"
  ON technicians FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- Allow insert for new techs
DROP POLICY IF EXISTS "Anyone can insert technicians" ON technicians;
CREATE POLICY "Anyone can insert technicians"
  ON technicians FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);
