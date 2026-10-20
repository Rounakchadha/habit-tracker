const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { db, getConfig, setSetting } = require('./db');
const { logicalToday, isDate } = require('./dates');
const { compute, scheduledOn, allTasks, logMap, SLOT_LABEL, SLOT_DEFAULT_TIME } = require('./insights');
const push = require('./push');
const scheduler = require('./scheduler');
const ics = require('./ics');

const PIN = process.env.APP_PIN || '';
const icsToken = push.sign('ics');
const SLOTS = Object.keys(SLOT_LABEL);

const app = express();
app.use(express.json());

const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// ---- public routes (signed links) ----
app.get('/api/action', (req, res) => {
  const { task, date, status, sig } = req.query;
  if (!push.verify(`${task}|${date}|${status}`, sig) || !isDate(date) || !['done', 'skipped'].includes(status)) return res.status(403).send('bad link');
  db.prepare('INSERT INTO logs(task_id,date,status) VALUES(?,?,?) ON CONFLICT(task_id,date) DO UPDATE SET status=excluded.status').run(+task, date, status);
  res.send('ok');
});
app.post('/api/login', (req, res) => {
  if (!PIN || same(String(req.body.pin || ''), PIN)) return res.json({ ok: true, needsPin: !!PIN });
  res.status(401).json({ error: 'wrong pin' });
});
app.get('/api/needs-pin', (_, res) => res.json({ needsPin: !!PIN }));

// ---- auth for everything else under /api ----
app.use('/api', (req, res, next) => {
  if (!PIN || same(String(req.get('x-pin') || ''), PIN)) return next();
  res.status(401).json({ error: 'unauthorized' });
});

const clean = {
  slot: s => (SLOTS.includes(s) ? s : 'morning'),
  time: t => (/^\d{2}:\d{2}$/.test(t || '') ? t : null),
  days: d => { const s = [...new Set(String(d ?? '0123456').replace(/[^0-6]/g, ''))].sort().join(''); return s || '0123456'; },
};

app.get('/api/config', (_, res) => {
  const cfg = getConfig();
  res.json({ ...cfg, today: logicalToday(cfg.tz, cfg.dayStart), vapidPublicKey: push.publicKey, slots: SLOTS.map(k => ({ key: k, label: SLOT_LABEL[k], defaultTime: SLOT_DEFAULT_TIME[k] })), icsPath: `/api/calendar.ics?key=${icsToken}`, subscribed: !!db.prepare('SELECT 1 FROM push_subs LIMIT 1').get() });
});
app.put('/api/config', (req, res) => {
  const { tz, dayStart, checkinTime } = req.body;
  if (tz) { try { new Intl.DateTimeFormat('en', { timeZone: tz }); setSetting('tz', tz); } catch { return res.status(400).json({ error: 'bad timezone' }); } }
  if (Number.isInteger(dayStart) && dayStart >= 0 && dayStart <= 8) setSetting('day_start', dayStart);
  if (/^\d{2}:\d{2}$/.test(checkinTime || '')) setSetting('checkin_time', checkinTime);
  res.json(getConfig());
});

// journals
app.get('/api/journals', (_, res) => res.json(db.prepare('SELECT * FROM journals ORDER BY position,id').all()));
app.post('/api/journals', (req, res) => {
  const { name, icon = '📓', color = '#16ec06', kind = 'build' } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const pos = db.prepare('SELECT COALESCE(MAX(position),0)+1 p FROM journals').get().p;
  const r = db.prepare('INSERT INTO journals(name,icon,color,kind,position) VALUES(?,?,?,?,?)').run(name.trim(), icon, color, kind === 'quit' ? 'quit' : 'build', pos);
  res.json(db.prepare('SELECT * FROM journals WHERE id=?').get(r.lastInsertRowid));
});
app.put('/api/journals/:id', (req, res) => {
  const { name, icon, color, kind } = req.body;
  db.prepare('UPDATE journals SET name=COALESCE(?,name), icon=COALESCE(?,icon), color=COALESCE(?,color), kind=COALESCE(?,kind) WHERE id=?')
    .run(name?.trim() || null, icon ?? null, color ?? null, kind === 'quit' || kind === 'build' ? kind : null, req.params.id);
  res.json(db.prepare('SELECT * FROM journals WHERE id=?').get(req.params.id));
});
app.delete('/api/journals/:id', (req, res) => { db.prepare('DELETE FROM journals WHERE id=?').run(req.params.id); res.json({ ok: true }); });

