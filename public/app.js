// ---------- helpers ----------
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }, del: k => { try { localStorage.removeItem(k); } catch {} } };
const DAYN = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const SLOT_HOURS = { wake: [4, 8], morning: [8, 12], afternoon: [12, 17], evening: [17, 20], night: [20, 23], bed: [23, 28] };
const pad = n => String(n).padStart(2, '0');

const S = { tab: 'today', cfg: null, journals: [], date: null, day: null, insights: null, filter: 'all', allTasks: [] };

async function api(path, opts = {}) {
  const r = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'content-type': 'application/json', 'x-pin': store.get('pin') || '' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (r.status === 401) { showLogin(); throw new Error('auth'); }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
}

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2400); }

// date math (strings YYYY-MM-DD)
const parseD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fmtD = dt => `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
const addDays = (s, n) => { const d = parseD(s); d.setUTCDate(d.getUTCDate() + n); return fmtD(d); };
const dowOf = s => parseD(s).getUTCDay();
const nice = s => parseD(s).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });
const t12 = t => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`; };

function tzParts(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: S.cfg.tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, h: +p.hour % 24, m: +p.minute };
}
const logicalToday = () => tzParts(new Date(Date.now() - S.cfg.dayStart * 3600e3)).date;
function currentSlot() {
  const { h } = tzParts(); const hh = h < S.cfg.dayStart ? h + 24 : h;
  return Object.keys(SLOT_HOURS).find(k => hh >= SLOT_HOURS[k][0] && hh < SLOT_HOURS[k][1]) || 'bed';
}

// short alert beeps when a reminder arrives while the app is open
function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.35, 0.7].forEach(t => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.3, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.3); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.3); });
  } catch {}
}

// ---------- boot ----------
async function boot() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('message', e => { if (e.data === 'chime') chime(); else load(); });
  }
  const { needsPin } = await fetch('/api/needs-pin').then(r => r.json());
  if (needsPin && !store.get('pin')) return showLogin();
  if (!needsPin) store.del('pin');
  try { await init(); } catch (e) { if (e.message !== 'auth') $('#view').innerHTML = `<div class="card">Can't reach server. ${esc(e.message)}</div>`; }
}

async function init() {
  S.cfg = await api('/config');
  S.date = S.cfg.today;
  await load();
  setInterval(tickClock, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { tickClock(); load(); } });
}

// auto roll over to the new day without a reload
async function tickClock() {
  const t = logicalToday();
  if (t !== S.cfg.today) {
    const wasOnToday = S.date === S.cfg.today;
    S.cfg.today = t;
    if (wasOnToday) S.date = t;
    await load();
  } else if (S.tab === 'today') render();
}

function showLogin() {
  $('#tabs').style.display = 'none';
  $('#view').innerHTML = `<div class="login"><h2>Habit Tracker</h2><p class="mute">Enter your PIN</p>
    <input id="pin" type="password" inputmode="numeric" autocomplete="off" style="text-align:center;font-size:22px;max-width:220px">
    <div><button class="today-pill" id="showpin" style="margin-top:10px">👁 Show PIN</button></div>
    <button class="btn" id="go" style="max-width:220px;margin:14px auto">Unlock</button><p class="small" id="err" style="color:var(--red)"></p></div>`;
  const go = async () => {
    const pin = $('#pin').value.trim();
    try {
      const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin }) });
      if (r.status === 401) { $('#err').textContent = 'Wrong PIN'; return; }
      if (!r.ok) { $('#err').textContent = 'Server error ' + r.status; return; }
    } catch (e) { $('#err').textContent = "Can't reach server"; return; }
    store.set('pin', pin); $('#tabs').style.display = ''; init();
  };
  $('#go').onclick = go; $('#pin').onkeydown = e => e.key === 'Enter' && go();
  $('#showpin').onclick = () => { const i = $('#pin'); i.type = i.type === 'password' ? 'text' : 'password'; $('#showpin').textContent = i.type === 'password' ? '👁 Show PIN' : '🙈 Hide PIN'; };
  $('#pin').focus();
}

async function load() {
  const [day, journals, insights, tasks] = await Promise.all([
    api('/day?date=' + S.date), api('/journals'), api('/insights?date=' + S.cfg.today), api('/tasks'),
  ]);
  Object.assign(S, { day, journals, insights, allTasks: tasks });
  S.cfg.today = day.today;
  render();
}

