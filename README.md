# Habit Tracker

Phone-first habit tracker (PWA). See [PLAN.md](PLAN.md) for architecture.

## Run locally
```bash
npm install
APP_PIN=1234 npm start        # http://localhost:3000
```
Env vars: `APP_PIN` (required in production), `PORT`, `DATA_DIR` (where `habits.db` lives), `TZ_NAME` (default Asia/Kolkata), `VAPID_SUBJECT` (e.g. `mailto:you@example.com`).

## Deploy (needs HTTPS + a persistent disk)
**Railway** (easiest): push this folder to GitHub → New Project → Deploy from repo → add a **Volume** mounted at `/data` →
set variables `APP_PIN=<your pin>`, `DATA_DIR=/data`, `VAPID_SUBJECT=mailto:you@example.com` → Generate Domain.
**Render:** Web Service (Node), add a Disk at `/data`, same env vars. **Fly.io:** `fly launch`, `fly volumes create data`, mount at `/data`.
Run a single instance only (the scheduler lives in the server process). VAPID keys are generated on first run and stored in the DB, so keep the volume.

## Put it on your phone
- **iPhone:** open the URL in Safari → Share → **Add to Home Screen** → open it from the home screen.
- **Android:** Chrome → ⋮ → **Install app**.

## Reminders
1. Open the app from the home screen → Settings → **Enable on this device** → Allow.
2. **Send test notification** to verify. (iPhone needs iOS 16.4+ and the home-screen install.)
3. Each task with "Remind me" fires at its time (or the slot default: waking 7:00, morning 9:00, afternoon 14:00, evening 18:30, night 21:00, bed 23:00). Notifications have ✓ Done / ✕ Skip buttons.
4. Optional: Settings → **Subscribe in Calendar** gives native Calendar alarms as a backup.

## Notes
- A website can't set alarms in the Clock app; push + calendar feed is the closest.
- Back up by copying `habits.db` from the volume.
