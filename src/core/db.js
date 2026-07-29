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

// Guilds the bot has ever seen, independent of any single feature module —
// license/moderation/team all need "this guild exists" without depending on
// the tickets module owning that concept the way the old single-table
// schema did.
async function initCoreSchema() {
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS core_guilds (
      guild_id      VARCHAR(32) PRIMARY KEY,
      first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);
}

async function ensureCoreGuild(guildId) {
  await query('INSERT IGNORE INTO core_guilds (guild_id) VALUES (:guildId)', { guildId });
}

// Connects, verifies the core schema, then lets every discovered module
// create its own tables (CREATE TABLE IF NOT EXISTS, safe to run every
// start). Called once at startup from index.js.
async function init() {
  getPool();
  await initCoreSchema();
  const moduleLoader = require('./moduleLoader');
  await moduleLoader.initModuleSchemas(getPool());
}

module.exports = { getPool, query, init, ensureCoreGuild };