document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => {
  S.tab = b.dataset.tab;
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
  render(); scrollTo(0, 0);
});

function render() {
  if (!S.day) return;
  ({ today: renderToday, journals: renderJournals, insights: renderInsights, settings: renderSettings })[S.tab]();
}

// ---------- TODAY ----------
const ringColor = p => (p >= 67 ? 'var(--green)' : p >= 34 ? 'var(--yellow)' : 'var(--red)');
function ring(pct, label) {
  const R = 56, C = 2 * Math.PI * R;
  return `<div class="ring"><svg width="132" height="132" viewBox="0 0 132 132"><circle cx="66" cy="66" r="${R}" stroke="#25262c" stroke-width="11" fill="none"/>
    <circle cx="66" cy="66" r="${R}" stroke="${ringColor(pct)}" stroke-width="11" fill="none" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct / 100)}" style="transition:stroke-dashoffset .5s"/></svg>
    <div class="c"><div class="pct" style="color:${ringColor(pct)}">${pct}%</div><div class="lbl">${label}</div></div></div>`;
}

function renderToday() {
  const { date, tasks } = S.day, today = S.cfg.today;
  const isToday = date === today, isPast = date < today;
  const list = tasks.filter(t => S.filter === 'all' || t.journal_id === +S.filter);
  const done = list.filter(t => t.status === 'done').length;
  const crossed = list.filter(t => t.status === 'skipped').length;
  const pending = list.length - done - crossed;
  const notDone = crossed + (isPast ? pending : 0);
  const pct = list.length ? Math.round(100 * done / list.length) : 0;
  const hab = Object.fromEntries(S.insights.habits.map(h => [h.id, h]));
  const jmap = Object.fromEntries(S.journals.map(j => [j.id, j]));
  const now = tzParts();
  const rel = isToday ? 'Today' : date === addDays(today, -1) ? 'Yesterday' : date === addDays(today, 1) ? 'Tomorrow' : isPast ? 'Past' : 'Upcoming';

  let html = `<div class="top"><button class="nav" data-d="-1">‹</button>
    <div class="sp" style="text-align:center"><h1>${isToday ? `${t12(`${pad(now.h)}:${pad(now.m)}`)}` : rel}</h1><h2>${nice(date)}</h2></div>
    <button class="nav" data-d="1">›</button></div>
    <div style="text-align:center;margin-top:6px">${isToday ? '<span class="today-pill live">● LIVE · auto-updates</span>' : `<button class="today-pill" id="gotoday">↩ Back to today</button>`}</div>
    <div class="card ringcard">${ring(pct, 'COMPLETE')}<div class="stats">
      <div class="stat"><b style="color:var(--green)">${done}</b><span>Done</span></div>
      <div class="stat"><b style="color:var(--red)">${notDone}</b><span>${isPast ? 'Missed' : 'Crossed'}</span></div>
      <div class="stat"><b>${isPast ? 0 : pending}</b><span>Pending</span></div></div></div>`;

  if (isToday) for (const c of S.insights.coach.slice(0, 2)) html += `<div class="coach ${c.level}">${esc(c.text)}</div>`;

  html += `<div class="chips"><button class="chip ${S.filter === 'all' ? 'on' : ''}" data-f="all">All</button>${S.journals.map(j => `<button class="chip ${S.filter == j.id ? 'on' : ''}" data-f="${j.id}">${esc(j.icon)} ${esc(j.name)}</button>`).join('')}</div>`;

  const cur = isToday ? currentSlot() : null;
  for (const sl of S.cfg.slots) {
    const items = list.filter(t => t.slot === sl.key).sort((a, b) => (a.time || sl.defaultTime).localeCompare(b.time || sl.defaultTime));
    html += `<section class="slot"><div class="slot-h"><span class="name">${sl.label}</span>${cur === sl.key ? '<span class="now">NOW</span>' : ''}
      <span class="mute small sp">${items.length ? `${items.filter(t => t.status === 'done').length}/${items.length}` : ''}</span>
      <button class="add" data-add="${sl.key}" aria-label="Add task to ${sl.label}">+</button></div>`;
    html += items.length ? items.map(t => {
      const h = hab[t.id] || {}, j = jmap[t.journal_id] || {};
      const tags = [`<span class="tag">${esc(j.icon)} ${esc(j.name)}</span>`];
      if (t.time) tags.push(`<span class="tag">⏰ ${t12(t.time)}</span>`);
      if (h.missedRun >= 2) tags.push(`<span class="tag bad">missed ${h.missedRun}d in a row</span>`);
      else if (h.streak >= 2) tags.push(`<span class="tag hot">🔥 ${h.streak}d</span>`);
      const quit = j.kind === 'quit';
      return `<div class="task ${t.status || ''}"><button class="t" data-edit="${t.id}"><div class="title">${esc(t.title)}</div><div class="meta">${tags.join('')}</div></button>
        <button class="act x ${t.status === 'skipped' ? 'on' : ''}" data-log="${t.id}" data-s="skipped" aria-label="${quit ? 'Slipped' : 'Skip'}">✕</button>
        <button class="act ok ${t.status === 'done' ? 'on' : ''}" data-log="${t.id}" data-s="done" aria-label="Done">✓</button></div>`;
    }).join('') : `<div class="empty">Nothing here · tap + to add</div>`;
    html += `</section>`;
  }
  $('#view').innerHTML = html;

  const v = $('#view');
  v.querySelectorAll('[data-d]').forEach(b => b.onclick = () => go(addDays(S.date, +b.dataset.d)));
  if ($('#gotoday')) $('#gotoday').onclick = () => go(today);
  v.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { S.filter = b.dataset.f; renderToday(); });
  v.querySelectorAll('[data-add]').forEach(b => b.onclick = () => taskSheet({ slot: b.dataset.add }));
  v.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => taskSheet(S.allTasks.find(t => t.id === +b.dataset.edit)));
  v.querySelectorAll('[data-log]').forEach(b => b.onclick = () => setLog(+b.dataset.log, b.dataset.s));

  // swipe between days
  let x0 = null;
  v.ontouchstart = e => (x0 = e.touches[0].clientX);
  v.ontouchend = e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 90) go(addDays(S.date, dx < 0 ? 1 : -1)); };
}

