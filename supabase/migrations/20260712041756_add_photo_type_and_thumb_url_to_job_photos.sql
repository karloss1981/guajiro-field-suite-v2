/*
# Add missing columns to job_photos

1. Modified Tables
- `job_photos`: add `photo_type` (text, default 'before') and `thumb_url` (text, nullable)
  These columns are expected by the frontend TechPortal and photo upload queue.
  The app inserts and selects `photo_type` and `thumb_url` but they don't exist in the schema,
  causing "Could not find the 'photo_type' column of 'job_photos' in the schema cache" errors.

2. Security
- No RLS changes. Existing public policies remain unchanged.
*/

ALTER TABLE job_photos
  ADD COLUMN IF NOT EXISTS photo_type text DEFAULT 'before',
  ADD COLUMN IF NOT EXISTS thumb_url text;
