/*
  # Add job open/close timestamps to routes

  1. Changes
    - `opened_at` (timestamptz): set when tech presses "Abrir Trabajo"
    - `closed_at` (timestamptz): set when tech presses "Cerrar Trabajo" after billing

  These two fields enforce the workflow:
    pending → opened (tech arrives) → done/notdone (billing) → closed (tech confirms close)
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'routes' AND column_name = 'opened_at'
  ) THEN
    ALTER TABLE routes ADD COLUMN opened_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'routes' AND column_name = 'closed_at'
  ) THEN
    ALTER TABLE routes ADD COLUMN closed_at timestamptz;
  END IF;
END $$;
