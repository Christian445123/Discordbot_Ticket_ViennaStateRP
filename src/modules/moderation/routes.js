'use strict';

// Admin-only web API for the moderation module — mounted under the same
// /api router as tickets/voiceSupport (see src/web/server.js), so every
// handler here already runs behind requireAuth + requireGuildAdmin.

const express         = require('express');
const { ChannelType } = require('discord.js');
const db     = require('./db');
const risk   = require('./risk');
const logger = require('../../utils/logger');

const VALID_ESCALATION_ACTIONS = new Set(['timeout', 'kick', 'ban']);

function normalizeIncomingRules(input) {
  if (!Array.isArray(input)) return null;
  const rules = [];
  const seenThresholds = new Set();
  for (const r of input) {
    const threshold = Number(r.threshold);
    const action    = r.action;
    if (!Number.isInteger(threshold) || threshold < 1) return null;
    if (!VALID_ESCALATION_ACTIONS.has(action)) return null;
    if (seenThresholds.has(threshold)) return null; // one rule per threshold
    seenThresholds.add(threshold);

    const durationMinutes = action === 'timeout' ? Number(r.duration_minutes) : null;
    if (action === 'timeout' && (!Number.isFinite(durationMinutes) || durationMinutes < 1)) return null;

    rules.push({ threshold, action, duration_minutes: durationMinutes });
  }
  return rules.sort((a, b) => a.threshold - b.threshold);
}

