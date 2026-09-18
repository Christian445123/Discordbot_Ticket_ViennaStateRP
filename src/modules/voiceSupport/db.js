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
      staff_role_id      VARCHAR(32)
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

async function updateConfig(guildId, data) {
  const fields = Object.keys(data).map(k => `${k} = :${k}`).join(', ');
  await query(`UPDATE voice_support_guilds SET ${fields} WHERE guild_id = :guild_id`, { ...data, guild_id: guildId });
}

module.exports = { initSchema, ensureGuild, getConfig, updateConfig };
