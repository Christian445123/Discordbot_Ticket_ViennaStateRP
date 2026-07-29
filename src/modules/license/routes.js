'use strict';

const express         = require('express');
const licenseDb       = require('./db');
const licenseService  = require('../../core/license/licenseService');
const guards           = require('../../core/guards');
const { generateLicenseKey } = require('./keygen');

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  return res.status(401).json({ error: 'Nicht angemeldet' });
}

function requireSuperAdmin(req, res, next) {
  if (!guards.isSuperAdmin(req.user.id)) return res.status(403).json({ error: 'Nur für Bot-Administratoren' });
  next();
}

module.exports = function licenseRoutes(discordClient) {
  const router = express.Router();

  router.get('/license/status', requireAuth, async (req, res) => {
    if (!req.guildId) return res.status(400).json({ error: 'Keine Guild ausgewählt' });
    res.json(await licenseService.status(req.guildId));
  });

  router.post('/license/activate', requireAuth, async (req, res) => {
    if (!req.guildId) return res.status(400).json({ error: 'Keine Guild ausgewählt' });

    const isAdmin = await guards.isGuildAdmin(discordClient, req.guildId, req.user.id);
    if (!isAdmin) return res.status(403).json({ error: 'Nur Server-Administratoren können eine Lizenz aktivieren' });

    const key = req.body.key?.trim();
    if (!key) return res.status(400).json({ error: 'Kein Lizenzschlüssel angegeben' });

    const license = await licenseDb.getLicenseByKey(key);
    if (!license) return res.status(404).json({ error: 'Unbekannter Lizenzschlüssel' });
    if (license.status !== 'active') return res.status(400).json({ error: 'Dieser Lizenzschlüssel wurde gesperrt' });
    if (license.expires_at && new Date(license.expires_at).getTime() <= Date.now()) {
      return res.status(400).json({ error: 'Dieser Lizenzschlüssel ist abgelaufen' });
    }

    const activeCount = await licenseDb.countActivationsForKey(key, req.guildId);
    if (activeCount >= license.max_guilds) {
      return res.status(400).json({ error: `Lizenzschlüssel bereits auf ${license.max_guilds} Server(n) aktiv` });
    }

    await licenseDb.activateLicense(req.guildId, key);
    licenseService.invalidate(req.guildId);
    res.json({ success: true });
  });

  // ── Super-admin: cross-guild license management ───────────────────────────
  // Mirrors /lizenz-admin in Discord — deliberately not guild-scoped (it
  // manages licenses, not a single guild's activation) and works regardless
  // of any guild's own license state, same as the "/license" prefix allows.

  router.get('/license/admin/licenses', requireAuth, requireSuperAdmin, async (req, res) => {
    res.json(await licenseDb.listLicenses());
  });

  router.post('/license/admin/licenses', requireAuth, requireSuperAdmin, async (req, res) => {
    const { label, maxGuilds, days } = req.body;
    const licenseKey = generateLicenseKey();
    const expiresAt = days ? new Date(Date.now() + Number(days) * 24 * 60 * 60 * 1000) : null;

    await licenseDb.createLicense({
      licenseKey, label: label || null, maxGuilds: Number(maxGuilds) || 1, expiresAt,
    });
    res.json({ success: true, licenseKey });
  });

  router.post('/license/admin/licenses/:key/status', requireAuth, requireSuperAdmin, async (req, res) => {
    const key = req.params.key;
    const status = req.body.status === 'active' ? 'active' : 'revoked';
    const license = await licenseDb.getLicenseByKey(key);
    if (!license) return res.status(404).json({ error: 'Unbekannter Lizenzschlüssel' });

    await licenseDb.setLicenseStatus(key, status);
    for (const guildId of await licenseDb.getGuildIdsForKey(key)) licenseService.invalidate(guildId);
    res.json({ success: true });
  });

  router.post('/license/admin/licenses/:key/extend', requireAuth, requireSuperAdmin, async (req, res) => {
    const key  = req.params.key;
    const days = Number(req.body.days);
    if (!days || days <= 0) return res.status(400).json({ error: 'Ungültige Anzahl Tage' });

    const license = await licenseDb.getLicenseByKey(key);
    if (!license) return res.status(404).json({ error: 'Unbekannter Lizenzschlüssel' });

    const base = license.expires_at && new Date(license.expires_at).getTime() > Date.now()
      ? new Date(license.expires_at).getTime()
      : Date.now();
    const newExpiry = new Date(base + days * 24 * 60 * 60 * 1000);

    await licenseDb.extendLicense(key, newExpiry);
    for (const guildId of await licenseDb.getGuildIdsForKey(key)) licenseService.invalidate(guildId);
    res.json({ success: true, expiresAt: newExpiry });
  });

  return router;
};
