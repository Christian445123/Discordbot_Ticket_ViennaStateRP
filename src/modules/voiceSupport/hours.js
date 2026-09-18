'use strict';

// Support-hours evaluation, independent of the server's own OS timezone —
// always evaluated in Europe/Vienna (this project's home timezone) via
// Intl, so behavior doesn't silently shift if the bot ever moves to a host
// configured with a different system timezone (e.g. a UTC-only VPS).
const TIMEZONE = 'Europe/Vienna';

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const WEEKDAY_LABELS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

function nowInTimezone(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
  let hour = parseInt(parts.hour, 10);
  if (hour === 24) hour = 0; // some locales render midnight as "24:00" with hour12:false
  return { weekday: WEEKDAY_INDEX[parts.weekday], minutes: hour * 60 + parseInt(parts.minute, 10) };
}

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// `rows` is whatever db.getHours(guildId) returned — a sparse list of
// { weekday, enabled, start_time, end_time }, one entry per configured day.
// A missing day, a disabled day, or an equal start/end time all mean
// "closed" that day. start > end is treated as an overnight window
// (e.g. 20:00–02:00) that wraps past midnight.
function isWithinSupportHours(rows, date = new Date()) {
  const { weekday, minutes } = nowInTimezone(date);
  const row = rows.find(r => r.weekday === weekday);
  if (!row || !row.enabled || !row.start_time || !row.end_time) return false;

  const start = timeToMinutes(row.start_time);
  const end   = timeToMinutes(row.end_time);
  if (start === end) return false;
  if (start < end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end;
}

module.exports = { TIMEZONE, WEEKDAY_LABELS, isWithinSupportHours };
