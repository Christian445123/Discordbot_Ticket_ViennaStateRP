'use strict';

const express        = require('express');
const db             = require('../../database/db');
const ticketLog      = require('../../bot/ticketLog');
const categoryNotify = require('../../bot/categoryNotify');
const logger         = require('../../utils/logger');

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  return res.status(401).json({ error: 'Nicht angemeldet' });
}

function requireGuildMember(req, res, next) {
  const guildId   = process.env.DISCORD_GUILD_ID;
  const isInGuild = req.user.guilds?.some(g => g.id === guildId);
  if (!isInGuild) return res.status(403).json({ error: 'Du bist kein Mitglied dieses Servers' });
  return next();
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildAvatarUrl(user) {
  return user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
    : `https://cdn.discordapp.com/embed/avatars/${parseInt(user.discriminator || '0', 10) % 5}.png`;
}

const MAX_MESSAGE_LENGTH = 1800; // leaves headroom for the "**Name** (Quelle):\n" prefix within Discord's 2000-char limit

async function checkStaff(discordClient, guildId, userId) {
  try {
    const guildCfg = db.getGuild.get(guildId);
    if (!guildCfg?.staff_role_id) return false;
    if (!discordClient.guilds.cache.has(guildId)) return false;
    const guild  = discordClient.guilds.cache.get(guildId);
    const member = guild.members.cache.get(userId)
                   || await guild.members.fetch(userId).catch(() => null);
    if (!member) return false;
    return member.roles.cache.has(guildCfg.staff_role_id);
  } catch { return false; }
}

function generateTranscript(ticket, messages) {
  const ticketNum = String(ticket.ticket_number).padStart(4, '0');

  const msgsHtml = messages.map(m => {
    const attachHtml = m.attachments
      .map(a => `<a href="${escHtml(a.url)}" target="_blank" rel="noopener">${escHtml(a.name)}</a>`)
      .join(' ');
    const avatarHtml = m.avatar_url
      ? `<img class="av" src="${escHtml(m.avatar_url)}" onerror="this.style.display='none'" />`
      : `<div class="av av-placeholder">${escHtml(m.username.charAt(0).toUpperCase())}</div>`;
    return `
    <div class="msg">
      <div class="msg-head">${avatarHtml}<span class="author">${escHtml(m.username)}</span>
        <span class="time">${new Date(m.created_at).toLocaleString('de-AT')}</span></div>
      ${m.content ? `<div class="body">${escHtml(m.content)}</div>` : ''}
      ${attachHtml ? `<div class="attach">📎 ${attachHtml}</div>` : ''}
    </div>`;
  }).join('');

  return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Transkript – Ticket #${ticketNum}</title>
<style>
*{box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#1e1f22;color:#e3e5e8;margin:0;padding:24px}
.wrap{max-width:860px;margin:0 auto}.header{background:#2b2d31;border-radius:12px;padding:20px 24px;margin-bottom:24px;border-left:4px solid #5865f2}
h1{margin:0 0 12px;font-size:1.25rem;color:#fff}.meta{display:flex;gap:14px;flex-wrap:wrap;font-size:.82rem;color:#96989d}
.badge{display:inline-block;padding:.2em .6em;border-radius:4px;font-size:.75rem;font-weight:600}
.open{background:rgba(87,242,135,.15);color:#57f287}.closed{background:rgba(150,152,157,.15);color:#96989d}
.msgs{display:flex;flex-direction:column;gap:10px}.msg{background:#2b2d31;border-radius:10px;padding:12px 16px}
.msg-head{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.av{width:32px;height:32px;border-radius:50%;flex-shrink:0;object-fit:cover}
.av-placeholder{background:#5865f2;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.9rem}
.author{font-weight:600;font-size:.95rem}.time{font-size:.72rem;color:#96989d;margin-left:auto}
.body{font-size:.9rem;line-height:1.6;white-space:pre-wrap;word-break:break-word}
.attach{margin-top:8px;font-size:.82rem}.attach a{color:#5865f2;text-decoration:none}
.empty{text-align:center;color:#96989d;padding:40px}
.footer{text-align:center;margin-top:28px;font-size:.72rem;color:#96989d;border-top:1px solid rgba(255,255,255,.06);padding-top:14px}
</style></head><body><div class="wrap">
<div class="header">
  <h1>🎫 Ticket #${ticketNum} &mdash; ${escHtml(ticket.subject || '(kein Betreff)')}</h1>
  <div class="meta">
    <span>👤 ${escHtml(ticket.username)}</span>
    <span>🏷️ ${escHtml(ticket.category)}</span>
    <span>📅 ${new Date(ticket.created_at).toLocaleString('de-AT')}</span>
    ${ticket.closed_at ? `<span>🔒 Geschlossen: ${new Date(ticket.closed_at).toLocaleString('de-AT')}</span>` : ''}
    ${ticket.closed_by_name ? `<span>von ${escHtml(ticket.closed_by_name)}</span>` : ''}
    <span class="badge ${ticket.status}">${ticket.status === 'open' ? 'Offen' : 'Geschlossen'}</span>
  </div>
</div>
<div class="msgs">${msgsHtml || '<div class="empty">Keine Nachrichten vorhanden.</div>'}</div>
<div class="footer">Transkript generiert am ${new Date().toLocaleString('de-AT')} &mdash; ${messages.length} Nachrichten</div>
</div></body></html>`;
}

module.exports = function apiRoutes(discordClient) {
  const router = express.Router();

  // ── Current user ─────────────────────────────────────────────────────────
  router.get('/me', requireAuth, async (req, res) => {
    const { id, username, discriminator, guilds } = req.user;
    const guildId   = process.env.DISCORD_GUILD_ID;
    const isInGuild = guilds?.some(g => g.id === guildId);
    const isStaff   = await checkStaff(discordClient, guildId, id);
    res.json({
      id, username, discriminator, isInGuild, isStaff,
      avatar: buildAvatarUrl(req.user),
    });
  });

  // ── Categories (for the create-ticket & category-change dropdowns) ─────────
  router.get('/categories', requireAuth, (req, res) => {
    const guildId = process.env.DISCORD_GUILD_ID;
    db.ensureGuildWithDefaults(guildId);
    const categories = db.getCategories.all(guildId).map(c => ({ name: c.name, emoji: c.emoji }));
    res.json(categories);
  });

  // ── Stats ─────────────────────────────────────────────────────────────────
  router.get('/stats', requireAuth, (req, res) => {
    const guildId = process.env.DISCORD_GUILD_ID;
    db.ensureGuildWithDefaults(guildId);
    res.json(db.getStats.get(guildId));
  });

  // ── List tickets ──────────────────────────────────────────────────────────
  router.get('/tickets', requireAuth, async (req, res) => {
    const guildId = process.env.DISCORD_GUILD_ID;
    const userId  = req.user.id;
    db.ensureGuildWithDefaults(guildId);
    const isStaff = await checkStaff(discordClient, guildId, userId);
    const own     = req.query.own === 'true';
    const tickets = (isStaff && !own)
      ? db.getTicketsByGuild.all(guildId)
      : db.getTicketsByUser.all(guildId, userId);
    res.json({ tickets, isStaff });
  });

  // ── Single ticket ─────────────────────────────────────────────────────────
  router.get('/tickets/:id', requireAuth, async (req, res) => {
    const ticketId = parseInt(req.params.id, 10);
    if (isNaN(ticketId)) return res.status(400).json({ error: 'Ungültige ID' });
    const ticket = db.getTicketById.get(ticketId);
    if (!ticket) return res.status(404).json({ error: 'Ticket nicht gefunden' });

    const guildId = process.env.DISCORD_GUILD_ID;
    const userId  = req.user.id;
    const isStaff = await checkStaff(discordClient, guildId, userId);
    if (!isStaff && ticket.user_id !== userId) return res.status(403).json({ error: 'Kein Zugriff' });

    const messages = db.getMessages.all(ticketId).map(m => ({
      ...m, attachments: JSON.parse(m.attachments || '[]'),
    }));
    res.json({ ticket, messages, isStaff });
  });

  // ── Send message into a ticket from the web ─────────────────────────────────
  router.post('/tickets/:id/messages', requireAuth, async (req, res) => {
    const ticketId = parseInt(req.params.id, 10);
    if (isNaN(ticketId)) return res.status(400).json({ error: 'Ungültige ID' });
    const ticket = db.getTicketById.get(ticketId);
    if (!ticket) return res.status(404).json({ error: 'Ticket nicht gefunden' });
    if (ticket.status === 'closed') return res.status(400).json({ error: 'Ticket ist bereits geschlossen' });

    const content = req.body.content?.trim();
    if (!content) return res.status(400).json({ error: 'Nachricht darf nicht leer sein' });
    if (content.length > MAX_MESSAGE_LENGTH)
      return res.status(400).json({ error: `Nachricht zu lang (max. ${MAX_MESSAGE_LENGTH} Zeichen)` });

    const guildId = process.env.DISCORD_GUILD_ID;
    const userId  = req.user.id;
    const isStaff = await checkStaff(discordClient, guildId, userId);
    if (!isStaff && ticket.user_id !== userId) return res.status(403).json({ error: 'Kein Zugriff' });

    const avatarUrl = buildAvatarUrl(req.user);

    db.addMessage.run({
      ticket_id:   ticketId,
      user_id:     userId,
      username:    req.user.username,
      avatar_url:  avatarUrl,
      content,
      attachments: '[]',
    });

    // Relay into the Discord channel so both sides stay in sync. Sent as the bot
    // (impersonating a real user isn't possible without webhooks) with the
    // author named in the text, and mentions stripped so a ticket message can
    // never be used to ping @everyone/@here/roles/users in the channel.
    if (ticket.channel_id) {
      try {
        const channel = await discordClient.channels.fetch(ticket.channel_id).catch(() => null);
        if (channel) {
          const label  = isStaff ? '🛠️ Staff' : '🌐 Web';
          let relayed  = `**${req.user.username}** (${label}):\n${content}`;
          if (relayed.length > 2000) relayed = `${relayed.slice(0, 1997)}…`;
          await channel.send({ content: relayed, allowedMentions: { parse: [] } });
        }
      } catch (err) {
        logger.error('Web-Nachricht konnte nicht an Discord-Kanal gesendet werden:', err.message);
      }
    }

    res.json({ success: true });
  });

  // ── Change ticket category (Staff only) ─────────────────────────────────────
  router.post('/tickets/:id/category', requireAuth, async (req, res) => {
    const ticketId = parseInt(req.params.id, 10);
    if (isNaN(ticketId)) return res.status(400).json({ error: 'Ungültige ID' });
    const ticket = db.getTicketById.get(ticketId);
    if (!ticket) return res.status(404).json({ error: 'Ticket nicht gefunden' });

    const { category } = req.body;
    const guildId = process.env.DISCORD_GUILD_ID;
    if (!db.getCategoryByName.get(guildId, category)) return res.status(400).json({ error: 'Ungültige Kategorie' });

    const isStaff = await checkStaff(discordClient, guildId, req.user.id);
    if (!isStaff) return res.status(403).json({ error: 'Nur Staff kann die Kategorie ändern' });

    if (category === ticket.category) return res.json({ success: true });

    const oldCategory = ticket.category;
    db.updateTicketCategory.run(category, ticketId);

    if (ticket.channel_id) {
      try {
        const channel = await discordClient.channels.fetch(ticket.channel_id).catch(() => null);
        if (channel) {
          await channel.setTopic(
            `Ticket von ${ticket.username} | Kategorie: ${category} | ID: ${ticketId}`,
          ).catch(() => {});
          const { EmbedBuilder } = require('discord.js');
          await channel.send({ embeds: [new EmbedBuilder()
            .setTitle('🏷️ Kategorie geändert')
            .setDescription(`Von **${oldCategory}** zu **${category}**`)
            .setColor(0x5865F2)
            .setFooter({ text: `Geändert von ${req.user.username} (Web)` })
            .setTimestamp()] });
        }
      } catch (err) {
        logger.error('Kategorie-Update konnte nicht an Discord-Kanal gesendet werden:', err.message);
      }
    }

    await ticketLog.logCategoryChanged(discordClient, guildId, {
      ticket, oldCategory, newCategory: category, changedByTag: `${req.user.username} (Web)`,
    });

    res.json({ success: true });
  });

  // ── Create ticket from web ────────────────────────────────────────────────
  router.post('/tickets', requireAuth, requireGuildMember, async (req, res) => {
    const { category, subject, description } = req.body;
    if (!subject?.trim())
      return res.status(400).json({ error: 'Betreff ist erforderlich' });

    const guildId  = process.env.DISCORD_GUILD_ID;
    const userId   = req.user.id;
    const username = req.user.username;
    db.ensureGuildWithDefaults(guildId);

    if (!db.getCategoryByName.get(guildId, category))
      return res.status(400).json({ error: 'Ungültige Kategorie' });

    const existing = db.getOpenTicketByUser.get(guildId, userId);
    if (existing) return res.status(400).json({ error: 'Du hast bereits ein offenes Ticket', ticketId: existing.id });

    db.incrementTicketCount.run(guildId);
    const { ticket_count } = db.getTicketCount.get(guildId);
    const fullSubject = description?.trim()
      ? `${subject.trim()}\n\n${description.trim()}`
      : subject.trim();

    const result = db.createTicket.run({
      ticket_number: ticket_count, guild_id: guildId, channel_id: null,
      user_id: userId, username, category, subject: fullSubject,
    });
    const ticketId = result.lastInsertRowid;

    // Create Discord channel if bot is ready
    if (discordClient.isReady() && discordClient.guilds.cache.has(guildId)) {
      try {
        const { PermissionFlagsBits, ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const guild       = discordClient.guilds.cache.get(guildId);
        const guildCfg    = db.getGuild.get(guildId);
        const categoryCfg = db.getCategoryByName.get(guildId, category);

        const overwrites = [
          { id: guild.id,            deny:  [PermissionFlagsBits.ViewChannel] },
          { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] },
        ];
        if (guildCfg?.staff_role_id)
          overwrites.push({ id: guildCfg.staff_role_id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
        // Make sure a category's ping target can actually see the channel it gets pinged into
        if (categoryCfg?.ping_target_id && !overwrites.some(o => o.id === categoryCfg.ping_target_id))
          overwrites.push({ id: categoryCfg.ping_target_id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });

        const member = await guild.members.fetch(userId).catch(() => null);
        if (member && !overwrites.some(o => o.id === userId))
          overwrites.push({ id: userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });

        const channel = await guild.channels.create({
          name: `ticket-${String(ticket_count).padStart(4, '0')}`,
          type: ChannelType.GuildText,
          parent: guildCfg?.ticket_category_id ?? null,
          permissionOverwrites: overwrites,
          topic: `Ticket von ${username} | ${category} | ID: ${ticketId} | 🌐 Web`,
        });
        db.updateTicketChannel.run(channel.id, ticketId);

        const embed = new EmbedBuilder()
          .setTitle(`🎫 Ticket #${String(ticket_count).padStart(4, '0')}`)
          .setColor(0x5865F2)
          .addFields(
            { name: 'Erstellt von', value: member ? `${member}` : username, inline: true },
            { name: 'Kategorie',    value: category,                         inline: true },
            { name: 'Quelle',       value: '🌐 Web-Interface',                inline: true },
            { name: 'Betreff',      value: fullSubject,                       inline: false },
          )
          .setTimestamp().setFooter({ text: 'Via Web-Interface erstellt' });

        const pingMention = categoryNotify.buildPingMention(categoryCfg);
        const baseContent = member
          ? `${member} Dein Web-Ticket wurde erstellt. Ein Teammitglied meldet sich bald.`
          : `<@${userId}> Dein Ticket wurde erstellt.`;

        await channel.send({
          content: pingMention ? `${baseContent} ${pingMention}` : baseContent,
          embeds: [embed],
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('close_ticket').setLabel('Ticket schließen').setStyle(ButtonStyle.Danger).setEmoji('🔒')
          )],
        });

        await categoryNotify.applyCategoryExtras(discordClient, guildId, {
          categoryName: category, channel, userId,
        });

        await ticketLog.logTicketCreated(discordClient, guildId, {
          channel, username, category, source: '🌐 Web',
        });
      } catch (err) {
        logger.error('Discord channel creation error:', err.message);
      }
    }
    res.json({ success: true, ticketId });
  });

  // ── Close ticket via web ──────────────────────────────────────────────────
  router.post('/tickets/:id/close', requireAuth, async (req, res) => {
    const ticketId = parseInt(req.params.id, 10);
    if (isNaN(ticketId)) return res.status(400).json({ error: 'Ungültige ID' });
    const ticket = db.getTicketById.get(ticketId);
    if (!ticket)                    return res.status(404).json({ error: 'Ticket nicht gefunden' });
    if (ticket.status === 'closed') return res.status(400).json({ error: 'Bereits geschlossen' });

    const guildId = process.env.DISCORD_GUILD_ID;
    const userId  = req.user.id;
    const isStaff = await checkStaff(discordClient, guildId, userId);
    if (!isStaff && ticket.user_id !== userId) return res.status(403).json({ error: 'Kein Zugriff' });

    const closedByTag = `${req.user.username} (Web)`;
    db.closeTicket.run({ id: ticketId, closed_by_id: userId, closed_by_name: closedByTag });

    await ticketLog.logTicketClosed(discordClient, guildId, {
      ticket, closedByTag, source: '🌐 Web',
    });

    if (ticket.channel_id) {
      try {
        const { EmbedBuilder } = require('discord.js');
        const channel = await discordClient.channels.fetch(ticket.channel_id).catch(() => null);
        if (channel) {
          await channel.send({ embeds: [new EmbedBuilder()
            .setTitle('🔒 Ticket geschlossen (Web-Interface)')
            .setDescription(`Geschlossen von **${req.user.username}** über das Web-Interface.`)
            .setColor(0xED4245).setTimestamp()] });
          setTimeout(() => channel.delete().catch(() => {}), 5000);
        }
      } catch (_) {}
    }
    res.json({ success: true });
  });

  // ── Transcript (HTML) ─────────────────────────────────────────────────────
  router.get('/tickets/:id/transcript', requireAuth, async (req, res) => {
    const ticketId = parseInt(req.params.id, 10);
    if (isNaN(ticketId)) return res.status(400).json({ error: 'Ungültige ID' });
    const ticket = db.getTicketById.get(ticketId);
    if (!ticket) return res.status(404).json({ error: 'Ticket nicht gefunden' });

    const guildId = process.env.DISCORD_GUILD_ID;
    const isStaff = await checkStaff(discordClient, guildId, req.user.id);
    if (!isStaff && ticket.user_id !== req.user.id) return res.status(403).json({ error: 'Kein Zugriff' });

    const messages = db.getMessages.all(ticketId).map(m => ({
      ...m, attachments: JSON.parse(m.attachments || '[]'),
    }));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(generateTranscript(ticket, messages));
  });

  // ── Notes (Staff only) ────────────────────────────────────────────────────
  router.get('/tickets/:id/notes', requireAuth, async (req, res) => {
    const ticketId = parseInt(req.params.id, 10);
    if (isNaN(ticketId)) return res.status(400).json({ error: 'Ungültige ID' });
    const ticket  = db.getTicketById.get(ticketId);
    if (!ticket) return res.status(404).json({ error: 'Ticket nicht gefunden' });

    const guildId = process.env.DISCORD_GUILD_ID;
    const isStaff = await checkStaff(discordClient, guildId, req.user.id);
    if (!isStaff && ticket.user_id !== req.user.id) return res.status(403).json({ error: 'Kein Zugriff' });

    res.json(db.getNotes.all(ticketId));
  });

  router.post('/tickets/:id/notes', requireAuth, async (req, res) => {
    const ticketId = parseInt(req.params.id, 10);
    if (isNaN(ticketId)) return res.status(400).json({ error: 'Ungültige ID' });
    const ticket = db.getTicketById.get(ticketId);
    if (!ticket) return res.status(404).json({ error: 'Ticket nicht gefunden' });
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Inhalt fehlt' });

    const guildId = process.env.DISCORD_GUILD_ID;
    const isStaff = await checkStaff(discordClient, guildId, req.user.id);
    if (!isStaff) return res.status(403).json({ error: 'Nur Staff kann Notizen hinzufügen' });

    const noteContent = content.trim();
    db.addNote.run(ticketId, req.user.id, req.user.username, noteContent);

    await ticketLog.logNoteAdded(discordClient, guildId, {
      ticket, authorTag: req.user.username, content: noteContent,
    });

    res.json({ success: true });
  });

  return router;
};
