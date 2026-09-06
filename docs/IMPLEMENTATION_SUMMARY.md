# Guajiro Field Suite PWA v2 - Implementation Summary

This package applies the first complete PWA foundation while preserving the current app behavior.

## Applied changes

- Preserved original production app as `src/LegacyApp.tsx`.
- Replaced `src/App.tsx` with a clean shell that wraps the legacy app.
- Added PWA manifest and service worker.
- Added install prompt button.
- Added offline banner.
- Added IndexedDB-based offline stores and sync queue.
- Added auto-sync service that retries queued Supabase writes when connection returns.
- Added audit service and Supabase migration for `roles`, `user_roles`, and `audit_logs`.
- Added role types, role service, and reusable `RoleGuard`.
- Added professional photo optimizer with WebP conversion and watermark metadata.
- Added modular folder structure under `features`, `shared`, `offline`, `pwa`, and `routes`.

## Why LegacyApp remains

The original `App.tsx` is very large. Rewriting it all at once would risk breaking the current operational app. This version keeps the app working while adding the infrastructure required for the next extraction phases.

## Next extraction targets

1. Auth/Login screen
2. Supervisor portal
3. Technician portal
4. Dashboard
5. Photos
6. Reports

## Test commands

```bash
npm install
npm run build
npm run dev
```

## Supabase migration

Run the SQL file:

`supabase/migrations/202606070001_pwa_roles_audit.sql`
