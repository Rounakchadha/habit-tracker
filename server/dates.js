// Timezone + "logical day" helpers. A logical day starts at `dayStart` hour (default 4 AM),
// so a task done at 1 AM still belongs to the previous day.

function partsInTz(tz, date = new Date()) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute };
}

const pad = n => String(n).padStart(2, '0');

function logicalToday(tz, dayStart = 4, now = new Date()) {
  const shifted = new Date(now.getTime() - dayStart * 3600e3);
  const p = partsInTz(tz, shifted);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
}

// minutes since the logical day started (0..1439)
function minutesIntoDay(tz, dayStart = 4, now = new Date()) {
  const p = partsInTz(tz, now);
  return (p.h * 60 + p.mi - dayStart * 60 + 1440) % 1440;
}

function toMinutesIntoDay(hhmm, dayStart = 4) {
  const [h, m] = hhmm.split(':').map(Number);
  return (h * 60 + m - dayStart * 60 + 1440) % 1440;
}

const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fmt = dt => `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
const addDays = (s, n) => { const dt = parse(s); dt.setUTCDate(dt.getUTCDate() + n); return fmt(dt); };
const dow = s => parse(s).getUTCDay(); // 0=Sun
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(parse(s));

module.exports = { partsInTz, logicalToday, minutesIntoDay, toMinutesIntoDay, addDays, dow, isDate, pad };
