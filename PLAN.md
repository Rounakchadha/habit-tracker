# Habit Tracker — Plan & Architecture

A WHOOP-style habit coach without the wearable. Open it from a phone home-screen bookmark (PWA), tick/cross tasks by time of day, see a daily "recovery ring", get called out on slipping habits, and get push reminders.

## Core features (what you asked for)
- **Six day slots:** After waking · Morning · Afternoon · Evening · Night · Before sleep
- **Add / delete / edit tasks**, each with optional time, repeat days, reminder toggle
- **Tick ✓ or cross ✕** (tap again to clear)
- **Top tracker:** ring + Done / Not done / Pending for the day
- **Auto date:** knows today's date/time in your timezone; a "day" rolls over at 4 AM (so a 1 AM night task still belongs to yesterday). Swipe/arrow to move between days.
- **Coach:** "You've missed *Creatine* 4 days in a row — focus on it", streak praise, weakest slot
- **Multiple journals:** Daily Routine, Supplements, Habits to Build, Habits to Quit (+ create your own)
- **Reminders:** Web Push to your phone at each task's time

## Extra things worth adding (included unless noted)
| Idea | Status |
|---|---|
| Habits-to-**quit** journals (tick = "stayed clean") | included |
| 7-day bar chart + 5-week heatmap + 30-day rate | included |
| Per-habit streak & best streak | included |
| Evening check-in nudge ("3 tasks left") | included |
| Calendar feed (.ics) so iOS/Android Calendar alarms ring even without push | included |
| Weekday-only / custom repeat days | included |
| Notes per day, mood/energy check-in, weekly review email, widgets, multi-user | later |

## Architecture
```
 Phone (PWA: bookmark / Add to Home Screen)
   │  HTTPS  REST JSON        ▲ Web Push (VAPID)
   ▼                          │
 Node + Express  ── scheduler (every minute) ── web-push
   │
 SQLite (single file, data/habits.db)
```
- **Frontend:** vanilla JS single-page app, no build step. Service worker for offline shell + push + notification actions (Done / Skip right from the notification).
- **Backend:** Express REST API, `better-sqlite3`, a minute-ticker that finds due tasks and pushes.
- **Auth:** single-user PIN (`APP_PIN` env). Sent as a header; calendar feed uses a derived token.
- **"Missed" logic:** a scheduled task on a past day with no tick = missed. Today's un-ticked tasks are *pending*, not missed.
- **Why not Supabase/Postgres?** One user, one file DB, zero setup. Swappable later since all SQL is in `server/db.js`.

## Data model
```
journals(id, name, icon, color, kind[build|quit], position)
tasks(id, journal_id, title, slot, time, days, remind, start_date, position)
logs(task_id, date, status[done|skipped], PRIMARY KEY(task_id,date))
push_subs(endpoint, p256dh, auth)
reminders_sent(task_id, date)          -- de-dupe
settings(key, value)                   -- tz, day_start, checkin_time, vapid keys
```

## File structure
```
habit tracker/
├─ package.json
├─ README.md            deploy + reminders setup
├─ PLAN.md
├─ server/
│  ├─ index.js          express app + routes
│  ├─ db.js             schema + queries
│  ├─ dates.js          timezone / day-rollover helpers
│  ├─ insights.js       ring stats, streaks, coach messages
│  ├─ push.js           VAPID + send
│  ├─ scheduler.js      minute ticker
│  └─ ics.js            calendar feed
├─ public/
│  ├─ index.html  app.js  styles.css
│  ├─ sw.js  manifest.webmanifest
│  └─ icons/
├─ scripts/gen-icons.js
└─ data/                SQLite lives here (git-ignored, mount a volume in prod)
```

## Deploy
Needs a host with **HTTPS** and a **persistent disk** (SQLite file): Railway, Render (disk), Fly.io (volume) — ~₹0–500/mo. Details in README.

## Reminders reality check
- **Android Chrome:** push works after "Install app".
- **iPhone:** push works only when added to Home Screen (iOS 16.4+), then allow notifications.
- A website can't create alarms in the Clock app. Closest: push notifications + the `.ics` calendar feed (Calendar alerts).
