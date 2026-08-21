'use strict';

const core = require('../../core/db');
const { ensureWelcomeMessage, ensureAutoMessage } = require('./messageTemplates');

async function query(sql, params) {
  return core.query(sql, params);
}

// ── Schema (auto-created on startup, safe to run every time) ────────────────
async function initSchema(p) {

  await p.query(`
    CREATE TABLE IF NOT EXISTS guilds (
      guild_id           VARCHAR(32) PRIMARY KEY,
      ticket_category_id VARCHAR(32),
      log_channel_id     VARCHAR(32),
      staff_role_id      VARCHAR(32),
      panel_channel_id   VARCHAR(32),
      panel_message_id   VARCHAR(32),
      panel_image_url    TEXT,
      panel_description  TEXT,
      ticket_count       INT DEFAULT 0
    ) ENGINE=InnoDB
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id                    INT AUTO_INCREMENT PRIMARY KEY,
      guild_id              VARCHAR(32) NOT NULL,
      name                  VARCHAR(80) NOT NULL,
      emoji                 VARCHAR(16) DEFAULT '🎫',
      description           VARCHAR(255) DEFAULT '',
      ping_type             VARCHAR(10),
      ping_target_id        VARCHAR(32),
      welcome_message       TEXT,
      auto_message          TEXT,
      auto_message_channel  TINYINT(1) DEFAULT 1,
      auto_message_dm       TINYINT(1) DEFAULT 0,
      questions             TEXT,
      sort_order            INT DEFAULT 0,
      UNIQUE KEY uniq_guild_category (guild_id, name)
    ) ENGINE=InnoDB
  `);
  // Migrations: add columns introduced after the initial release
  await p.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS welcome_message TEXT DEFAULT NULL`).catch(() => {});
  await p.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS questions TEXT DEFAULT NULL`).catch(() => {});

  await p.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      ticket_number  INT NOT NULL,
      guild_id       VARCHAR(32) NOT NULL,
      channel_id     VARCHAR(32) UNIQUE,
      user_id        VARCHAR(32) NOT NULL,
      username       VARCHAR(150) NOT NULL,
      status         VARCHAR(20) DEFAULT 'open',
      category       VARCHAR(80) DEFAULT 'Allgemein',
      subject        TEXT,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      closed_at      DATETIME NULL,
      closed_by_id   VARCHAR(32),
      closed_by_name VARCHAR(150)
    ) ENGINE=InnoDB
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS ticket_messages (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      ticket_id   INT NOT NULL,
      user_id     VARCHAR(32) NOT NULL,
      username    VARCHAR(150) NOT NULL,
      avatar_url  TEXT,
      content     TEXT,
      attachments TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS ticket_notes (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      ticket_id  INT NOT NULL,
      user_id    VARCHAR(32) NOT NULL,
      username   VARCHAR(150) NOT NULL,
      content    TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
}

// ── Guild helpers ─────────────────────────────────────────────────────────────
async function getGuild(guildId) {
  const rows = await query('SELECT * FROM guilds WHERE guild_id = :guildId', { guildId });
  return rows[0];
}

async function ensureGuild(guildId) {
  await query('INSERT IGNORE INTO guilds (guild_id) VALUES (:guildId)', { guildId });
}

async function incrementTicketCount(guildId) {
  await query('UPDATE guilds SET ticket_count = ticket_count + 1 WHERE guild_id = :guildId', { guildId });
}

async function getTicketCount(guildId) {
  const rows = await query('SELECT ticket_count FROM guilds WHERE guild_id = :guildId', { guildId });
  return rows[0];
}

async function updateGuild(guildId, data) {
  const fields = Object.keys(data).map(k => `${k} = :${k}`).join(', ');
  await query(`UPDATE guilds SET ${fields} WHERE guild_id = :guild_id`, { ...data, guild_id: guildId });
}

// ── Category helpers ──────────────────────────────────────────────────────────
const DEFAULT_CATEGORIES = [
  { name: 'Support',     emoji: '🛠️', description: 'Allgemeine Fragen und Hilfe bei Problemen' },
  { name: 'Bug-Report',  emoji: '🐛', description: 'Einen Fehler oder Bug melden' },
  { name: 'Bewerbung',   emoji: '📋', description: 'Bewerbung fürs Team einreichen' },
  { name: 'Beschwerde',  emoji: '⚠️', description: 'Eine Beschwerde oder ein Anliegen melden' },
  { name: 'Allgemein',   emoji: '💬', description: 'Sonstige Anliegen, die nirgendwo anders reinpassen' },
];

async function getCategories(guildId) {
  return query('SELECT * FROM categories WHERE guild_id = :guildId ORDER BY sort_order ASC, id ASC', { guildId });
}

async function getCategoryByName(guildId, name) {
  const rows = await query('SELECT * FROM categories WHERE guild_id = :guildId AND name = :name', { guildId, name });
  return rows[0];
}

async function getCategoryCount(guildId) {
  const rows = await query('SELECT COUNT(*) AS count FROM categories WHERE guild_id = :guildId', { guildId });
  return rows[0];
}

// Fills in every column explicitly (rather than trusting the caller to pass
// them all) so every insert point — command, web route, default seeding —
// automatically gets non-empty welcome/auto messages without duplicating
// that logic, and named placeholders never end up missing a value.
async function insertCategory(data) {
  const payload = {
    guild_id:              data.guild_id,
    name:                  data.name,
    emoji:                 data.emoji ?? '🎫',
    description:           data.description ?? '',
    ping_type:             data.ping_type ?? null,
    ping_target_id:        data.ping_target_id ?? null,
    welcome_message:       ensureWelcomeMessage(data.name, data.welcome_message),
    auto_message:          ensureAutoMessage(data.name, data.auto_message),
    auto_message_channel:  data.auto_message_channel ?? 1,
    auto_message_dm:       data.auto_message_dm ?? 0,
    questions:             data.questions ?? null,
    sort_order:            data.sort_order ?? 0,
  };
  await query(`
    INSERT INTO categories
      (guild_id, name, emoji, description, ping_type, ping_target_id, welcome_message, auto_message, auto_message_channel, auto_message_dm, questions, sort_order)
    VALUES
      (:guild_id, :name, :emoji, :description, :ping_type, :ping_target_id, :welcome_message, :auto_message, :auto_message_channel, :auto_message_dm, :questions, :sort_order)
  `, payload);
}

// Clearing welcome_message/auto_message back to empty regenerates the
// category's default text instead of leaving it blank — every category is
// meant to always have both.
async function updateCategory(guildId, name, data) {
  const updates = { ...data };
  if (Object.prototype.hasOwnProperty.call(updates, 'welcome_message')) {
    updates.welcome_message = ensureWelcomeMessage(name, updates.welcome_message);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'auto_message')) {
    updates.auto_message = ensureAutoMessage(name, updates.auto_message);
  }
  const fields = Object.keys(updates).map(k => `${k} = :${k}`).join(', ');
  await query(`UPDATE categories SET ${fields} WHERE guild_id = :guild_id AND name = :name`, { ...updates, guild_id: guildId, name });
}

