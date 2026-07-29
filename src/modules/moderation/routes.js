'use strict';

const express = require('express');
const db      = require('./db');
const modLog  = require('./modLog');
const logger  = require('../../utils/logger');

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  return res.status(401).json({ error: 'Nicht angemeldet' });
}

module.exports = function moderationRoutes(discordClient) {
  const router = express.Router();

  // ── Own case history ("Meine Fälle") ─────────────────────────────────────
  router.get('/cases', requireAuth, async (req, res) => {
    const guildId = req.guildId;
    const cases = await db.getCasesByUser(guildId, req.user.id);
    res.json(cases);
  });

  // ── Submit an appeal for one of the user's own cases ─────────────────────
  router.post('/cases/:id/appeal', requireAuth, async (req, res) => {
    const caseId = parseInt(req.params.id, 10);
    if (isNaN(caseId)) return res.status(400).json({ error: 'Ungültige ID' });

    const modCase = await db.getCaseById(caseId);
    if (!modCase) return res.status(404).json({ error: 'Fall nicht gefunden' });
    if (modCase.user_id !== req.user.id) return res.status(403).json({ error: 'Kein Zugriff' });
    if (modCase.appeal_status !== 'none') return res.status(400).json({ error: 'Für diesen Fall liegt bereits ein Einspruch vor' });

    const message = req.body.message?.trim();
    if (!message) return res.status(400).json({ error: 'Nachricht darf nicht leer sein' });

    const appealId = await db.createAppeal(caseId, req.user.id, message);
    await db.setAppealStatus(caseId, 'pending');

    await modLog.logAppeal(discordClient, modCase.guild_id, {
      caseId, appealId, userTag: req.user.username, message,
    }).catch(err => logger.error('Appeal-Log fehlgeschlagen:', err.message));

    res.json({ success: true });
  });

  return router;
};