async function go(date) { S.date = date; S.day = await api('/day?date=' + date); render(); }

async function setLog(id, status) {
  const t = S.day.tasks.find(x => x.id === id);
  const next = t.status === status ? null : status;
  t.status = next; renderToday();
  try {
    await api('/log', { method: 'PUT', body: { task_id: id, date: S.date, status: next } });
    S.insights = await api('/insights?date=' + S.cfg.today); renderToday();
  } catch { toast('Could not save'); load(); }
}

// ---------- sheets ----------
function openSheet(html) { const s = $('#sheet'); s.innerHTML = `<div class="sheet">${html}</div>`; s.hidden = false; s.onclick = e => e.target === s && closeSheet(); }
function closeSheet() { $('#sheet').hidden = true; $('#sheet').innerHTML = ''; }

function taskSheet(t) {
  const editing = !!t.id;
  const m = { journal_id: t.journal_id || (S.filter !== 'all' ? +S.filter : S.journals[0]?.id), slot: t.slot || 'morning', days: t.days || '0123456', remind: t.remind ?? true, time: t.time || '' };
  if (!S.journals.length) { toast('Create a journal first'); return; }
  const paint = () => {
    $('.sheet').innerHTML = `<h2>${editing ? 'Edit task' : 'New task'}</h2>
    <label>Task</label><input id="f-title" placeholder="e.g. Take Vitamin D" value="${esc(t.title || '')}" maxlength="120">
    <label>Journal</label><div class="seg" id="f-j">${S.journals.map(j => `<button data-v="${j.id}" class="${j.id === m.journal_id ? 'on' : ''}">${esc(j.icon)} ${esc(j.name)}</button>`).join('')}</div>
    <label>When</label><div class="seg" id="f-s">${S.cfg.slots.map(s => `<button data-v="${s.key}" class="${s.key === m.slot ? 'on' : ''}">${s.label}</button>`).join('')}</div>
    <label>Exact time (optional)</label><input id="f-time" type="time" value="${m.time}">
    <label>Repeat on</label><div class="seg days" id="f-d">${DAYN.map((d, i) => `<button data-v="${i}" class="${m.days.includes(i) ? 'on' : ''}">${d}</button>`).join('')}</div>
    <div class="switch" style="margin-top:12px"><span>Remind me</span><input type="checkbox" id="f-r" ${m.remind ? 'checked' : ''} style="width:24px;height:24px"></div>
    <button class="btn" id="f-save">${editing ? 'Save' : 'Add task'}</button>
    ${editing ? '<button class="btn danger" id="f-del">Delete task</button>' : ''}<button class="btn ghost" id="f-x">Cancel</button>`;
    const sh = $('.sheet');
    sh.querySelectorAll('#f-j button').forEach(b => b.onclick = () => { keep(); m.journal_id = +b.dataset.v; paint(); });
    sh.querySelectorAll('#f-s button').forEach(b => b.onclick = () => { keep(); m.slot = b.dataset.v; paint(); });
    sh.querySelectorAll('#f-d button').forEach(b => b.onclick = () => { keep(); const v = b.dataset.v; m.days = m.days.includes(v) ? m.days.replace(v, '') : [...m.days, v].sort().join(''); paint(); });
    $('#f-x').onclick = closeSheet;
    $('#f-save').onclick = async () => {
      keep();
      if (!m.title.trim()) return toast('Give the task a name');
      if (!m.days) return toast('Pick at least one day');
      const body = { title: m.title, journal_id: m.journal_id, slot: m.slot, time: m.time || null, days: m.days, remind: m.remind };
      if (!editing) body.start_date = S.date;
      await api(editing ? '/tasks/' + t.id : '/tasks', { method: editing ? 'PUT' : 'POST', body });
      closeSheet(); await load(); toast(editing ? 'Saved' : 'Task added');
    };
    if (editing) $('#f-del').onclick = async () => {
      if (!confirm('Delete this task and its history?')) return;
      await api('/tasks/' + t.id, { method: 'DELETE' }); closeSheet(); await load(); toast('Deleted');
    };
  };
  const keep = () => { m.title = $('#f-title').value; m.time = $('#f-time').value; m.remind = $('#f-r').checked; t = { ...t, title: m.title }; };
  openSheet(''); paint();
  if (!editing) setTimeout(() => $('#f-title')?.focus(), 50);
}

