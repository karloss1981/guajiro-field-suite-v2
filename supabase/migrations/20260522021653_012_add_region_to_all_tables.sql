/*
  # Add region column to routes, not_done_reports, supervisor_notes, tech_notes

  Each record now belongs to a region ('miami' or 'swfl') so that supervisor
  portals are fully isolated from each other.

  1. Changes
    - `routes`: add `region text DEFAULT 'miami'`
    - `not_done_reports`: add `region text DEFAULT 'miami'`
    - `supervisor_notes`: add `region text DEFAULT 'miami'`
    - `tech_notes`: add `region text DEFAULT 'miami'`

  2. Back-fill existing rows
    - Routes: join via technicians to inherit region
    - Other tables: join via tech_id → technicians or default 'miami'
*/

-- routes
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='routes' AND column_name='region') THEN
    ALTER TABLE routes ADD COLUMN region text DEFAULT 'miami';
  END IF;
END $$;

-- back-fill routes from technicians.region
UPDATE routes r
SET region = COALESCE((SELECT t.region FROM technicians t WHERE t.id = r.tech_id), 'miami')
WHERE region IS NULL OR region = 'miami';

-- not_done_reports
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='not_done_reports' AND column_name='region') THEN
    ALTER TABLE not_done_reports ADD COLUMN region text DEFAULT 'miami';
  END IF;
END $$;

UPDATE not_done_reports r
SET region = COALESCE((SELECT t.region FROM technicians t WHERE t.id = r.tech_id), 'miami')
WHERE region IS NULL OR region = 'miami';

-- supervisor_notes
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='supervisor_notes' AND column_name='region') THEN
    ALTER TABLE supervisor_notes ADD COLUMN region text DEFAULT 'miami';
  END IF;
END $$;

-- tech_notes
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tech_notes' AND column_name='region') THEN
    ALTER TABLE tech_notes ADD COLUMN region text DEFAULT 'miami';
  END IF;
END $$;

UPDATE tech_notes n
SET region = COALESCE((SELECT t.region FROM technicians t WHERE t.id = n.tech_id), 'miami')
WHERE region IS NULL OR region = 'miami';
