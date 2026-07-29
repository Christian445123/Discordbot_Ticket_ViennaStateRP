'use strict';

const express         = require('express');
const licenseDb       = require('./db');
const licenseService  = require('../../core/license/licenseService');
const guards           = require('../../core/guards');

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  return res.status(401).json({ error: 'Nicht angemeldet' });
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

  return router;
};