function journalSheet(j) {
  const editing = !!j;
  const m = { icon: j?.icon || '📓', color: j?.color || '#16ec06', kind: j?.kind || 'build' };
  openSheet(`<h2>${editing ? 'Edit journal' : 'New journal'}</h2>
    <label>Name</label><input id="j-name" placeholder="e.g. Skincare" value="${esc(j?.name || '')}" maxlength="40">
    <label>Icon (emoji)</label><input id="j-icon" value="${esc(m.icon)}" maxlength="4" style="font-size:24px;text-align:center;max-width:90px">
    <label>Type</label><div class="seg" id="j-kind"><button data-v="build" class="${m.kind === 'build' ? 'on' : ''}">Build / do</button><button data-v="quit" class="${m.kind === 'quit' ? 'on' : ''}">Quit / avoid</button></div>
    <p class="mute small">For "quit" journals, ✓ means you stayed clean today.</p>
    <button class="btn" id="j-save">${editing ? 'Save' : 'Create journal'}</button>
    ${editing ? '<button class="btn danger" id="j-del">Delete journal + its tasks</button>' : ''}<button class="btn ghost" id="j-x">Cancel</button>`);
  document.querySelectorAll('#j-kind button').forEach(b => b.onclick = () => { m.kind = b.dataset.v; document.querySelectorAll('#j-kind button').forEach(x => x.classList.toggle('on', x === b)); });
  $('#j-x').onclick = closeSheet;
  $('#j-save').onclick = async () => {
    const name = $('#j-name').value.trim(); if (!name) return toast('Name it first');
    const body = { name, icon: $('#j-icon').value || '📓', kind: m.kind, color: m.color };
    await api(editing ? '/journals/' + j.id : '/journals', { method: editing ? 'PUT' : 'POST', body });
    closeSheet(); await load();
  };
  if (editing) $('#j-del').onclick = async () => {
    if (!confirm(`Delete "${j.name}" and all its tasks?`)) return;
    await api('/journals/' + j.id, { method: 'DELETE' }); if (S.filter == j.id) S.filter = 'all'; closeSheet(); await load();
  };
}

