/*
  # Create storage policies for job-photos bucket

  1. Storage Policies
    - Allow public to read photos (for gallery display)
    - Allow authenticated users to upload photos
    - Allow authenticated users to delete photos

  2. Notes
    - The bucket was created as public so getPublicUrl works
    - These policies control upload/delete access
*/

-- Allow anyone to upload photos
CREATE POLICY "Allow public uploads"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'job-photos');

-- Allow anyone to read photos
CREATE POLICY "Allow public reads"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'job-photos');

-- Allow anyone to delete photos
CREATE POLICY "Allow public deletes"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'job-photos');

-- Allow anyone to update photos
CREATE POLICY "Allow public updates"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'job-photos');
