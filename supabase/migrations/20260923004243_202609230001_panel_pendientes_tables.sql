/*
# Panel de Pendientes — tables for supervisor tools tab

1. New Tables
- `panel_notes` — general to-do tasks and per-technician notes created by supervisors.
  - id (uuid, PK)
  - kind (text: 'task' | 'tech_note')
  - tech_id (text, nullable — set for tech_note kind)
  - tech_name (text)
  - title (text)
  - content (text)
  - status (text: 'pending' | 'done', default 'pending')
  - due_date (date, nullable — 'YYYY-MM-DD')
  - region (text, default 'miami')
  - created_by (text, nullable)
  - created_at (timestamptz, default now())
  - updated_at (timestamptz, default now())
  - completed_at (timestamptz, nullable)
- `panel_note_photos` — photos attached to a panel note.
  - id (uuid, PK)
  - note_id (uuid, FK → panel_notes.id ON DELETE CASCADE)
  - photo_url (text)
  - thumb_url (text, nullable)
  - storage_path (text, nullable)
  - created_at (timestamptz, default now())

2. Security
- Enable RLS on both tables.
- The app's frontend uses the anon key (hybrid auth model matching existing
  tables like archived_routes / audit_logs), so policies are scoped to
  `TO anon, authenticated` with `USING (true)` / `WITH CHECK (true)` — the
  data is intentionally shared among supervisors, not per-user isolated.

3. Notes
- `panel_note_photos.storage_path` is used by the frontend to reference the
  uploaded object in the `job-photos` storage bucket (same bucket already
  used for job photos).
*/

CREATE TABLE IF NOT EXISTS panel_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL DEFAULT 'task',
  tech_id text,
  tech_name text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  due_date date,
  region text NOT NULL DEFAULT 'miami',
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS panel_note_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL REFERENCES panel_notes(id) ON DELETE CASCADE,
  photo_url text NOT NULL DEFAULT '',
  thumb_url text,
  storage_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_panel_notes_region ON panel_notes (region);
CREATE INDEX IF NOT EXISTS idx_panel_notes_status ON panel_notes (status);
CREATE INDEX IF NOT EXISTS idx_panel_note_photos_note_id ON panel_note_photos (note_id);

ALTER TABLE panel_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE panel_note_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pn_select_all" ON panel_notes;
CREATE POLICY "pn_select_all" ON panel_notes FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "pn_insert_all" ON panel_notes;
CREATE POLICY "pn_insert_all" ON panel_notes FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "pn_update_all" ON panel_notes;
CREATE POLICY "pn_update_all" ON panel_notes FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "pn_delete_all" ON panel_notes;
CREATE POLICY "pn_delete_all" ON panel_notes FOR DELETE
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "pnp_select_all" ON panel_note_photos;
CREATE POLICY "pnp_select_all" ON panel_note_photos FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "pnp_insert_all" ON panel_note_photos;
CREATE POLICY "pnp_insert_all" ON panel_note_photos FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "pnp_update_all" ON panel_note_photos;
CREATE POLICY "pnp_update_all" ON panel_note_photos FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "pnp_delete_all" ON panel_note_photos;
CREATE POLICY "pnp_delete_all" ON panel_note_photos FOR DELETE
  TO anon, authenticated USING (true);