// ---------- JOURNALS ----------
function renderJournals() {
  const hab = Object.fromEntries(S.insights.habits.map(h => [h.id, h]));
  let html = `<div class="row"><div class="sp"><h1>Your</h1><h2>Journals</h2></div><button class="add" id="addj" style="width:40px;height:40px">+</button></div>`;
  for (const j of S.journals) {
    const ts = S.allTasks.filter(t => t.journal_id === j.id);
    html += `<div class="card"><div class="jh"><div class="jicon">${esc(j.icon)}</div><div class="sp"><b>${esc(j.name)}</b><div class="mute small">${j.kind === 'quit' ? 'Quit / avoid' : 'Build / do'} · ${ts.length} task${ts.length === 1 ? '' : 's'}</div></div>
      <button class="nav" data-ej="${j.id}">✎</button></div>`;
    html += ts.map(t => {
      const h = hab[t.id] || {};
      return `<button class="jt" data-et="${t.id}"><span class="sp">${esc(t.title)}<div class="mute small">${S.cfg.slots.find(s => s.key === t.slot).label}${t.time ? ' · ' + t12(t.time) : ''}${t.days.length < 7 ? ' · ' + [...t.days].map(d => DAYN[d]).join('') : ''}</div></span>
        ${h.streak >= 1 ? `<span class="tag hot">🔥 ${h.streak}</span>` : ''}</button>`;
    }).join('');
    html += `<button class="btn ghost" data-nt="${j.id}" style="padding:10px;margin-top:12px">+ Add task</button></div>`;
  }
  $('#view').innerHTML = html;
  const v = $('#view');
  $('#addj').onclick = () => journalSheet();
  v.querySelectorAll('[data-ej]').forEach(b => b.onclick = () => journalSheet(S.journals.find(j => j.id === +b.dataset.ej)));
  v.querySelectorAll('[data-et]').forEach(b => b.onclick = () => taskSheet(S.allTasks.find(t => t.id === +b.dataset.et)));
  v.querySelectorAll('[data-nt]').forEach(b => b.onclick = () => taskSheet({ journal_id: +b.dataset.nt }));
}

// ---------- INSIGHTS ----------
function renderInsights() {
  const I = S.insights, today = S.cfg.today;
  const rate = I.weekRate ?? 0;
  let html = `<h1>Last 7 days</h1><h2>Insights</h2>
    <div class="card ringcard">${ring(rate, 'WEEK')}<div class="stats"><div class="mute small">Share of scheduled tasks you completed this week.</div>
    ${I.slotRates.length ? I.slotRates.sort((a, b) => b.rate - a.rate).slice(0, 3).map(s => `<div class="small"><span class="dot" style="background:${ringColor(s.rate)}"></span> ${s.label} <b>${s.rate}%</b></div>`).join('') : '<div class="small mute">Log a few days to see which part of the day is strongest.</div>'}</div></div>`;
  for (const c of I.coach) html += `<div class="coach ${c.level}">${esc(c.text)}</div>`;

  html += `<div class="card"><b>Daily completion</b><div class="bars">${I.week.map(d => {
    const p = d.total ? Math.round(100 * d.done / d.total) : 0;
    return `<div class="bar"><i style="height:${Math.max(4, p)}%;background:${d.total ? ringColor(p) : '#25262c'}"></i><small>${DAYN[dowOf(d.date)]}</small></div>`;
  }).join('')}</div></div>`;

  const first = dowOf(I.heat[0].date);
  html += `<div class="card"><b>Last 5 weeks</b><div class="heat" style="margin-top:10px">${DAYN.map(d => `<small class="mute" style="text-align:center">${d}</small>`).join('')}</div>
    <div class="heat" style="margin-top:4px">${'<i style="background:none"></i>'.repeat(first)}${I.heat.map(d => {
      const p = d.total ? d.done / d.total : null;
      const bg = p == null ? '' : `background:${ringColor(p * 100)};opacity:${0.25 + 0.75 * p}`;
      return `<i title="${d.date}: ${d.done}/${d.total}" style="${bg};${d.date === today ? 'outline:2px solid #fff' : ''}"></i>`;
    }).join('')}</div></div>`;

  const hs = [...I.habits].sort((a, b) => b.missedRun - a.missedRun || b.streak - a.streak);
  html += `<div class="card"><b>Habits</b>${hs.length ? hs.map(h => `<div class="hrow"><div class="sp">${esc(h.title)}<div class="mute small">${esc(h.icon)} ${esc(h.journal)}</div></div>
    ${h.missedRun >= 2 ? `<span class="tag bad">missed ${h.missedRun}d</span>` : ''}
    <div style="text-align:right"><div>🔥 <b>${h.streak}</b> <span class="mute small">best ${h.best}</span></div><div class="mute small">${h.rate30 == null ? '—' : h.rate30 + '% / 30d'}</div></div></div>`).join('') : '<p class="mute">No habits yet.</p>'}</div>`;
  $('#view').innerHTML = html;
}

