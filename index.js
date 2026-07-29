'use strict';

require('dotenv').config();

const db                  = require('./src/core/db');
const { createClient }    = require('./src/core/client');
const licenseService      = require('./src/core/license/licenseService');
const { createWebServer } = require('./src/web/server');
const logger              = require('./src/utils/logger');

const PORT   = parseInt(process.env.PORT ?? '3000', 10);
const client = createClient();

(async () => {
  // ── Connect to the database & auto-create the schema ────────────────────────
  try {
    await db.init();
    logger.info('✅ Datenbankverbindung hergestellt & Schema geprüft.');
  } catch (err) {
    logger.error('❌ Datenbankverbindung fehlgeschlagen:', err.message);
    process.exit(1);
  }

  // ── License bootstrap (idempotent: seeds a license for the guild already
  // configured via DISCORD_GUILD_ID so an existing deployment isn't locked
  // out the moment license enforcement goes live) ─────────────────────────────
  await licenseService.bootstrap().catch(err => logger.error('Lizenz-Bootstrap fehlgeschlagen:', err.message));

  // ── Start web server ────────────────────────────────────────────────────────
  // Pass the Discord client so API routes can interact with Discord
  const app = createWebServer(client);

  app.listen(PORT, () => {
    logger.info(`🌐 Web-Interface läuft auf http://localhost:${PORT}`);
  });

  // ── Start Discord bot ───────────────────────────────────────────────────────
  client.login(process.env.DISCORD_TOKEN).catch(err => {
    logger.error('❌ Bot-Login fehlgeschlagen:', err.message);
    process.exit(1);
  });
})();

// ── Graceful shutdown ────────────────────────────────────────────────────────
process.on('SIGINT',  () => { client.destroy(); process.exit(0); });
process.on('SIGTERM', () => { client.destroy(); process.exit(0); });

// ── Safety net for unlogged crashes ─────────────────────────────────────────
// Promise rejections are usually recoverable (e.g. a failed Discord API call) — log and continue.
process.on('unhandledRejection', err => logger.error('Unhandled Rejection:', err));

// An uncaught exception leaves the process in an undefined state (Node docs:
// "unsafe to resume normal operation"). Logging without exiting means PM2 never
// sees the process die, so it never restarts it — the bot just hangs silently
// with no further log output. Log it, then exit so PM2 restarts cleanly.
process.on('uncaughtException', err => {
  logger.error('Uncaught Exception, restarting process:', err);
  process.exit(1);
});
