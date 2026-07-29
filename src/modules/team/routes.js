'use strict';

const express            = require('express');
const db                 = require('./db');
const applicationService = require('./applicationService');
const guards              = require('../../core/guards');
const logger              = require('../../utils/logger');

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  return res.status(401).json({ error: 'Nicht angemeldet' });
}

module.exports = function teamRoutes(discordClient) {
  const router = express.Router();

  async function requireStaffMw(req, res, next) {
    const guildId = req.guildId;
    const isStaff = await guards.isStaff(discordClient, guildId, req.user.id);
    if (!isStaff) return res.status(403).json({ error: 'Nur Team-Leitung' });
    next();
  }

  router.get('/team/roster', requireAuth, requireStaffMw, async (req, res) => {
    const guildId = req.guildId;
    res.json(await db.getMembersByGuild(guildId));
  });

  router.get('/team/ranks', requireAuth, requireStaffMw, async (req, res) => {
    const guildId = req.guildId;
    res.json(await db.getRanks(guildId));
  });

  router.get('/team/warnings/:userId', requireAuth, requireStaffMw, async (req, res) => {
    const guildId = req.guildId;
    res.json(await db.getWarnings(guildId, req.params.userId));
  });

  router.get('/team/loa', requireAuth, requireStaffMw, async (req, res) => {
    const guildId = req.guildId;
    res.json(await db.getLoaByGuild(guildId));
  });

  router.post('/team/loa/:id/decide', requireAuth, requireStaffMw, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Ungültige ID' });
    const request = await db.getLoaById(id);
    if (!request || request.guild_id !== req.guildId) {
      return res.status(404).json({ error: 'Antrag nicht gefunden' });
    }
    await db.decideLoa(id, req.body.approved ? 'approved' : 'rejected', req.user.id);
    res.json({ success: true });
  });

  router.get('/team/applications', requireAuth, requireStaffMw, async (req, res) => {
    const guildId = req.guildId;
    res.json(await db.getPendingApplications(guildId));
  });

  router.post('/team/applications/:id/decide', requireAuth, requireStaffMw, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Ungültige ID' });

    const guild = discordClient.guilds.cache.get(req.guildId);
    if (!guild) return res.status(503).json({ error: 'Bot nicht bereit' });

    const result = await applicationService.decide(discordClient, guild, id, Boolean(req.body.accepted), req.user.id, req.body.note)
      .catch(err => { logger.error('Bewerbungs-Entscheidung fehlgeschlagen:', err.message); return { error: 'Interner Fehler' }; });

    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ success: true });
  });

  return router;
};
