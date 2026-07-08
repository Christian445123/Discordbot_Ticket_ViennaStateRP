'use strict';

require('dotenv').config();

const client             = require('./src/bot/bot');
const { createWebServer } = require('./src/web/server');

const PORT = parseInt(process.env.PORT ?? '3000', 10);

// ── Start web server ─────────────────────────────────────────────────────────
// Pass the Discord client so API routes can interact with Discord
const app = createWebServer(client);

app.listen(PORT, () => {
  console.log(`🌐 Web-Interface läuft auf http://localhost:${PORT}`);
});

// ── Start Discord bot ────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error('❌ Bot-Login fehlgeschlagen:', err.message);
  process.exit(1);
});

// ── Graceful shutdown ────────────────────────────────────────────────────────
process.on('SIGINT',  () => { client.destroy(); process.exit(0); });
process.on('SIGTERM', () => { client.destroy(); process.exit(0); });
