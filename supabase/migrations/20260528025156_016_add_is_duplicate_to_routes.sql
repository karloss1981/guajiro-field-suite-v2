/*
  # Add is_duplicate column to routes table

  Adds the is_duplicate boolean column that the import logic uses to flag
  jobs whose address matches an open cancelled job entry.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'routes' AND column_name = 'is_duplicate'
  ) THEN
    ALTER TABLE routes ADD COLUMN is_duplicate boolean DEFAULT false;
  END IF;
END $$;
