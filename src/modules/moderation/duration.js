'use strict';

const UNITS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

// Parses simple durations like "10m", "2h", "1d", "30s" into milliseconds.
// Returns null if the string doesn't match the expected format.
function parseDuration(input) {
  const match = /^(\d+)\s*(s|m|h|d)$/i.exec(String(input ?? '').trim());
  if (!match) return null;
  return parseInt(match[1], 10) * UNITS[match[2].toLowerCase()];
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return '–';
  const days = Math.floor(ms / UNITS.d);
  if (days >= 1) return `${days}d`;
  const hours = Math.floor(ms / UNITS.h);
  if (hours >= 1) return `${hours}h`;
  const minutes = Math.floor(ms / UNITS.m);
  if (minutes >= 1) return `${minutes}m`;
  return `${Math.floor(ms / UNITS.s)}s`;
}

module.exports = { parseDuration, formatDuration };
