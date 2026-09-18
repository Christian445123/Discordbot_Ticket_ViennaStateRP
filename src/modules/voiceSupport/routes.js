'use strict';

// Admin-only web API for the Voice-Support waiting room — mounted under the
// same /api router as the tickets module (see src/web/server.js), so every
// handler here already runs behind requireAuth + requireGuildAdmin.

const express          = require('express');
const { ChannelType }  = require('discord.js');
const db        = require('./db');
const scheduler = require('./scheduler');
const hours     = require('./hours');
const ticketsDb = require('../tickets/db');
const logger    = require('../../utils/logger');

const VALID_OVERRIDES = new Set(['open', 'closed']);

// Always sends back exactly 7 rows (Sun..Sat), filling in gaps as
// "disabled" — the web form always edits/saves the full week at once, so
// there's never a partial/sparse list to reason about client-side.
function normalizeIncomingDays(input) {
  if (!Array.isArray(input)) return null;
  const byWeekday = new Map(input.map(d => [Number(d.weekday), d]));
  const days = [];
  for (let weekday = 0; weekday <= 6; weekday++) {
    const d = byWeekday.get(weekday);
    const enabled = !!d?.enabled;
    days.push({
      weekday,
      enabled,
      start_time: enabled ? (d.start_time || null) : null,
      end_time:   enabled ? (d.end_time || null) : null,
    });
  }
  return days;
}

module.exports = function voiceSupportRoutes(discordClient) {
  const router = express.Router();

  // ── Channel pickers (waiting room = voice, notifications = text) ────────────
  router.get('/admin/voice-support/channels', async (req, res) => {
    try {
      const guild = discordClient.guilds.cache.get(req.guildId);
      if (!guild) return res.status(503).json({ error: 'Bot nicht bereit' });

      const wantedType = req.query.type === 'text' ? ChannelType.GuildText : ChannelType.GuildVoice;
      const channels = guild.channels.cache
        .filter(c => c.type === wantedType)
        .sort((a, b) => a.position - b.position)
        .map(c => ({ id: c.id, name: c.name }));
      res.json(channels);
    } catch (err) {
      logger.error('Voice-Support: Kanäle laden fehlgeschlagen:', err.message);
      res.status(500).json({ error: 'Kanäle konnten nicht geladen werden' });
    }
  });

  // ── Config + support hours (one payload, always shown together) ─────────────
  router.get('/admin/voice-support', async (req, res) => {
    try {
      const guildId = req.guildId;
      await db.ensureGuild(guildId);

      const [cfg, hourRows] = await Promise.all([db.getConfig(guildId), db.getHours(guildId)]);
      const hoursByWeekday = new Map(hourRows.map(r => [r.weekday, r]));
      const days = [0, 1, 2, 3, 4, 5, 6].map(weekday => {
        const row = hoursByWeekday.get(weekday);
        return {
          weekday,
          enabled:    !!row?.enabled,
          start_time: row?.start_time || '',
          end_time:   row?.end_time || '',
        };
      });

      res.json({
        waiting_channel_id: cfg?.waiting_channel_id || null,
        notify_channel_id:  cfg?.notify_channel_id || null,
        staff_role_id:      cfg?.staff_role_id || null,
        ticket_category:    cfg?.ticket_category || null,
        manual_override:    cfg?.manual_override || null,
        open:               await scheduler.isOpen(guildId, cfg),
        timezone:           hours.TIMEZONE,
        days,
      });
    } catch (err) {
      logger.error('Voice-Support: Konfiguration laden fehlgeschlagen:', err.message);
      res.status(500).json({ error: 'Konfiguration konnte nicht geladen werden' });
    }
  });

  router.put('/admin/voice-support', async (req, res) => {
    try {
      const guildId = req.guildId;
      await db.ensureGuild(guildId);

      const updates = {};
      if (Object.prototype.hasOwnProperty.call(req.body, 'waiting_channel_id')) {
        updates.waiting_channel_id = req.body.waiting_channel_id || null;
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'notify_channel_id')) {
        updates.notify_channel_id = req.body.notify_channel_id || null;
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'staff_role_id')) {
        updates.staff_role_id = req.body.staff_role_id || null;
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'manual_override')) {
        const value = req.body.manual_override || null;
        if (value !== null && !VALID_OVERRIDES.has(value)) {
          return res.status(400).json({ error: 'Ungültiger Wert für manual_override' });
        }
        updates.manual_override = value;
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'ticket_category')) {
        const name = req.body.ticket_category || null;
        if (name && !(await ticketsDb.getCategoryByName(guildId, name))) {
          return res.status(400).json({ error: 'Ticket-Kategorie nicht gefunden' });
        }
        updates.ticket_category = name;
      }
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'Keine Felder angegeben' });
      }

      await db.updateConfig(guildId, updates);
      await scheduler.syncGuildChannelName(discordClient, guildId);
      res.json({ success: true });
    } catch (err) {
      logger.error('Voice-Support: Speichern fehlgeschlagen:', err.message);
      res.status(500).json({ error: 'Speichern fehlgeschlagen' });
    }
  });

  router.put('/admin/voice-support/hours', async (req, res) => {
    try {
      const guildId = req.guildId;
      const days = normalizeIncomingDays(req.body.days);
      if (!days) return res.status(400).json({ error: 'Ungültige Supportzeiten' });

      await db.ensureGuild(guildId);
      await db.setHours(guildId, days);
      await scheduler.syncGuildChannelName(discordClient, guildId);
      res.json({ success: true });
    } catch (err) {
      logger.error('Voice-Support: Supportzeiten speichern fehlgeschlagen:', err.message);
      res.status(500).json({ error: 'Supportzeiten konnten nicht gespeichert werden' });
    }
  });

  return router;
};
