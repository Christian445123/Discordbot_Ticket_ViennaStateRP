'use strict';

// Resolves which guild an /api request is about (query param, falling back
// to the legacy single-guild env var so existing bookmarks/clients keep
// working), and gates every module route behind a valid license except a
// short allowlist that must keep working even when the license is invalid
// (identity, the guild picker, and the license page itself).

const guards = require('../core/guards');

const UNGATED_PREFIXES = ['/me', '/guilds', '/license'];

// Every /api route requires a logged-in session — hoisted here so it runs
// before the license gate below (an anonymous request should get a 401,
// never a 400/403 that reveals anything about guild/license state).
function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  return res.status(401).json({ error: 'Nicht angemeldet' });
}

function resolveGuildId(req, res, next) {
  req.guildId = req.query.guild || req.query.guildId || process.env.DISCORD_GUILD_ID || null;
  next();
}

async function requireLicense(req, res, next) {
  if (UNGATED_PREFIXES.some(p => req.path === p || req.path.startsWith(`${p}/`))) return next();
  if (guards.isSuperAdmin(req.user.id)) return next(); // bot owner: full access everywhere

  if (!req.guildId) return res.status(400).json({ error: 'Keine Guild ausgewählt' });

  const valid = await guards.requireLicenseSilent(req.guildId);
  if (!valid) {
    return res.status(403).json({ error: 'license_invalid', message: 'Für diesen Server liegt keine gültige Lizenz vor.' });
  }
  next();
}

module.exports = { requireAuth, resolveGuildId, requireLicense };
