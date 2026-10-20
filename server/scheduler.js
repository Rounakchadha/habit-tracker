const { db, getConfig } = require('./db');
const { logicalToday, minutesIntoDay, toMinutesIntoDay } = require('./dates');
const { allTasks, logMap, scheduledOn, effectiveTime, compute } = require('./insights');
const { sendAll, sign } = require('./push');

const NAG_AFTER = 15; // minutes before a second, louder nudge for a task still not logged
const WINDOW = 10; // minutes of grace (covers restarts / slow ticks)
const sent = db.prepare('INSERT OR IGNORE INTO reminders_sent(task_id,date) VALUES(?,?)');

function actionUrl(taskId, date, status) {
  return `/api/action?task=${taskId}&date=${date}&status=${status}&sig=${sign(`${taskId}|${date}|${status}`)}`;
}

async function tick() {
  const cfg = getConfig();
  const today = logicalToday(cfg.tz, cfg.dayStart);
  const nowM = minutesIntoDay(cfg.tz, cfg.dayStart);
  if (!db.prepare('SELECT 1 FROM push_subs LIMIT 1').get()) return;

  const logs = logMap(today, today);
  for (const t of allTasks()) {
    if (!t.remind || !scheduledOn(t, today) || logs.has(`${t.id}|${today}`)) continue;
    const diff = nowM - toMinutesIntoDay(effectiveTime(t), cfg.dayStart);
    if (diff >= NAG_AFTER && diff <= NAG_AFTER + WINDOW && sent.run(-(t.id + 10), today).changes) {
      await sendAll({ title: `Still pending: ${t.title}`, body: `${t.journal_icon} ${t.journal_name} · was due ${effectiveTime(t)}`, tag: `task-${t.id}`, url: '/',
        actions: [{ action: 'done', title: '✓ Done' }, { action: 'skip', title: '✕ Skip' }],
        doneUrl: actionUrl(t.id, today, 'done'), skipUrl: actionUrl(t.id, today, 'skipped') });
      continue;
    }
    if (diff < 0 || diff > WINDOW) continue;
    if (sent.run(t.id, today).changes === 0) continue; // already reminded
    await sendAll({
      title: t.journal_kind === 'quit' ? `Stay strong: ${t.title}` : `Time for: ${t.title}`,
      body: `${t.journal_icon} ${t.journal_name} · ${effectiveTime(t)}`,
      tag: `task-${t.id}`, url: '/',
      actions: [{ action: 'done', title: '✓ Done' }, { action: 'skip', title: '✕ Skip' }],
      doneUrl: actionUrl(t.id, today, 'done'), skipUrl: actionUrl(t.id, today, 'skipped'),
    });
  }

  // evening check-in
  const diff = nowM - toMinutesIntoDay(cfg.checkinTime, cfg.dayStart);
  if (diff >= 0 && diff <= WINDOW && sent.run(-1, today).changes) {
    const pending = allTasks().filter(t => scheduledOn(t, today) && !logs.has(`${t.id}|${today}`));
    if (pending.length) {
      const warn = compute(today).coach.find(c => c.level === 'warn');
      await sendAll({
        title: `${pending.length} task${pending.length > 1 ? 's' : ''} left today`,
        body: warn ? warn.text : pending.slice(0, 3).map(t => t.title).join(', '),
        tag: 'checkin', url: '/',
      });
    }
  }
}

function start() {
  setInterval(() => tick().catch(e => console.error('scheduler', e)), 60e3);
  console.log('Reminder scheduler running (every 60s)');
}

module.exports = { start, tick, actionUrl };
