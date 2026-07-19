'use strict';

// One-time, optional migration: copies data from the old data/tickets.db
// (better-sqlite3) into the MySQL database configured in .env. Safe to run
// against a brand-new MySQL DB — it creates the schema first (same as a
// normal bot startup) and skips SQLite tables that don't exist.
//
// Usage: npm run migrate:sqlite-to-mysql
//
// Requires the "better-sqlite3" devDependency (npm install) and an existing
// data/tickets.db from a previous SQLite-based install of this bot.

require('dotenv').config();

const path = require('path');
const fs   = require('fs');

const SQLITE_PATH = path.join(__dirname, '..', 'data', 'tickets.db');

async function main() {
  if (!fs.existsSync(SQLITE_PATH)) {
    console.log(`Keine SQLite-Datenbank gefunden unter ${SQLITE_PATH} — nichts zu migrieren.`);
    return;
  }

  let Database;
  try {
    Database = require('better-sqlite3');
  } catch {
    console.error('better-sqlite3 ist nicht installiert. Führe zuerst "npm install" aus (es ist eine devDependency).');
    process.exit(1);
  }

  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  const db     = require('../src/database/db');

  console.log('Verbinde mit MySQL & lege Schema an (falls noch nicht vorhanden)…');
  await db.init();

  const pool = require('mysql2/promise').createPool({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  function tableExists(name) {
    return !!sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
  }

  async function copyTable(table, columns) {
    if (!tableExists(table)) {
      console.log(`⏭  Tabelle "${table}" existiert nicht in der SQLite-Datenbank, übersprungen.`);
      return 0;
    }
    const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
    if (!rows.length) {
      console.log(`⏭  Tabelle "${table}" ist leer, übersprungen.`);
      return 0;
    }

    const cols  = columns.filter(c => c in rows[0]);
    const placeholders = cols.map(c => `:${c}`).join(', ');
    const sql   = `INSERT IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;

    for (const row of rows) {
      const params = {};
      for (const c of cols) params[c] = row[c] ?? null;
      await pool.execute(sql, params);
    }
    console.log(`✅ ${rows.length} Zeile(n) aus "${table}" übertragen.`);
    return rows.length;
  }

  // Order matters: parents before children (foreign keys).
  await copyTable('guilds', [
    'guild_id', 'ticket_category_id', 'log_channel_id', 'staff_role_id',
    'panel_channel_id', 'panel_message_id', 'panel_image_url', 'panel_description', 'ticket_count',
  ]);
  await copyTable('categories', [
    'id', 'guild_id', 'name', 'emoji', 'description', 'ping_type', 'ping_target_id',
    'auto_message', 'auto_message_channel', 'auto_message_dm', 'sort_order',
  ]);
  await copyTable('tickets', [
    'id', 'ticket_number', 'guild_id', 'channel_id', 'user_id', 'username', 'status',
    'category', 'subject', 'created_at', 'closed_at', 'closed_by_id', 'closed_by_name',
  ]);
  await copyTable('ticket_messages', [
    'id', 'ticket_id', 'user_id', 'username', 'avatar_url', 'content', 'attachments', 'created_at',
  ]);
  await copyTable('ticket_notes', [
    'id', 'ticket_id', 'user_id', 'username', 'content', 'created_at',
  ]);

  sqlite.close();
  await pool.end();
  console.log('Migration abgeschlossen.');
}

main().catch(err => {
  console.error('Migration fehlgeschlagen:', err);
  process.exit(1);
});
