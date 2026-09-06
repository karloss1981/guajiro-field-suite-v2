# Notifications, weather and photo naming

## Implemented in this build

### Photo storage names
New evidence photos are stored with a filename that links:

- technician number
- job ID
- date
- photo type
- unique timestamp

Example:

`6017_12345678_2026-06-14_before_1718340000000_ab123.jpg`

Storage path:

`<tech>/<date>/<job>/<filename>`

### Job status sounds
- Completed jobs use an ascending positive sound.
- Not-completed jobs use a lower warning sound.
- The supervisor portal also detects status changes during refresh and uses the corresponding sound.

### Live weather
- Current weather is loaded from Open-Meteo using device geolocation, with a regional fallback.
- Active United States severe-weather alerts are loaded from the National Weather Service API.
- The panel refreshes every 10 minutes.
- Severe alerts display a full-screen popup and use an emergency sound.

### Pending closeout reminders
- The technician app monitors pending jobs during the active app session.
- When a technician has entered a job geofence and moves away, a closeout reminder is scheduled for 15 minutes later.
- After 5:00 PM, pending jobs trigger a reminder every 15 minutes.
- The technician can snooze reminders for 15 minutes.
- Reminders stop when the route job status is no longer `pending`.
- In-app popup, sound, vibration and browser/PWA notifications are supported when permission is granted.

## Important production limitation
Browser timers and geolocation may be paused by the operating system when the PWA is fully closed or aggressively suspended. Reliable reminders while the app is closed require server-generated Web Push notifications, normally using:

- saved Web Push subscriptions;
- a Supabase Edge Function;
- a scheduled server job;
- a queue of pending notification events.

The included service worker supports receiving future push events, but a push subscription backend and scheduled Edge Function must be deployed for guaranteed closed-app delivery.

## Validation performed

- `npx tsc --noEmit`
- `npm run build`

Both completed successfully for this build.