// tasks
app.get('/api/tasks', (_, res) => res.json(db.prepare('SELECT * FROM tasks ORDER BY position,id').all()));
app.post('/api/tasks', (req, res) => {
  const b = req.body;
  if (!b.title?.trim() || !db.prepare('SELECT 1 FROM journals WHERE id=?').get(b.journal_id)) return res.status(400).json({ error: 'title and valid journal required' });
  const cfg = getConfig();
  const start = isDate(b.start_date) ? b.start_date : logicalToday(cfg.tz, cfg.dayStart);
  const pos = db.prepare('SELECT COALESCE(MAX(position),0)+1 p FROM tasks').get().p;
  const r = db.prepare('INSERT INTO tasks(journal_id,title,slot,time,days,remind,start_date,position) VALUES(?,?,?,?,?,?,?,?)')
    .run(b.journal_id, b.title.trim(), clean.slot(b.slot), clean.time(b.time), clean.days(b.days), b.remind === false ? 0 : 1, start, pos);
  res.json(db.prepare('SELECT * FROM tasks WHERE id=?').get(r.lastInsertRowid));
});
app.put('/api/tasks/:id', (req, res) => {
  const b = req.body, cur = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'not found' });
  db.prepare('UPDATE tasks SET journal_id=?, title=?, slot=?, time=?, days=?, remind=? WHERE id=?').run(
    db.prepare('SELECT 1 FROM journals WHERE id=?').get(b.journal_id) ? b.journal_id : cur.journal_id,
    b.title?.trim() || cur.title, clean.slot(b.slot ?? cur.slot), 'time' in b ? clean.time(b.time) : cur.time,
    clean.days(b.days ?? cur.days), 'remind' in b ? (b.remind ? 1 : 0) : cur.remind, cur.id);
  res.json(db.prepare('SELECT * FROM tasks WHERE id=?').get(cur.id));
});
app.delete('/api/tasks/:id', (req, res) => { db.prepare('DELETE FROM tasks WHERE id=?').run(req.params.id); res.json({ ok: true }); });

// a day's tasks with status
app.get('/api/day', (req, res) => {
  const cfg = getConfig();
  const today = logicalToday(cfg.tz, cfg.dayStart);
  const date = isDate(req.query.date) ? req.query.date : today;
  const logs = logMap(date, date);
  const tasks = allTasks().filter(t => scheduledOn(t, date)).map(t => ({
    id: t.id, title: t.title, slot: t.slot, time: t.time, days: t.days, remind: !!t.remind, journal_id: t.journal_id, status: logs.get(`${t.id}|${date}`) || null,
  }));
  res.json({ date, today, tasks });
});
app.put('/api/log', (req, res) => {
  const { task_id, date, status } = req.body;
  if (!isDate(date) || !db.prepare('SELECT 1 FROM tasks WHERE id=?').get(task_id)) return res.status(400).json({ error: 'bad request' });
  if (status === 'done' || status === 'skipped') db.prepare('INSERT INTO logs(task_id,date,status) VALUES(?,?,?) ON CONFLICT(task_id,date) DO UPDATE SET status=excluded.status').run(task_id, date, status);
  else db.prepare('DELETE FROM logs WHERE task_id=? AND date=?').run(task_id, date);
  res.json({ ok: true });
});

app.get('/api/insights', (req, res) => {
  const cfg = getConfig();
  res.json(compute(isDate(req.query.date) ? req.query.date : logicalToday(cfg.tz, cfg.dayStart)));
});

// push
app.post('/api/push/subscribe', (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) return res.status(400).json({ error: 'bad subscription' });
  db.prepare('INSERT OR REPLACE INTO push_subs(endpoint,p256dh,auth) VALUES(?,?,?)').run(endpoint, keys.p256dh, keys.auth);
  res.json({ ok: true });
});
app.post('/api/push/unsubscribe', (req, res) => { db.prepare('DELETE FROM push_subs WHERE endpoint=?').run(req.body?.endpoint || ''); res.json({ ok: true }); });
app.post('/api/push/test', async (_, res) => {
  // sample reminder built from a real pending task, with working ✓ / ✕ buttons
  const cfg = getConfig(), today = logicalToday(cfg.tz, cfg.dayStart), logs = logMap(today, today);
  const t = allTasks().find(t => scheduledOn(t, today) && !logs.has(`${t.id}|${today}`));
  const payload = t ? {
    title: `Time for: ${t.title}`, body: `${t.journal_icon} ${t.journal_name} · ${t.time || SLOT_DEFAULT_TIME[t.slot]}`, tag: 'test', url: '/',
    actions: [{ action: 'done', title: '✓ Done' }, { action: 'skip', title: '✕ Skip' }],
    doneUrl: scheduler.actionUrl(t.id, today, 'done'), skipUrl: scheduler.actionUrl(t.id, today, 'skipped'),
  } : { title: 'Habit Tracker', body: 'Reminders are working 🎉', tag: 'test', url: '/' };
  res.json({ sent: await push.sendAll(payload) });
});
app.get('/api/calendar.ics', (req, res) => {
  if (req.query.key !== icsToken) return res.status(403).send('bad key');
  if (req.query.download) res.set('Content-Disposition', 'attachment; filename="habit-tracker.ics"');
  res.type('text/calendar').send(ics.build());
});

app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Habit tracker on http://localhost:${port}${PIN ? '  (PIN protected)' : '  (no PIN set — set APP_PIN before deploying!)'}`);
  scheduler.start();
});
