/*
  # Add tech_notes table

  Allows technicians to send notes/messages to the supervisor during the day.

  1. New Tables
    - `tech_notes`
      - `id` (uuid, primary key)
      - `tech_id` (text) — technician ID
      - `tech_name` (text) — technician name for display
      - `content` (text) — the note message
      - `date` (text) — YYYY-MM-DD local date
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS
    - Authenticated users can insert their own notes
    - Authenticated users can read all notes for the day (supervisor view)
*/

CREATE TABLE IF NOT EXISTS tech_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tech_id text NOT NULL,
  tech_name text NOT NULL DEFAULT '',
  content text NOT NULL,
  date text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE tech_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can insert tech notes"
  ON tech_notes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can read tech notes"
  ON tech_notes FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);
