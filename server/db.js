const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(dir, { recursive: true });
const db = new Database(path.join(dir, 'habits.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS journals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '📓',
  color TEXT NOT NULL DEFAULT '#16ec06',
  kind TEXT NOT NULL DEFAULT 'build',      -- build | quit
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  journal_id INTEGER NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slot TEXT NOT NULL DEFAULT 'morning',    -- wake|morning|afternoon|evening|night|bed
  time TEXT,                               -- HH:MM or NULL (slot default is used for reminders)
  days TEXT NOT NULL DEFAULT '0123456',    -- weekdays it repeats on, 0=Sun
  remind INTEGER NOT NULL DEFAULT 1,
  start_date TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS logs (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  status TEXT NOT NULL,                    -- done | skipped
  PRIMARY KEY (task_id, date)
);
CREATE INDEX IF NOT EXISTS idx_logs_date ON logs(date);
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reminders_sent (
  task_id INTEGER NOT NULL, date TEXT NOT NULL, PRIMARY KEY (task_id, date)
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

const DEFAULTS = { tz: process.env.TZ_NAME || 'Asia/Kolkata', day_start: '4', checkin_time: '21:30' };

const getSetting = k => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value ?? DEFAULTS[k];
const setSetting = (k, v) => db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));
const getConfig = () => ({ tz: getSetting('tz'), dayStart: +getSetting('day_start'), checkinTime: getSetting('checkin_time') });

// seed starter journals on first run
if (!db.prepare('SELECT 1 FROM journals LIMIT 1').get()) {
  const ins = db.prepare('INSERT INTO journals(name,icon,color,kind,position) VALUES(?,?,?,?,?)');
  [
    ['Daily Routine', '☀️', '#16ec06', 'build'],
    ['Supplements', '💊', '#4cc9f0', 'build'],
    ['Habits to Build', '🌱', '#ffd60a', 'build'],
    ['Habits to Quit', '🚫', '#ff453a', 'quit'],
  ].forEach((j, i) => ins.run(...j, i));
}

module.exports = { db, getSetting, setSetting, getConfig };
