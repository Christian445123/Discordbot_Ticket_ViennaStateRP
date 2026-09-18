'use strict';

const core = require('../../core/db');

async function query(sql, params) {
  return core.query(sql, params);
}

// ── Schema (auto-created on startup, safe to run every time) ────────────────
async function initSchema(p) {
  await p.query(`
    CREATE TABLE IF NOT EXISTS voice_support_guilds (
      guild_id           VARCHAR(32) PRIMARY KEY,
      waiting_channel_id VARCHAR(32),
      notify_channel_id  VARCHAR(32),
      staff_role_id      VARCHAR(32),
      manual_override    VARCHAR(10) DEFAULT NULL,
      ticket_category    VARCHAR(80) DEFAULT NULL,
      test_mode          TINYINT(1) DEFAULT 0
    ) ENGINE=InnoDB
  `);
  // Migrations: add columns introduced after the initial release
  await p.query(`ALTER TABLE voice_support_guilds ADD COLUMN IF NOT EXISTS manual_closed TINYINT(1) DEFAULT 0`).catch(() => {});
  await p.query(`ALTER TABLE voice_support_guilds ADD COLUMN IF NOT EXISTS manual_override VARCHAR(10) DEFAULT NULL`).catch(() => {});
  await p.query(`ALTER TABLE voice_support_guilds ADD COLUMN IF NOT EXISTS ticket_category VARCHAR(80) DEFAULT NULL`).catch(() => {});
  await p.query(`ALTER TABLE voice_support_guilds ADD COLUMN IF NOT EXISTS test_mode TINYINT(1) DEFAULT 0`).catch(() => {});
  await p.query(`ALTER TABLE voice_support_guilds ADD COLUMN IF NOT EXISTS manual_override_set_at DATETIME DEFAULT NULL`).catch(() => {});
  // manual_closed (plain boolean) is superseded by the tri-state
  // manual_override ('open' | 'closed' | NULL = automatisch nach Zeitplan) —
  // carry forward anyone who already had it set to true, one-time only
  // (the WHERE guards against re-running this on every boot).
  await p.query(`
    UPDATE voice_support_guilds SET manual_override = 'closed'
    WHERE manual_closed = 1 AND manual_override IS NULL
  `).catch(() => {});
  // Backfill a timestamp for rows that already had a manual override set
  // before this column existed, so the 30-minute auto-revert (see
  // scheduler.isOpen) has something to measure against instead of never
  // expiring for them. One-time per row (WHERE guards re-running).
  await p.query(`
    UPDATE voice_support_guilds SET manual_override_set_at = NOW()
    WHERE manual_override IS NOT NULL AND manual_override_set_at IS NULL
  `).catch(() => {});

  // One row per configured weekday (0=Sonntag..6=Samstag, JS Date.getDay()
  // convention) — a missing row, or enabled=0, means "geschlossen" that day.
  await p.query(`
    CREATE TABLE IF NOT EXISTS voice_support_hours (
      guild_id   VARCHAR(32) NOT NULL,
      weekday    TINYINT NOT NULL,
      enabled    TINYINT(1) DEFAULT 0,
      start_time VARCHAR(5),
      end_time   VARCHAR(5),
      PRIMARY KEY (guild_id, weekday)
    ) ENGINE=InnoDB
  `);
}

async function ensureGuild(guildId) {
  await query('INSERT IGNORE INTO voice_support_guilds (guild_id) VALUES (:guildId)', { guildId });
}

async function getConfig(guildId) {
  const rows = await query('SELECT * FROM voice_support_guilds WHERE guild_id = :guildId', { guildId });
  return rows[0];
}

async function getAllConfigs() {
  return query("SELECT * FROM voice_support_guilds WHERE waiting_channel_id IS NOT NULL");
}

async function updateConfig(guildId, data) {
  // Whenever manual_override is (re)written, stamp/clear when it happened
  // alongside it, so callers never have to remember to do this separately —
  // scheduler.isOpen relies on this timestamp to auto-revert after 30min.
  if (Object.prototype.hasOwnProperty.call(data, 'manual_override')) {
    data = { ...data, manual_override_set_at: data.manual_override ? new Date() : null };
  }
  const fields = Object.keys(data).map(k => `${k} = :${k}`).join(', ');
  await query(`UPDATE voice_support_guilds SET ${fields} WHERE guild_id = :guild_id`, { ...data, guild_id: guildId });
}

// ── Support hours ─────────────────────────────────────────────────────────────
async function getHours(guildId) {
  return query('SELECT * FROM voice_support_hours WHERE guild_id = :guildId', { guildId });
}

// Replaces all 7 weekday rows at once — the web panel/setup always sends
// the full week, so a delete+reinsert is simpler and just as safe as a
// per-row upsert here (the table is tiny and edited rarely).
async function setHours(guildId, days) {
  await query('DELETE FROM voice_support_hours WHERE guild_id = :guildId', { guildId });
  for (const day of days) {
    await query(`
      INSERT INTO voice_support_hours (guild_id, weekday, enabled, start_time, end_time)
      VALUES (:guildId, :weekday, :enabled, :startTime, :endTime)
    `, {
      guildId,
      weekday:   day.weekday,
      enabled:   day.enabled ? 1 : 0,
      startTime: day.start_time || null,
      endTime:   day.end_time || null,
    });
  }
}

module.exports = {
  initSchema, ensureGuild, getConfig, getAllConfigs, updateConfig, getHours, setHours,
};
