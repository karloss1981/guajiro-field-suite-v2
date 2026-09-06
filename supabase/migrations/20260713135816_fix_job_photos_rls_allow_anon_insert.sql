-- Recreate job_photos RLS policies to ensure anon can insert
DROP POLICY IF EXISTS "Public insert job_photos" ON job_photos;
DROP POLICY IF EXISTS "Public read job_photos" ON job_photos;
DROP POLICY IF EXISTS "Public delete job_photos" ON job_photos;
DROP POLICY IF EXISTS "Public update job_photos" ON job_photos;

CREATE POLICY "job_photos_read_all" ON job_photos
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "job_photos_insert_all" ON job_photos
  FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "job_photos_update_all" ON job_photos
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "job_photos_delete_all" ON job_photos
  FOR DELETE TO anon, authenticated USING (true);