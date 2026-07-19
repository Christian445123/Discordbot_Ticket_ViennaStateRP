'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'tickets.db'));

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS guilds (
    guild_id          TEXT PRIMARY KEY,
    ticket_category_id TEXT,
    log_channel_id    TEXT,
    staff_role_id     TEXT,
    panel_channel_id  TEXT,
    panel_message_id  TEXT,
    ticket_count      INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS categories (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id              TEXT    NOT NULL,
    name                  TEXT    NOT NULL,
    emoji                 TEXT    DEFAULT '🎫',
    description           TEXT    DEFAULT '',
    ping_type             TEXT,              -- 'role' | 'user' | NULL
    ping_target_id        TEXT,
    auto_message          TEXT,
    auto_message_channel  INTEGER DEFAULT 1,
    auto_message_dm       INTEGER DEFAULT 0,
    sort_order            INTEGER DEFAULT 0,
    UNIQUE(guild_id, name)
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_number  INTEGER NOT NULL,
    guild_id       TEXT    NOT NULL,
    channel_id     TEXT    UNIQUE,
    user_id        TEXT    NOT NULL,
    username       TEXT    NOT NULL,
    status         TEXT    DEFAULT 'open',
    category       TEXT    DEFAULT 'Allgemein',
    subject        TEXT    DEFAULT '',
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    closed_at      DATETIME,
    closed_by_id   TEXT,
    closed_by_name TEXT
  );

  CREATE TABLE IF NOT EXISTS ticket_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id   INTEGER NOT NULL,
    user_id     TEXT    NOT NULL,
    username    TEXT    NOT NULL,
    avatar_url  TEXT,
    content     TEXT,
    attachments TEXT    DEFAULT '[]',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS ticket_notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id  INTEGER NOT NULL,
    user_id    TEXT    NOT NULL,
    username   TEXT    NOT NULL,
    content    TEXT    NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
  );
`);

// Lightweight migration: add columns that didn't exist in earlier versions of
// this table, so upgrading doesn't require dropping the DB.
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
ensureColumn('guilds', 'panel_image_url',  'TEXT');
ensureColumn('guilds', 'panel_description', 'TEXT');

// ── Guild helpers ─────────────────────────────────────────────────────────────
const getGuild              = db.prepare('SELECT * FROM guilds WHERE guild_id = ?');
const ensureGuild           = db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)');
const incrementTicketCount  = db.prepare('UPDATE guilds SET ticket_count = ticket_count + 1 WHERE guild_id = ?');
const getTicketCount        = db.prepare('SELECT ticket_count FROM guilds WHERE guild_id = ?');

function updateGuild(guildId, data) {
  const fields = Object.keys(data).map(k => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE guilds SET ${fields} WHERE guild_id = @guild_id`).run({ ...data, guild_id: guildId });
}

// ── Category helpers ──────────────────────────────────────────────────────────
const DEFAULT_CATEGORIES = [
  { name: 'Support',     emoji: '🛠️' },
  { name: 'Bug-Report',  emoji: '🐛' },
  { name: 'Bewerbung',   emoji: '📋' },
  { name: 'Beschwerde',  emoji: '⚠️' },
  { name: 'Allgemein',   emoji: '💬' },
];

const getCategories     = db.prepare('SELECT * FROM categories WHERE guild_id = ? ORDER BY sort_order ASC, id ASC');
const getCategoryByName = db.prepare('SELECT * FROM categories WHERE guild_id = ? AND name = ?');
const getCategoryCount  = db.prepare('SELECT COUNT(*) AS count FROM categories WHERE guild_id = ?');
const deleteCategory    = db.prepare('DELETE FROM categories WHERE guild_id = ? AND name = ?');
const insertCategory    = db.prepare(`
  INSERT INTO categories
    (guild_id, name, emoji, description, ping_type, ping_target_id, auto_message, auto_message_channel, auto_message_dm, sort_order)
  VALUES
    (@guild_id, @name, @emoji, @description, @ping_type, @ping_target_id, @auto_message, @auto_message_channel, @auto_message_dm, @sort_order)
`);

function updateCategory(guildId, name, data) {
  const fields = Object.keys(data).map(k => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE categories SET ${fields} WHERE guild_id = @guild_id AND name = @name`)
    .run({ ...data, guild_id: guildId, name });
}

function seedDefaultCategories(guildId) {
  const { count } = getCategoryCount.get(guildId);
  if (count > 0) return;
  DEFAULT_CATEGORIES.forEach((c, i) => insertCategory.run({
    guild_id: guildId, name: c.name, emoji: c.emoji, description: '',
    ping_type: null, ping_target_id: null, auto_message: null,
    auto_message_channel: 1, auto_message_dm: 0, sort_order: i,
  }));
}

// Ensures a guild row exists AND has at least the default categories seeded —
// the single entry point every command/route should call instead of ensureGuild
// directly, so a brand-new guild always starts with a working category list.
function ensureGuildWithDefaults(guildId) {
  ensureGuild.run(guildId);
  seedDefaultCategories(guildId);
}

// ── Ticket helpers ────────────────────────────────────────────────────────────
const createTicket = db.prepare(`
  INSERT INTO tickets (ticket_number, guild_id, channel_id, user_id, username, category, subject)
  VALUES (@ticket_number, @guild_id, @channel_id, @user_id, @username, @category, @subject)
`);

const getTicketById       = db.prepare('SELECT * FROM tickets WHERE id = ?');
const getTicketByChannel  = db.prepare('SELECT * FROM tickets WHERE channel_id = ?');
const getTicketsByGuild   = db.prepare('SELECT * FROM tickets WHERE guild_id = ? ORDER BY created_at DESC');
const getTicketsByUser    = db.prepare('SELECT * FROM tickets WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC');
const getOpenTicketByUser = db.prepare('SELECT * FROM tickets WHERE guild_id = ? AND user_id = ? AND status = \'open\' LIMIT 1');
const updateTicketChannel  = db.prepare('UPDATE tickets SET channel_id = ? WHERE id = ?');
const updateTicketCategory = db.prepare('UPDATE tickets SET category = ? WHERE id = ?');

const closeTicket = db.prepare(`
  UPDATE tickets
  SET status = 'closed', closed_at = CURRENT_TIMESTAMP, closed_by_id = @closed_by_id, closed_by_name = @closed_by_name
  WHERE id = @id
`);

const getStats = db.prepare(`
  SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN status = 'open'   THEN 1 ELSE 0 END) AS open,
    SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed
  FROM tickets WHERE guild_id = ?
`);

// ── Message helpers ───────────────────────────────────────────────────────────
const addMessage  = db.prepare(`
  INSERT INTO ticket_messages (ticket_id, user_id, username, avatar_url, content, attachments)
  VALUES (@ticket_id, @user_id, @username, @avatar_url, @content, @attachments)
`);
const getMessages = db.prepare('SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC');

// ── Note helpers ──────────────────────────────────────────────────────────────
const addNote  = db.prepare('INSERT INTO ticket_notes (ticket_id, user_id, username, content) VALUES (?, ?, ?, ?)');
const getNotes = db.prepare('SELECT * FROM ticket_notes WHERE ticket_id = ? ORDER BY created_at ASC');

module.exports = {
  db,
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
