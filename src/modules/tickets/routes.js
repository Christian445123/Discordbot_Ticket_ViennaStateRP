'use strict';

// Admin-only web API: the entire /api router this mounts under already runs
// behind requireAuth + requireGuildAdmin (see src/web/guildContext.js and
// src/web/server.js), so every handler below can assume "logged in, real
// Discord Administrator on this guild" without re-checking it itself. Covers
// two things: category + automatic-message management, and a mostly
// read-only ticket overview (no chat, no close, no category change from the
// web — that stays a Discord-side ticket flow, see component.js; the one
// exception is claiming a ticket — POST /tickets/:id/claim — since every
// caller here is already a guild admin). The ticket panel (where it's
// posted) stays Discord-only too — see /setup and /panel.
//
// Every handler is wrapped in try/catch and always sends a response: Express
// does not catch rejected promises in async route handlers itself, so an
// uncaught error here would otherwise leave the browser's fetch() hanging
// forever instead of failing visibly.

const express      = require('express');
const path         = require('path');
const { execFile } = require('child_process');
const db           = require('./db');
const ticketLog    = require('./ticketLog');
const questionsMod = require('./questions');
const pingRolesMod = require('./pingRoles');
const panelBuilder = require('./panelBuilder');
const guards       = require('../../core/guards');
const logger       = require('../../utils/logger');