async function deleteCategory(guildId, name) {
  await query('DELETE FROM categories WHERE guild_id = :guildId AND name = :name', { guildId, name });
}

// Open-ticket count per category — the raw numbers the "Auslastung" (load)
// indicator on the admin dashboard is computed from (each category's share
// of the guild's total currently-open tickets).
async function getOpenCountsByCategory(guildId) {
  return query(
    "SELECT category, COUNT(*) AS open_count FROM tickets WHERE guild_id = :guildId AND status = 'open' GROUP BY category",
    { guildId },
  );
}

async function seedDefaultCategories(guildId) {
  const { count } = await getCategoryCount(guildId);
  if (count > 0) return;
  for (const [i, c] of DEFAULT_CATEGORIES.entries()) {
    await insertCategory({ guild_id: guildId, name: c.name, emoji: c.emoji, description: c.description, sort_order: i });
  }
}

// Guilds created before welcome/auto messages became mandatory (or a
// category that had its text explicitly cleared) can still have NULL
// columns — top up any category still missing either one with a generated
// default, same as insertCategory/updateCategory do for new writes. Default
// categories (matched by name) that predate auto-generated descriptions get
// their description filled in the same way.
async function backfillCategoryDefaults(guildId) {
  const defaultDescriptionByName = new Map(DEFAULT_CATEGORIES.map(c => [c.name, c.description]));
  const categories = await getCategories(guildId);
  for (const c of categories) {
    const updates = {};
    if (!c.welcome_message) updates.welcome_message = null;
    if (!c.auto_message)    updates.auto_message    = null;
    if (!c.description && defaultDescriptionByName.has(c.name)) {
      updates.description = defaultDescriptionByName.get(c.name);
    }
    if (Object.keys(updates).length) await updateCategory(guildId, c.name, updates);
  }
}