// ---------- SETTINGS ----------
function b64ToU8(b) { const p = '='.repeat((4 - b.length % 4) % 4), s = atob((b + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, c => c.charCodeAt(0)); }

async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return toast('Push not supported here. On iPhone: Share → Add to Home Screen first.');
  if (await Notification.requestPermission() !== 'granted') return toast('Notifications blocked in browser settings');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(S.cfg.vapidPublicKey) });
  await api('/push/subscribe', { method: 'POST', body: sub.toJSON() });
  S.cfg.subscribed = true; toast('Reminders enabled'); renderSettings();
}

async function renderSettings() {
  const c = S.cfg, perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const ics = `${location.origin}${c.icsPath}`, webcal = ics.replace(/^https?:/, 'webcal:');
  $('#view').innerHTML = `<h1>App</h1><h2>Settings</h2>
  <div class="card"><b>Phone reminders</b><p class="mute small">Notifications at each task's time (or the slot's default time). You can tap ✓ / ✕ right on the notification.</p>
    <p class="small">Status: <b style="color:${c.subscribed && perm === 'granted' ? 'var(--green)' : 'var(--yellow)'}">${c.subscribed && perm === 'granted' ? 'Enabled on a device' : perm === 'denied' ? 'Blocked' : 'Not enabled'}</b></p>
    <button class="btn" id="en">Enable on this device</button><button class="btn ghost" id="test">Send test notification</button></div>
  <div class="card"><b>Calendar alarms</b><p class="mute small">Subscribe your phone's Calendar to get native alarms for every reminder, even if push is off.</p>
    ${location.protocol === 'https:' ? `<a class="btn ghost" style="text-align:center;text-decoration:none" href="${esc(webcal)}">Subscribe in Calendar</a>` : '<p class="small" style="color:var(--yellow)">Subscribing needs the deployed HTTPS site. Until then, download the file and open it to import once.</p>'}
    <a class="btn ghost" style="text-align:center;text-decoration:none" href="${esc(ics)}&download=1">Download .ics file</a>
    <button class="btn ghost" id="copyics">Copy feed link</button></div>
  <div class="card"><b>Time</b>
    <label class="mute small" style="display:block;margin:10px 0 6px">Timezone</label><input id="tz" value="${esc(c.tz)}">
    <label class="mute small" style="display:block;margin:10px 0 6px">New day starts at (hour, 0–8)</label><input id="ds" type="number" min="0" max="8" value="${c.dayStart}">
    <label class="mute small" style="display:block;margin:10px 0 6px">Evening check-in</label><input id="ci" type="time" value="${esc(c.checkinTime)}">
    <button class="btn" id="savecfg">Save</button><p class="mute small">With "4", a task at 1 AM still counts for the previous day. Your day flips over by itself.</p></div>
  <div class="card"><button class="btn ghost" id="logout" style="margin:0">Lock app</button></div>`;
  $('#en').onclick = () => enablePush().catch(e => toast(e.message));
  $('#test').onclick = async () => { chime(); const r = await api('/push/test', { method: 'POST' }); toast(r.sent ? 'Sent!' : 'No device subscribed yet'); };
  $('#copyics').onclick = () => navigator.clipboard.writeText(ics).then(() => toast('Link copied'));
  $('#savecfg').onclick = async () => {
    try { S.cfg = { ...S.cfg, ...(await api('/config', { method: 'PUT', body: { tz: $('#tz').value.trim(), dayStart: +$('#ds').value, checkinTime: $('#ci').value } })) }; toast('Saved'); S.cfg.today = logicalToday(); S.date = S.cfg.today; await load(); S.tab = 'settings'; render(); }
    catch (e) { toast(e.message); }
  };
  $('#logout').onclick = () => { store.del('pin'); location.reload(); };
}

boot();