module.exports = function moderationRoutes(discordClient) {
  const router = express.Router();

  // ── Text-channel picker (log channel, honeypot channel) ─────────────────────
  router.get('/admin/moderation/channels', async (req, res) => {
    try {
      const guild = discordClient.guilds.cache.get(req.guildId);
      if (!guild) return res.status(503).json({ error: 'Bot nicht bereit' });

      const channels = guild.channels.cache
        .filter(c => c.type === ChannelType.GuildText)
        .sort((a, b) => a.position - b.position)
        .map(c => ({ id: c.id, name: c.name }));
      res.json(channels);
    } catch (err) {
      logger.error('Moderation: Kanäle laden fehlgeschlagen:', err.message);
      res.status(500).json({ error: 'Kanäle konnten nicht geladen werden' });
    }
  });

  // ── Config + escalation rules (one payload, always shown together) ──────────
  router.get('/admin/moderation', async (req, res) => {
    try {
      const guildId = req.guildId;
      await db.ensureGuild(guildId);

      const [cfg, rules] = await Promise.all([db.getConfig(guildId), db.getEscalationRules(guildId)]);
      let bannedWords = [];
      try { bannedWords = JSON.parse(cfg?.automod_words || '[]'); } catch { bannedWords = []; }
      let exemptRoleIds = [];
      try { exemptRoleIds = JSON.parse(cfg?.exempt_role_ids || '[]'); } catch { exemptRoleIds = []; }

      res.json({
        log_channel_id:       cfg?.log_channel_id || null,
        honeypot_channel_id:  cfg?.honeypot_channel_id || null,
        banned_words:         bannedWords,
        spam_enabled:         !!cfg?.spam_enabled,
        spam_message_limit:   cfg?.spam_message_limit ?? 5,
        spam_window_seconds:  cfg?.spam_window_seconds ?? 5,
        mention_enabled:      !!cfg?.mention_enabled,
        mention_limit:        cfg?.mention_limit ?? 5,
        invite_block_enabled: !!cfg?.invite_block_enabled,
        everyone_mention_enabled: cfg?.everyone_mention_enabled == null ? true : !!cfg.everyone_mention_enabled,
        exempt_role_ids:      exemptRoleIds,
        escalation_rules:     rules.map(r => ({ threshold: r.threshold, action: r.action, duration_minutes: r.duration_minutes })),
      });
    } catch (err) {
      logger.error('Moderation: Konfiguration laden fehlgeschlagen:', err.message);
      res.status(500).json({ error: 'Konfiguration konnte nicht geladen werden' });
    }
  });

  router.put('/admin/moderation', async (req, res) => {
    try {
      const guildId = req.guildId;
      await db.ensureGuild(guildId);

      const body = req.body;
      const updates = {};
      if (Object.prototype.hasOwnProperty.call(body, 'log_channel_id')) updates.log_channel_id = body.log_channel_id || null;
      if (Object.prototype.hasOwnProperty.call(body, 'honeypot_channel_id')) updates.honeypot_channel_id = body.honeypot_channel_id || null;
      if (Object.prototype.hasOwnProperty.call(body, 'banned_words')) {
        const words = Array.isArray(body.banned_words) ? body.banned_words.map(w => String(w).trim()).filter(Boolean) : [];
        updates.automod_words = JSON.stringify(words);
      }
      if (Object.prototype.hasOwnProperty.call(body, 'spam_enabled')) updates.spam_enabled = body.spam_enabled ? 1 : 0;
      if (Object.prototype.hasOwnProperty.call(body, 'spam_message_limit')) updates.spam_message_limit = Math.max(1, Number(body.spam_message_limit) || 5);
      if (Object.prototype.hasOwnProperty.call(body, 'spam_window_seconds')) updates.spam_window_seconds = Math.max(1, Number(body.spam_window_seconds) || 5);
      if (Object.prototype.hasOwnProperty.call(body, 'mention_enabled')) updates.mention_enabled = body.mention_enabled ? 1 : 0;
      if (Object.prototype.hasOwnProperty.call(body, 'mention_limit')) updates.mention_limit = Math.max(1, Number(body.mention_limit) || 5);
      if (Object.prototype.hasOwnProperty.call(body, 'invite_block_enabled')) updates.invite_block_enabled = body.invite_block_enabled ? 1 : 0;
      if (Object.prototype.hasOwnProperty.call(body, 'everyone_mention_enabled')) updates.everyone_mention_enabled = body.everyone_mention_enabled ? 1 : 0;
      if (Object.prototype.hasOwnProperty.call(body, 'exempt_role_ids')) {
        const roleIds = Array.isArray(body.exempt_role_ids) ? body.exempt_role_ids.map(String).filter(Boolean) : [];
        updates.exempt_role_ids = JSON.stringify(roleIds);
      }

      if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Keine Felder angegeben' });

      await db.updateConfig(guildId, updates);
      res.json({ success: true });
    } catch (err) {
      logger.error('Moderation: Speichern fehlgeschlagen:', err.message);
      res.status(500).json({ error: 'Speichern fehlgeschlagen' });
    }
  });

  router.put('/admin/moderation/escalation', async (req, res) => {
    try {
      const guildId = req.guildId;
      const rules = normalizeIncomingRules(req.body.rules);
      if (!rules) return res.status(400).json({ error: 'Ungültige Eskalationsregeln' });

      await db.ensureGuild(guildId);
      await db.setEscalationRules(guildId, rules);
      res.json({ success: true });
    } catch (err) {
      logger.error('Moderation: Eskalationsregeln speichern fehlgeschlagen:', err.message);
      res.status(500).json({ error: 'Eskalationsregeln konnten nicht gespeichert werden' });
    }
  });

  // ── Case history (read-only) ─────────────────────────────────────────────────
  router.get('/admin/moderation/cases', async (req, res) => {
    try {
      const cases = await db.getRecentCases(req.guildId, 100);
      res.json(cases);
    } catch (err) {
      logger.error('Moderation: Fallliste laden fehlgeschlagen:', err.message);
      res.status(500).json({ error: 'Fallliste konnte nicht geladen werden' });
    }
  });

  // ── Member activity overview + risk classification (read-only) ──────────────
  // One bulk guild.members.fetch() instead of per-user lookups — this is
  // an on-demand admin-panel view, not a hot path, so the cost is fine
  // even for a few thousand members.
  router.get('/admin/moderation/members', async (req, res) => {
    try {
      const guild = discordClient.guilds.cache.get(req.guildId);
      if (!guild) return res.status(503).json({ error: 'Bot nicht bereit' });

      const members = await guild.members.fetch();
      const [activityRows, caseCountRows] = await Promise.all([
        db.getActivity(req.guildId),
        db.getCaseCountsByUser(req.guildId),
      ]);
      const activityByUser = new Map(activityRows.map(r => [r.user_id, r]));
      const casesByUser    = new Map(caseCountRows.map(r => [r.user_id, r]));

      const now = Date.now();
      const result = members
        .filter(m => !m.user.bot)
        .map(m => {
          const activity   = activityByUser.get(m.id);
          const caseCounts = casesByUser.get(m.id);
          const accountAgeDays = Math.floor((now - m.user.createdTimestamp) / 86400000);
          const joinAgeDays    = m.joinedTimestamp ? Math.floor((now - m.joinedTimestamp) / 86400000) : null;

          const activeWarns = Number(caseCounts?.active_warns || 0);
          const kicks       = Number(caseCounts?.kicks || 0);
          const bans        = Number(caseCounts?.bans || 0);
          const { score, label } = risk.computeRisk({ activeWarns, kicks, bans, accountAgeDays, joinAgeDays });

          return {
            user_id:            m.id,
            username:           m.user.tag,
            message_count:      activity?.message_count || 0,
            last_message_at:    activity?.last_message_at || null,
            joined_at:          m.joinedAt,
            account_created_at: m.user.createdAt,
            active_warns:       activeWarns,
            kicks,
            bans,
            risk_score:         score,
            risk_label:         label,
          };
        })
        .sort((a, b) => b.risk_score - a.risk_score);

      res.json(result);
    } catch (err) {
      logger.error('Moderation: Mitgliederübersicht laden fehlgeschlagen:', err.message);
      res.status(500).json({ error: 'Mitgliederübersicht konnte nicht geladen werden' });
    }
  });

  return router;
};
