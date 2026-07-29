'use strict';

const mysql = require('mysql2/promise');

let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host:               process.env.DB_HOST,
      port:               Number(process.env.DB_PORT) || 3306,
      user:               process.env.DB_USER,
      password:           process.env.DB_PASSWORD,
      database:           process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit:    10,
      namedPlaceholders:  true,
    });
  }
  return pool;
}

async function query(sql, params) {
  const [result] = await getPool().execute(sql, params);
  return result;
}

// ── Schema (auto-created on startup, safe to run every time) ────────────────
async function init() {
  const p = getPool();

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
      sort_order            INT DEFAULT 0,
      UNIQUE KEY uniq_guild_category (guild_id, name)
    ) ENGINE=InnoDB
  `);
  // Migration: add welcome_message to existing tables
  await p.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS welcome_message TEXT DEFAULT NULL`).catch(() => {});

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
  { name: 'Support',     emoji: '🛠️' },
  { name: 'Bug-Report',  emoji: '🐛' },
  { name: 'Bewerbung',   emoji: '📋' },
  { name: 'Beschwerde',  emoji: '⚠️' },
  { name: 'Allgemein',   emoji: '💬' },
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

async function insertCategory(data) {
  await query(`
    INSERT INTO categories
      (guild_id, name, emoji, description, ping_type, ping_target_id, welcome_message, auto_message, auto_message_channel, auto_message_dm, sort_order)
    VALUES
      (:guild_id, :name, :emoji, :description, :ping_type, :ping_target_id, :welcome_message, :auto_message, :auto_message_channel, :auto_message_dm, :sort_order)
  `, data);
}

async function updateCategory(guildId, name, data) {
  const fields = Object.keys(data).map(k => `${k} = :${k}`).join(', ');
  await query(`UPDATE categories SET ${fields} WHERE guild_id = :guild_id AND name = :name`, { ...data, guild_id: guildId, name });
}

async function deleteCategory(guildId, name) {
  await query('DELETE FROM categories WHERE guild_id = :guildId AND name = :name', { guildId, name });
}

async function seedDefaultCategories(guildId) {
  const { count } = await getCategoryCount(guildId);
  if (count > 0) return;
  for (const [i, c] of DEFAULT_CATEGORIES.entries()) {
    await insertCategory({
      guild_id: guildId, name: c.name, emoji: c.emoji, description: '',
      ping_type: null, ping_target_id: null, welcome_message: null, auto_message: null,
      auto_message_channel: 1, auto_message_dm: 0, sort_order: i,
    });
  }
}

// Ensures a guild row exists AND has at least the default categories seeded —
// the single entry point every command/route should call instead of ensureGuild
// directly, so a brand-new guild always starts with a working category list.
async function ensureGuildWithDefaults(guildId) {
  await ensureGuild(guildId);
  await seedDefaultCategories(guildId);
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

async function getTicketsByUser(guildId, userId) {
  return query('SELECT * FROM tickets WHERE guild_id = :guildId AND user_id = :userId ORDER BY created_at DESC', { guildId, userId });
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
  init,
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
  createTicket,
  getTicketById,
  getTicketByChannel,
  getTicketsByGuild,
  getTicketsByUser,
  getOpenTicketByUser,
  updateTicketChannel,
  updateTicketCategory,
  closeTicket,
  getStats,
  addMessage,
  getMessages,
  addNote,
  getNotes,
};
