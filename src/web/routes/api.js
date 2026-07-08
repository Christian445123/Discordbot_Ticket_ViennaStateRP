'use strict';

const express = require('express');
const db      = require('../../database/db');

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  return res.status(401).json({ error: 'Nicht angemeldet' });
}

module.exports = function apiRoutes(discordClient) {
  const router = express.Router();

  // ── Current user ─────────────────────────────────────────────────────────
  router.get('/me', requireAuth, (req, res) => {
    const { id, username, discriminator, avatar, guilds } = req.user;
    const guildId = process.env.DISCORD_GUILD_ID;

    const isInGuild = guilds?.some(g => g.id === guildId);

    // Check if staff (has staff role in the configured guild)
    let isStaff = false;
    try {
      const guildCfg = db.getGuild.get(guildId);
      if (guildCfg?.staff_role_id && discordClient.guilds.cache.has(guildId)) {
        const member = discordClient.guilds.cache.get(guildId).members.cache.get(id);
        if (member) isStaff = member.roles.cache.has(guildCfg.staff_role_id);
      }
    } catch (_) { /* member not cached – treat as non-staff */ }

    res.json({
      id,
      username,
      discriminator,
      avatar: avatar
        ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.png`
        : `https://cdn.discordapp.com/embed/avatars/${parseInt(discriminator, 10) % 5}.png`,
      isInGuild,
      isStaff,
    });
  });

  // ── Stats ─────────────────────────────────────────────────────────────────
  router.get('/stats', requireAuth, (req, res) => {
    const guildId = process.env.DISCORD_GUILD_ID;
    db.ensureGuild.run(guildId);
    const stats = db.getStats.get(guildId);
    res.json(stats);
  });

  // ── List tickets ──────────────────────────────────────────────────────────
  router.get('/tickets', requireAuth, (req, res) => {
    const guildId  = process.env.DISCORD_GUILD_ID;
    const userId   = req.user.id;
    db.ensureGuild.run(guildId);

    const guildCfg = db.getGuild.get(guildId);
    let isStaff    = false;

    try {
      if (guildCfg?.staff_role_id && discordClient.guilds.cache.has(guildId)) {
        const member = discordClient.guilds.cache.get(guildId).members.cache.get(userId);
        if (member) isStaff = member.roles.cache.has(guildCfg.staff_role_id);
      }
    } catch (_) { /* not cached */ }

    const tickets = isStaff
      ? db.getTicketsByGuild.all(guildId)
      : db.getTicketsByUser.all(guildId, userId);

    res.json(tickets);
  });

  // ── Single ticket ─────────────────────────────────────────────────────────
  router.get('/tickets/:id', requireAuth, (req, res) => {
    const ticketId = parseInt(req.params.id, 10);
    if (isNaN(ticketId)) return res.status(400).json({ error: 'Ungültige ID' });

    const ticket = db.getTicketById.get(ticketId);
    if (!ticket) return res.status(404).json({ error: 'Ticket nicht gefunden' });

    const guildId  = process.env.DISCORD_GUILD_ID;
    const userId   = req.user.id;
    const guildCfg = db.getGuild.get(guildId);

    let isStaff = false;
    try {
      if (guildCfg?.staff_role_id && discordClient.guilds.cache.has(guildId)) {
        const member = discordClient.guilds.cache.get(guildId).members.cache.get(userId);
        if (member) isStaff = member.roles.cache.has(guildCfg.staff_role_id);
      }
    } catch (_) { /* not cached */ }

    if (!isStaff && ticket.user_id !== userId) {
      return res.status(403).json({ error: 'Kein Zugriff' });
    }

    const messages = db.getMessages.all(ticketId).map(m => ({
      ...m,
      attachments: JSON.parse(m.attachments || '[]'),
    }));

    res.json({ ticket, messages });
  });

  // ── Close ticket via web ──────────────────────────────────────────────────
  router.post('/tickets/:id/close', requireAuth, async (req, res) => {
    const ticketId = parseInt(req.params.id, 10);
    if (isNaN(ticketId)) return res.status(400).json({ error: 'Ungültige ID' });

    const ticket = db.getTicketById.get(ticketId);
    if (!ticket)                return res.status(404).json({ error: 'Ticket nicht gefunden' });
    if (ticket.status === 'closed') return res.status(400).json({ error: 'Bereits geschlossen' });

    const guildId  = process.env.DISCORD_GUILD_ID;
    const userId   = req.user.id;
    const guildCfg = db.getGuild.get(guildId);

    let isStaff = false;
    try {
      if (guildCfg?.staff_role_id && discordClient.guilds.cache.has(guildId)) {
        const member = discordClient.guilds.cache.get(guildId).members.cache.get(userId);
        if (member) isStaff = member.roles.cache.has(guildCfg.staff_role_id);
      }
    } catch (_) { /* not cached */ }

    if (!isStaff && ticket.user_id !== userId) {
      return res.status(403).json({ error: 'Kein Zugriff' });
    }

    db.closeTicket.run({
      id:             ticketId,
      closed_by_id:   userId,
      closed_by_name: `${req.user.username} (Web)`,
    });

    // Notify Discord channel
    if (ticket.channel_id && discordClient.guilds.cache.has(guildId)) {
      try {
        const { EmbedBuilder } = require('discord.js');
        const channel = await discordClient.channels.fetch(ticket.channel_id).catch(() => null);
        if (channel) {
          const embed = new EmbedBuilder()
            .setTitle('🔒 Ticket geschlossen (Web)')
            .setDescription(`Dieses Ticket wurde über das Web-Interface von **${req.user.username}** geschlossen.`)
            .setColor(0xED4245)
            .setTimestamp();
          await channel.send({ embeds: [embed] });
          setTimeout(() => channel.delete().catch(() => {}), 5000);
        }
      } catch (_) { /* ignore Discord errors */ }
    }

    res.json({ success: true });
  });

  return router;
};
