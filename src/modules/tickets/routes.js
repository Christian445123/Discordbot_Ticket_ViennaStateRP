'use strict';

// Admin-only web API: the entire /api router this mounts under already runs
// behind requireAuth + requireLicense + requireGuildAdmin (see
// src/web/guildContext.js and src/web/server.js), so every handler below can
// assume "logged in, valid license, real Discord Administrator on this
// guild" without re-checking it itself. Covers two things: category +
// automatic-message management, and a read-only ticket overview (no chat,
// no create/close/category-change from the web — that stays a Discord-side
// ticket flow, see component.js).

const express   = require('express');
const db        = require('./db');
const ticketLog = require('./ticketLog');
const guards    = require('../../core/guards');
const logger    = require('../../utils/logger');

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
  router.get('/me', async (req, res) => {
    const { id, username, discriminator } = req.user;
    const guildId = req.guildId;
    const isAdmin = guildId ? await guards.isGuildAdmin(discordClient, guildId, id) : false;
    res.json({
      id, username, discriminator,
      isAdmin,
      isSuperAdmin: guards.isSuperAdmin(id),
      avatar: buildAvatarUrl(req.user),
    });
  });

  // ── Stats ─────────────────────────────────────────────────────────────────
  router.get('/stats', async (req, res) => {
    const guildId = req.guildId;
    await db.ensureGuildWithDefaults(guildId);
    res.json(await db.getStats(guildId));
  });

  // ── Tickets: read-only overview ─────────────────────────────────────────────
  router.get('/tickets', async (req, res) => {
    const guildId = req.guildId;
    await db.ensureGuildWithDefaults(guildId);
    const tickets = await db.getTicketsByGuild(guildId);
    res.json({ tickets });
  });

  router.get('/tickets/:id', async (req, res) => {
    const ticketId = parseInt(req.params.id, 10);
    if (isNaN(ticketId)) return res.status(400).json({ error: 'Ungültige ID' });
    const ticket = await db.getTicketById(ticketId);
    if (!ticket || ticket.guild_id !== req.guildId) return res.status(404).json({ error: 'Ticket nicht gefunden' });

    const rawMessages = await db.getMessages(ticketId);
    const messages = rawMessages.map(m => ({
      ...m, attachments: JSON.parse(m.attachments || '[]'),
    }));
    res.json({ ticket, messages });
  });

  // ── Transcript (HTML) ─────────────────────────────────────────────────────
  router.get('/tickets/:id/transcript', async (req, res) => {
    const ticketId = parseInt(req.params.id, 10);
    if (isNaN(ticketId)) return res.status(400).json({ error: 'Ungültige ID' });
    const ticket = await db.getTicketById(ticketId);
    if (!ticket || ticket.guild_id !== req.guildId) return res.status(404).json({ error: 'Ticket nicht gefunden' });

    const rawMessages = await db.getMessages(ticketId);
    const messages = rawMessages.map(m => ({
      ...m, attachments: JSON.parse(m.attachments || '[]'),
    }));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(generateTranscript(ticket, messages));
  });

  // ── Notes (internal admin annotations, never posted into the Discord channel) ──
  router.get('/tickets/:id/notes', async (req, res) => {
    const ticketId = parseInt(req.params.id, 10);
    if (isNaN(ticketId)) return res.status(400).json({ error: 'Ungültige ID' });
    const ticket = await db.getTicketById(ticketId);
    if (!ticket || ticket.guild_id !== req.guildId) return res.status(404).json({ error: 'Ticket nicht gefunden' });

    res.json(await db.getNotes(ticketId));
  });

  router.post('/tickets/:id/notes', async (req, res) => {
    const ticketId = parseInt(req.params.id, 10);
    if (isNaN(ticketId)) return res.status(400).json({ error: 'Ungültige ID' });
    const ticket = await db.getTicketById(ticketId);
    if (!ticket || ticket.guild_id !== req.guildId) return res.status(404).json({ error: 'Ticket nicht gefunden' });
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Inhalt fehlt' });

    const noteContent = content.trim();
    await db.addNote(ticketId, req.user.id, req.user.username, noteContent);

    await ticketLog.logNoteAdded(discordClient, req.guildId, {
      ticket, authorTag: `${req.user.username} (Web)`, content: noteContent,
    });

    res.json({ success: true });
  });

  // ── Categories & automatic messages ─────────────────────────────────────────
  router.get('/admin/categories', async (req, res) => {
    try {
      const guildId = req.guildId;
      await db.ensureGuildWithDefaults(guildId);

      const [categories, counts] = await Promise.all([
        db.getCategories(guildId),
        db.getOpenCountsByCategory(guildId),
      ]);
      const countByName = Object.fromEntries(counts.map(c => [c.category, c.open_count]));
      res.json(categories.map(c => ({ ...c, open_count: countByName[c.name] ?? 0 })));
    } catch (err) {
      logger.error('Admin categories error:', err.message);
      res.status(500).json({ error: 'Fehler beim Laden der Kategorien' });
    }
  });

  router.post('/admin/categories', async (req, res) => {
    try {
      const guildId = req.guildId;
      const name = req.body.name?.trim();
      if (!name) return res.status(400).json({ error: 'Name ist erforderlich' });
      if (await db.getCategoryByName(guildId, name)) {
        return res.status(400).json({ error: 'Eine Kategorie mit diesem Namen existiert bereits' });
      }

      const { count } = await db.getCategoryCount(guildId);
      await db.insertCategory({
        guild_id: guildId,
        name,
        emoji:                 req.body.emoji || '🎫',
        description:           req.body.description || '',
        ping_type:             req.body.ping_target_id ? 'role' : null,
        ping_target_id:        req.body.ping_target_id || null,
        welcome_message:       req.body.welcome_message || null,
        auto_message:          req.body.auto_message || null,
        auto_message_channel:  req.body.auto_message_channel ? 1 : 0,
        auto_message_dm:       req.body.auto_message_dm ? 1 : 0,
        sort_order:            count,
      });

      await ticketLog.logCategoryConfigChanged(discordClient, guildId, {
        action: 'hinzugefügt', name, changedByTag: `${req.user.username} (Web)`,
      });
      res.json({ success: true });
    } catch (err) {
      logger.error('Admin category create error:', err.message);
      res.status(500).json({ error: 'Fehler beim Erstellen' });
    }
  });

  router.put('/admin/categories/:name', async (req, res) => {
    try {
      const guildId = req.guildId;
      const name = req.params.name;
      const existing = await db.getCategoryByName(guildId, name);
      if (!existing) return res.status(404).json({ error: 'Kategorie nicht gefunden' });

      const allowed = ['welcome_message', 'auto_message', 'auto_message_channel', 'auto_message_dm', 'description', 'emoji', 'ping_target_id'];
      const updates = {};
      for (const key of allowed) {
        if (Object.prototype.hasOwnProperty.call(req.body, key)) {
          updates[key] = req.body[key] === '' ? null : req.body[key];
        }
      }
      // ping_target_id is a role ID here (web only offers role pings, not
      // individual-user pings — that stays a /kategorie-config-only option).
      if (Object.prototype.hasOwnProperty.call(updates, 'ping_target_id')) {
        updates.ping_type = updates.ping_target_id ? 'role' : null;
      }
      if (Object.keys(updates).length === 0)
        return res.status(400).json({ error: 'Keine Felder angegeben' });

      await db.updateCategory(guildId, name, updates);
      await ticketLog.logCategoryConfigChanged(discordClient, guildId, {
        action: 'bearbeitet', name, changedByTag: `${req.user.username} (Web)`,
      });
      res.json({ success: true });
    } catch (err) {
      logger.error('Admin category update error:', err.message);
      res.status(500).json({ error: 'Fehler beim Speichern' });
    }
  });

  router.delete('/admin/categories/:name', async (req, res) => {
    try {
      const guildId = req.guildId;
      const name = req.params.name;
      const existing = await db.getCategoryByName(guildId, name);
      if (!existing) return res.status(404).json({ error: 'Kategorie nicht gefunden' });

      const { count } = await db.getCategoryCount(guildId);
      if (count <= 1) return res.status(400).json({ error: 'Die letzte verbleibende Kategorie kann nicht gelöscht werden' });

      await db.deleteCategory(guildId, name);
      await ticketLog.logCategoryConfigChanged(discordClient, guildId, {
        action: 'entfernt', name, changedByTag: `${req.user.username} (Web)`,
      });
      res.json({ success: true });
    } catch (err) {
      logger.error('Admin category delete error:', err.message);
      res.status(500).json({ error: 'Fehler beim Löschen' });
    }
  });

  // ── Guild roles (for the ping-role picker) ──────────────────────────────────
  router.get('/admin/guild-roles', async (req, res) => {
    const guild = discordClient.guilds.cache.get(req.guildId);
    if (!guild) return res.status(503).json({ error: 'Bot nicht bereit' });

    const roles = guild.roles.cache
      .filter(r => r.id !== guild.id) // exclude @everyone
      .sort((a, b) => b.position - a.position)
      .map(r => ({ id: r.id, name: r.name }));
    res.json(roles);
  });

  return router;
};