// Ensures a guild row exists AND has at least the default categories seeded —
// the single entry point every command/route should call instead of ensureGuild
// directly, so a brand-new guild always starts with a working category list.
async function ensureGuildWithDefaults(guildId) {
  await ensureGuild(guildId);
  await seedDefaultCategories(guildId);
  await backfillCategoryDefaults(guildId);
}

// ── Ticket helpers ────────────────────────────────────────────────────────────
async function createTicket(data) {
  const result = await query(`
    INSERT INTO tickets (ticket_number, guild_id, channel_id, user_id, username, category, subject)
    VALUES (:ticket_number, :guild_id, :channel_id, :user_id, :username, :category, :subject)
  `, data);
  return { lastInsertRowid: result.insertId };
}

async function getTicketById(id) {
  const rows = await query('SELECT * FROM tickets WHERE id = :id', { id });
  return rows[0];
}

async function getTicketByChannel(channelId) {
  const rows = await query('SELECT * FROM tickets WHERE channel_id = :channelId', { channelId });
  return rows[0];
}

async function getTicketsByGuild(guildId) {
  return query('SELECT * FROM tickets WHERE guild_id = :guildId ORDER BY created_at DESC', { guildId });
}

async function getOpenTicketByUser(guildId, userId) {
  const rows = await query(
    "SELECT * FROM tickets WHERE guild_id = :guildId AND user_id = :userId AND status = 'open' LIMIT 1",
    { guildId, userId },
  );
  return rows[0];
}

async function updateTicketChannel(channelId, ticketId) {
  await query('UPDATE tickets SET channel_id = :channelId WHERE id = :ticketId', { channelId, ticketId });
}

async function updateTicketCategory(category, ticketId) {
  await query('UPDATE tickets SET category = :category WHERE id = :ticketId', { category, ticketId });
}

async function closeTicket(data) {
  await query(`
    UPDATE tickets
    SET status = 'closed', closed_at = CURRENT_TIMESTAMP, closed_by_id = :closed_by_id, closed_by_name = :closed_by_name
    WHERE id = :id
  `, data);
}

async function getStats(guildId) {
  const rows = await query(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'open'   THEN 1 ELSE 0 END) AS open,
      SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed
    FROM tickets WHERE guild_id = :guildId
  `, { guildId });
  return rows[0];
}

// Average time-to-close across every closed ticket — the headline number
// on the admin dashboard's global "Auslastung" (workload) overview.
async function getAvgResolutionMinutes(guildId) {
  const rows = await query(`
    SELECT AVG(TIMESTAMPDIFF(MINUTE, created_at, closed_at)) AS avg_minutes
    FROM tickets WHERE guild_id = :guildId AND status = 'closed' AND closed_at IS NOT NULL
  `, { guildId });
  const avg = rows[0]?.avg_minutes;
  return avg != null ? Math.round(avg) : null;
}

// ── Message helpers ───────────────────────────────────────────────────────────
async function addMessage(data) {
  await query(`
    INSERT INTO ticket_messages (ticket_id, user_id, username, avatar_url, content, attachments)
    VALUES (:ticket_id, :user_id, :username, :avatar_url, :content, :attachments)
  `, data);
}

async function getMessages(ticketId) {
  return query('SELECT * FROM ticket_messages WHERE ticket_id = :ticketId ORDER BY created_at ASC', { ticketId });
}

// ── Note helpers ──────────────────────────────────────────────────────────────
async function addNote(ticketId, userId, username, content) {
  await query(
    'INSERT INTO ticket_notes (ticket_id, user_id, username, content) VALUES (:ticketId, :userId, :username, :content)',
    { ticketId, userId, username, content },
  );
}

async function getNotes(ticketId) {
  return query('SELECT * FROM ticket_notes WHERE ticket_id = :ticketId ORDER BY created_at ASC', { ticketId });
}

module.exports = {
  initSchema,
  getGuild,
  ensureGuild,
  ensureGuildWithDefaults,
  incrementTicketCount,
  getTicketCount,
  updateGuild,
  getCategories,
  getCategoryByName,
  getCategoryCount,
  insertCategory,
  updateCategory,
  deleteCategory,
  getOpenCountsByCategory,
  createTicket,
  getTicketById,
  getTicketByChannel,
  getTicketsByGuild,
  getOpenTicketByUser,
  updateTicketChannel,
  updateTicketCategory,
  closeTicket,
  getStats,
  getAvgResolutionMinutes,
  addMessage,
  getMessages,
  addNote,
  getNotes,
};
