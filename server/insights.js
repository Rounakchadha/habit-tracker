const { db } = require('./db');
const { addDays, dow } = require('./dates');

const SLOT_LABEL = { wake: 'After waking', morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', night: 'Night', bed: 'Before sleep' };
const SLOT_DEFAULT_TIME = { wake: '07:00', morning: '09:00', afternoon: '14:00', evening: '18:30', night: '21:00', bed: '23:00' };

const scheduledOn = (t, date) => date >= t.start_date && t.days.includes(String(dow(date)));
const effectiveTime = t => t.time || SLOT_DEFAULT_TIME[t.slot];

function allTasks() {
  return db.prepare(`SELECT t.*, j.name AS journal_name, j.kind AS journal_kind, j.icon AS journal_icon
                     FROM tasks t JOIN journals j ON j.id=t.journal_id ORDER BY t.position, t.id`).all();
}

function logMap(fromDate, toDate) {
  const m = new Map();
  for (const r of db.prepare('SELECT task_id,date,status FROM logs WHERE date BETWEEN ? AND ?').all(fromDate, toDate)) {
    m.set(`${r.task_id}|${r.date}`, r.status);
  }
  return m;
}

// Per-task stats over the last `window` days ending at `today`.
function taskStats(t, today, logs, window = 60) {
  const from = addDays(today, -(window - 1));
  const first = t.start_date > from ? t.start_date : from;
  const days = [];
  for (let d = first; d <= today; d = addDays(d, 1)) if (scheduledOn(t, d)) days.push(d);

  const st = d => logs.get(`${t.id}|${d}`) || null;
  let best = 0, run = 0;
  for (const d of days) { if (st(d) === 'done') { run++; best = Math.max(best, run); } else if (d !== today || st(d)) run = 0; }

  let streak = 0, missedRun = 0;
  const past = days.filter(d => d !== today).reverse();
  const todaySt = days.includes(today) ? st(today) : null;
  if (todaySt === 'done') streak++;
  for (const d of past) { if (st(d) === 'done') streak++; else break; }
  if (todaySt === 'skipped') missedRun++;
  if (todaySt !== 'done') for (const d of past) { if (st(d) !== 'done') missedRun++; else break; }
  if (todaySt === 'done') missedRun = 0;

  const last30 = days.filter(d => d >= addDays(today, -29) && (d !== today || st(d)));
  const done30 = last30.filter(d => st(d) === 'done').length;
  return { streak, best: Math.max(best, streak), missedRun, rate30: last30.length ? Math.round(100 * done30 / last30.length) : null, sample: last30.length };
}

function dayTotals(tasks, date, logs) {
  let done = 0, total = 0;
  for (const t of tasks) if (scheduledOn(t, date)) { total++; if (logs.get(`${t.id}|${date}`) === 'done') done++; }
  return { date, done, total };
}

function compute(today) {
  const tasks = allTasks();
  const logs = logMap(addDays(today, -80), today);

  const habits = tasks.map(t => ({
    id: t.id, title: t.title, slot: t.slot, journal: t.journal_name, icon: t.journal_icon, kind: t.journal_kind,
    scheduledToday: scheduledOn(t, today), ...taskStats(t, today, logs),
  }));

  const week = Array.from({ length: 7 }, (_, i) => dayTotals(tasks, addDays(today, i - 6), logs));
  const heat = Array.from({ length: 35 }, (_, i) => dayTotals(tasks, addDays(today, i - 34), logs));

  const wk = week.filter(d => d.total);
  const weekRate = wk.length ? Math.round(100 * wk.reduce((a, d) => a + d.done, 0) / wk.reduce((a, d) => a + d.total, 0)) : null;

  // slot strength over last 14 days
  const slots = {};
  for (let i = -13; i <= 0; i++) {
    const d = addDays(today, i);
    for (const t of tasks) if (scheduledOn(t, d) && (d !== today || logs.get(`${t.id}|${d}`))) {
      const s = (slots[t.slot] ||= { done: 0, total: 0 });
      s.total++; if (logs.get(`${t.id}|${d}`) === 'done') s.done++;
    }
  }
  const slotRates = Object.entries(slots).filter(([, v]) => v.total >= 4).map(([k, v]) => ({ slot: k, label: SLOT_LABEL[k], rate: Math.round(100 * v.done / v.total) }));

  const coach = [];
  for (const h of habits.filter(h => h.missedRun >= 2).sort((a, b) => b.missedRun - a.missedRun).slice(0, 4)) {
    coach.push(h.kind === 'quit'
      ? { level: 'warn', text: `You slipped on "${h.title}" ${h.missedRun} days in a row. Reset today — one clean day is the goal.` }
      : { level: 'warn', text: `You've missed "${h.title}" ${h.missedRun} days in a row. Pls focus on this one today.` });
  }
  const hot = habits.filter(h => h.streak >= 3).sort((a, b) => b.streak - a.streak)[0];
  if (hot) coach.push({ level: 'good', text: `"${hot.title}" is on a ${hot.streak}-day streak. Keep it alive.` });
  const weak = slotRates.filter(s => s.rate < 60).sort((a, b) => a.rate - b.rate)[0];
  if (weak) coach.push({ level: 'info', text: `${weak.label} is your weakest part of the day (${weak.rate}% in the last 2 weeks).` });
  if (!coach.length && tasks.length) coach.push({ level: 'info', text: 'Nothing slipping. Keep logging and insights will build up here.' });

  return { habits, week, heat, weekRate, slotRates, coach };
}

module.exports = { compute, scheduledOn, effectiveTime, allTasks, logMap, SLOT_LABEL, SLOT_DEFAULT_TIME };