// Repo root (this file lives at src/modules/tickets/) — where git/npm
// commands below run, regardless of the process's actual cwd.
const REPO_ROOT = path.join(__dirname, '..', '..', '..');

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Normalizes the web form's "Max. offene Tickets pro Nutzer" input into a
// clean positive integer, or null (= unbegrenzt) for blank/zero/invalid —
// same "0 or empty means unlimited" convention as the slash command.
function sanitizeMaxOpenTickets(raw) {
  if (raw === '' || raw === null || raw === undefined) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function buildAvatarUrl(user) {
  return user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
    : `https://cdn.discordapp.com/embed/avatars/${parseInt(user.discriminator || '0', 10) % 5}.png`;
}

// "In Bearbeitung" isn't a stored status — it's status='open' with
// claimed_by_id set (see db.js/POST /tickets/:id/claim).
function ticketDisplayStatus(ticket) {
  if (ticket.status === 'closed') return 'closed';
  return ticket.claimed_by_id ? 'in_progress' : 'open';
}

const TICKET_STATUS_LABELS = { open: 'Offen', in_progress: 'In Bearbeitung', closed: 'Geschlossen' };

function generateTranscript(ticket, messages) {
  const ticketNum = String(ticket.ticket_number).padStart(3, '0');
  const displayStatus = ticketDisplayStatus(ticket);

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
.open{background:rgba(87,242,135,.15);color:#57f287}.in_progress{background:rgba(254,231,92,.15);color:#fee75c}.closed{background:rgba(150,152,157,.15);color:#96989d}
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
    ${ticket.claimed_by_name ? `<span>🖐️ Übernommen von ${escHtml(ticket.claimed_by_name)}</span>` : ''}
    <span class="badge ${displayStatus}">${TICKET_STATUS_LABELS[displayStatus]}</span>
  </div>
</div>
<div class="msgs">${msgsHtml || '<div class="empty">Keine Nachrichten vorhanden.</div>'}</div>
<div class="footer">Transkript generiert am ${new Date().toLocaleString('de-AT')} &mdash; ${messages.length} Nachrichten</div>
</div></body></html>`;
}

// Runs a fixed argv (never a shell string — no user input is ever part of
// any command below) in the repo root and resolves instead of rejecting, so
// callers can inspect { ok, stdout, stderr } without try/catch nesting.
function run(file, args = []) {
  return new Promise(resolve => {
    execFile(file, args, { cwd: REPO_ROOT, timeout: 120_000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout?.trim() || '', stderr: (stderr?.trim() || err?.message) || '' });
    });
  });
}

// Same trick as FollowerBot's webpanel: don't shell out to `pm2 restart` —
// just exit this process after the triggering response has been flushed.
// PM2's autorestart (ecosystem.config.js) brings it straight back up, with
// no dependency on the pm2 CLI being reachable from inside the app.
function scheduleSelfRestart() {
  setTimeout(() => process.exit(0), 500);
}

// Fast-forward-only pull (fails cleanly instead of clobbering local server-
// side changes, unlike a plain `git pull`), then `npm install` only if the
// dependency manifest actually changed — mirrors FollowerBot's
// _run_git_deploy() (there: requirements.txt via pip).
async function runGitDeploy() {
  const before = await run('git', ['rev-parse', 'HEAD']);
  if (!before.ok) throw new Error(before.stderr || 'git rev-parse fehlgeschlagen');

  const pull = await run('git', ['pull', '--ff-only']);
  if (!pull.ok) throw new Error(pull.stderr || pull.stdout || 'git pull fehlgeschlagen');

  const after = await run('git', ['rev-parse', 'HEAD']);
  if (!after.ok) throw new Error(after.stderr || 'git rev-parse fehlgeschlagen');

  const changed = before.stdout !== after.stdout;
  let npmInstallRan   = false;
  let npmInstallError = null;

  if (changed) {
    const diff = await run('git', ['diff', '--name-only', before.stdout, after.stdout]);
    const depsChanged = diff.ok && diff.stdout.split('\n').some(l => l.trim() === 'package.json' || l.trim() === 'package-lock.json');
    if (depsChanged) {
      const install = await run('npm', ['install']);
      if (install.ok) npmInstallRan = true;
      else npmInstallError = (install.stderr || install.stdout).slice(0, 1500);
    }
  }

  return { changed, output: pull.stdout, npmInstallRan, npmInstallError };
}

module.exports = function apiRoutes(discordClient) {
  const router = express.Router();

  // ── Current user ─────────────────────────────────────────────────────────
  router.get('/me', async (req, res) => {
    try {
      const { id, username, discriminator } = req.user;
      const guildId = req.guildId;
      const isAdmin = guildId ? await guards.isGuildAdmin(discordClient, guildId, id) : false;
      res.json({
        id, username, discriminator,
        isAdmin,
        isSuperAdmin: guards.isSuperAdmin(id),
        avatar: buildAvatarUrl(req.user),
      });
    } catch (err) {
      logger.error('/me fehlgeschlagen:', err.message);
      res.status(500).json({ error: 'Fehler beim Laden des Nutzers' });
    }
  });

  // ── Stats & workload ("Auslastung") ─────────────────────────────────────────
  // A single endpoint for both: the stat cards and the per-category workload
  // breakdown are always shown together on the Tickets tab, so one request
  // beats two round trips (and two places that could fail independently).
  router.get('/stats', async (req, res) => {
    try {
      const guildId = req.guildId;
      await db.ensureGuildWithDefaults(guildId);

      const [stats, categories, openCounts, avgResolutionMinutes] = await Promise.all([
        db.getStats(guildId),
        db.getCategories(guildId),
        db.getOpenCountsByCategory(guildId),
        db.getAvgResolutionMinutes(guildId),
      ]);
      const openByName = Object.fromEntries(openCounts.map(c => [c.category, c.open_count]));
      const byCategory = categories.map(c => ({
        name: c.name, emoji: c.emoji, open_count: openByName[c.name] ?? 0,
      }));

      res.json({ ...stats, avgResolutionMinutes, byCategory });
    } catch (err) {
      logger.error('Stats/Auslastung laden fehlgeschlagen:', err.message);
      res.status(500).json({ error: 'Statistiken konnten nicht geladen werden' });
    }
  });

  // ── Tickets: read-only overview ─────────────────────────────────────────────
  router.get('/tickets', async (req, res) => {
    try {
      const guildId = req.guildId;
      await db.ensureGuildWithDefaults(guildId);
      const tickets = await db.getTicketsByGuild(guildId);
      res.json({ tickets });
    } catch (err) {
      logger.error('Tickets laden fehlgeschlagen:', err.message);
      res.status(500).json({ error: 'Tickets konnten nicht geladen werden' });
    }
  });

  router.get('/tickets/:id', async (req, res) => {
    try {
      const ticketId = parseInt(req.params.id, 10);
      if (isNaN(ticketId)) return res.status(400).json({ error: 'Ungültige ID' });
      const ticket = await db.getTicketById(ticketId);
      if (!ticket || ticket.guild_id !== req.guildId) return res.status(404).json({ error: 'Ticket nicht gefunden' });

      const rawMessages = await db.getMessages(ticketId);
      const messages = rawMessages.map(m => ({
        ...m, attachments: JSON.parse(m.attachments || '[]'),
      }));
      res.json({ ticket, messages });
    } catch (err) {
      logger.error('Ticket laden fehlgeschlagen:', err.message);
      res.status(500).json({ error: 'Ticket konnte nicht geladen werden' });
    }
  });

  // "In Bearbeitung" from the web panel — see db.js: not a stored status,
  // just status='open' with claimed_by_id set, same as the Discord-side
  // "Übernehmen" button (component.js).
  router.post('/tickets/:id/claim', async (req, res) => {
    try {
      const ticketId = parseInt(req.params.id, 10);
      if (isNaN(ticketId)) return res.status(400).json({ error: 'Ungültige ID' });
      const ticket = await db.getTicketById(ticketId);
      if (!ticket || ticket.guild_id !== req.guildId) return res.status(404).json({ error: 'Ticket nicht gefunden' });
      if (ticket.status === 'closed') return res.status(400).json({ error: 'Ticket ist bereits geschlossen' });

      await db.claimTicket(ticketId, { claimedById: req.user.id, claimedByName: req.user.username });

      await ticketLog.logTicketClaimed(discordClient, req.guildId, {
        ticket, claimedByTag: `${req.user.username} (Web)`, source: '🖥️ Web',
      });

      res.json({ success: true });
    } catch (err) {
      logger.error('Ticket übernehmen fehlgeschlagen:', err.message);
      res.status(500).json({ error: 'Ticket konnte nicht übernommen werden' });
    }
  });

  // ── Transcript (HTML) ─────────────────────────────────────────────────────
  router.get('/tickets/:id/transcript', async (req, res) => {
    try {
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
    } catch (err) {
      logger.error('Transkript laden fehlgeschlagen:', err.message);
      res.status(500).json({ error: 'Transkript konnte nicht geladen werden' });
    }
  });

  // ── Notes (internal admin annotations, never posted into the Discord channel) ──
  router.get('/tickets/:id/notes', async (req, res) => {
    try {
      const ticketId = parseInt(req.params.id, 10);
      if (isNaN(ticketId)) return res.status(400).json({ error: 'Ungültige ID' });
      const ticket = await db.getTicketById(ticketId);
      if (!ticket || ticket.guild_id !== req.guildId) return res.status(404).json({ error: 'Ticket nicht gefunden' });

      res.json(await db.getNotes(ticketId));
    } catch (err) {
      logger.error('Notizen laden fehlgeschlagen:', err.message);
      res.status(500).json({ error: 'Notizen konnten nicht geladen werden' });
    }
  });

  router.post('/tickets/:id/notes', async (req, res) => {
    try {
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
    } catch (err) {
      logger.error('Notiz speichern fehlgeschlagen:', err.message);
      res.status(500).json({ error: 'Notiz konnte nicht gespeichert werden' });
    }
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
      res.json(categories.map(c => ({
        ...c,
        open_count:    countByName[c.name] ?? 0,
        questions:     questionsMod.parseStoredQuestions(c.questions),
        ping_role_ids: pingRolesMod.parseStoredPingRoleIds(c.ping_role_ids),
      })));
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
      const sanitizedQuestions = questionsMod.sanitizeQuestions(req.body.questions);
      const sanitizedPingRoleIds = pingRolesMod.sanitizePingRoleIds(req.body.ping_role_ids);
      await db.insertCategory({
        guild_id: guildId,
        name,
        emoji:                 req.body.emoji || '🎫',
        description:           req.body.description || '',
        ping_type:             sanitizedPingRoleIds ? 'role' : null,
        ping_target_id:        null,
        ping_role_ids:         sanitizedPingRoleIds ? JSON.stringify(sanitizedPingRoleIds) : null,
        welcome_message:       req.body.welcome_message || null,
        auto_message:          req.body.auto_message || null,
        auto_message_channel:  req.body.auto_message_channel ? 1 : 0,
        auto_message_dm:       req.body.auto_message_dm ? 1 : 0,
        questions:             sanitizedQuestions ? JSON.stringify(sanitizedQuestions) : null,
        max_open_tickets:      sanitizeMaxOpenTickets(req.body.max_open_tickets),
        sort_order:            count,
      });

      await ticketLog.logCategoryConfigChanged(discordClient, guildId, {
        action: 'hinzugefügt', name, changedByTag: `${req.user.username} (Web)`,
      });
      await panelBuilder.refreshPanel(discordClient, guildId);
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

      const allowed = ['welcome_message', 'auto_message', 'auto_message_channel', 'auto_message_dm', 'description', 'emoji'];
      const updates = {};
      for (const key of allowed) {
        if (Object.prototype.hasOwnProperty.call(req.body, key)) {
          updates[key] = req.body[key] === '' ? null : req.body[key];
        }
      }
      // ping_role_ids is an array of role IDs here (web only offers role
      // pings, not individual-user pings — that stays a /kategorie-config-only
      // option). Replaces whatever was configured before, including a legacy
      // single ping_target_id or a ping set via the slash command.
      if (Object.prototype.hasOwnProperty.call(req.body, 'ping_role_ids')) {
        const sanitizedPingRoleIds = pingRolesMod.sanitizePingRoleIds(req.body.ping_role_ids);
        updates.ping_type      = sanitizedPingRoleIds ? 'role' : null;
        updates.ping_target_id = null;
        updates.ping_role_ids  = sanitizedPingRoleIds ? JSON.stringify(sanitizedPingRoleIds) : null;
      }
      // questions is an array in the request body, not a plain string field —
      // handled separately from the generic `allowed` loop above. An empty/
      // missing array clears it back to the default Betreff/Beschreibung form.
      if (Object.prototype.hasOwnProperty.call(req.body, 'questions')) {
        const sanitizedQuestions = questionsMod.sanitizeQuestions(req.body.questions);
        updates.questions = sanitizedQuestions ? JSON.stringify(sanitizedQuestions) : null;
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'max_open_tickets')) {
        updates.max_open_tickets = sanitizeMaxOpenTickets(req.body.max_open_tickets);
      }
      if (Object.keys(updates).length === 0)
        return res.status(400).json({ error: 'Keine Felder angegeben' });

      await db.updateCategory(guildId, name, updates);
      await ticketLog.logCategoryConfigChanged(discordClient, guildId, {
        action: 'bearbeitet', name, changedByTag: `${req.user.username} (Web)`,
      });
      await panelBuilder.refreshPanel(discordClient, guildId);
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
      await panelBuilder.refreshPanel(discordClient, guildId);
      res.json({ success: true });
    } catch (err) {
      logger.error('Admin category delete error:', err.message);
      res.status(500).json({ error: 'Fehler beim Löschen' });
    }
  });

  // ── Bot deploy & restart ─────────────────────────────────────────────────────
  // Same shape as the sibling Discordbot_Follower project's webpanel: a
  // fast-forward-only git pull with a conditional npm install, and a restart
  // that just exits the process and lets PM2's autorestart bring it back —
  // no dependency on the pm2 CLI being reachable from inside the app. Affects
  // the whole bot process (every guild it serves), so every call is logged
  // both to the server log and (best-effort) to the currently selected
  // guild's log channel, on success AND failure.
  router.post('/admin/system/deploy', async (req, res) => {
    const triggeredByTag = `${req.user.username} (Web)`;
    try {
      let result;
      try {
        result = await runGitDeploy();
      } catch (err) {
        logger.error('Deploy fehlgeschlagen:', err.message);
        await ticketLog.logSystemAction(discordClient, req.guildId, {
          title: '🚀 Deploy fehlgeschlagen', description: `\`\`\`${err.message.slice(0, 1500)}\`\`\``,
          color: 0xED4245, triggeredByTag,
        });
        return res.status(500).json({ error: err.message });
      }

      logger.warn(`Deploy ausgelöst von ${triggeredByTag}. Änderungen: ${result.changed}.`);
      const restarting = result.changed && !result.npmInstallError;
      const outcome = !result.changed
        ? 'Bereits aktuell'
        : result.npmInstallError
          ? 'Änderungen geladen, npm install fehlgeschlagen — KEIN Neustart'
          : 'Neue Änderungen geladen, Bot startet neu …';
      const color = result.npmInstallError ? 0xED4245 : (result.changed ? 0xFEE75C : 0x5865F2);
      await ticketLog.logSystemAction(discordClient, req.guildId, {
        title: '🚀 Deploy (git pull) ausgeführt', description: `**Ergebnis:** ${outcome}\n\`\`\`${result.output.slice(0, 1500)}\`\`\``,
        color, triggeredByTag,
      });

      res.json({ success: true, ...result, restarting });
      if (restarting) scheduleSelfRestart();
    } catch (err) {
      logger.error('Deploy fehlgeschlagen:', err.message);
      res.status(500).json({ error: `Deploy fehlgeschlagen: ${err.message}` });
    }
  });

  router.post('/admin/system/restart', async (req, res) => {
    const triggeredByTag = `${req.user.username} (Web)`;
    try {
      logger.warn(`Neustart ausgelöst von ${triggeredByTag}.`);
      await ticketLog.logSystemAction(discordClient, req.guildId, {
        title: '♻️ Bot-Neustart angefordert', description: '', color: 0xFEE75C, triggeredByTag,
      });
      res.json({ success: true });
      scheduleSelfRestart();
    } catch (err) {
      logger.error('Neustart fehlgeschlagen:', err.message);
      res.status(500).json({ error: `Neustart fehlgeschlagen: ${err.message}` });
    }
  });

  // ── Guild roles (for the ping-role picker) ──────────────────────────────────
  router.get('/admin/guild-roles', async (req, res) => {
    try {
      const guild = discordClient.guilds.cache.get(req.guildId);
      if (!guild) return res.status(503).json({ error: 'Bot nicht bereit' });

      const roles = guild.roles.cache
        .filter(r => r.id !== guild.id) // exclude @everyone
        .sort((a, b) => b.position - a.position)
        .map(r => ({ id: r.id, name: r.name }));
      res.json(roles);
    } catch (err) {
      logger.error('Guild-Rollen laden fehlgeschlagen:', err.message);
      res.status(500).json({ error: 'Rollen konnten nicht geladen werden' });
    }
  });

  return router;
};
