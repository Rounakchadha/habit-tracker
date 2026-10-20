const { allTasks, effectiveTime } = require('./insights');

const DAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const esc = s => String(s).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');

// Floating-time recurring events with an alarm at start: shows up as phone Calendar alerts.
function build() {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//HabitTracker//EN', 'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Habit Tracker', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H'];
  for (const t of allTasks().filter(t => t.remind)) {
    const [h, m] = effectiveTime(t).split(':');
    const date = t.start_date.replace(/-/g, '');
    const byday = [...t.days].map(d => DAY[+d]).join(',');
    lines.push('BEGIN:VEVENT', `UID:task-${t.id}@habit-tracker`, `DTSTAMP:${date}T000000Z`,
      `DTSTART:${date}T${h}${m}00`, 'DURATION:PT15M', `RRULE:FREQ=WEEKLY;BYDAY=${byday}`,
      `SUMMARY:${esc(`${t.journal_icon} ${t.title}`)}`, `DESCRIPTION:${esc(t.journal_name)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(t.title)}`, 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

module.exports = { build };
