# Image storage optimization

All new technician photos are resized in the browser before upload.

- Target size: 55 KB
- Maximum size: 60 KB
- Output: JPEG
- Maximum dimensions: 1280 × 1280
- The same optimized file is used for the gallery thumbnail, avoiding a second Supabase Storage object.
- Compression happens before upload, reducing storage and bandwidth usage.

Existing files already stored in Supabase are not modified automatically.
