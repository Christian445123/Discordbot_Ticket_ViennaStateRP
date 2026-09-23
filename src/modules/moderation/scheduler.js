'use strict';

// Periodically un-bans anyone whose /mod tempban has expired — same
// setInterval-on-ready pattern as voiceSupport/scheduler.js.

const db      = require('./db');
const actions = require('./actions');
const logger  = require('../../utils/logger');

const CHECK_INTERVAL_MS = 60_000;

async function processExpiredTempbans(client) {
  const expired = await db.getExpiredTempbans();
  for (const row of expired) {
    const guild = client.guilds.cache.get(row.guild_id);
    if (!guild) continue;

    try {
      await guild.members.unban(row.user_id, 'Temp-Bann abgelaufen.');
      logger.info(`Moderation: Temp-Bann abgelaufen, ${row.username} in Guild ${row.guild_id} entbannt.`);
    } catch (err) {
      // Already unbanned manually, or some other permanent error — either
      // way, retrying this same row every minute forever would be worse
      // than logging it once and moving on.
      logger.error(`Moderation: Automatisches Entbannen fehlgeschlagen (Guild ${row.guild_id}, Nutzer ${row.user_id}):`, err.message);
    }

    await db.markTempbanProcessed(row.guild_id, row.case_number);
    await actions.createCase(client, row.guild_id, {
      action: 'unban', userId: row.user_id, username: row.username,
      moderatorId: null, moderatorName: 'System (Temp-Bann abgelaufen)',
      reason: `Temp-Bann (Fall #${row.case_number}) abgelaufen.`,
    });
  }
}

let intervalHandle = null;

function start(client) {
  if (intervalHandle) return;
  processExpiredTempbans(client).catch(err => logger.error('Moderation: Tempban-Check fehlgeschlagen:', err.message));
  intervalHandle = setInterval(() => {
    processExpiredTempbans(client).catch(err => logger.error('Moderation: Tempban-Check fehlgeschlagen:', err.message));
  }, CHECK_INTERVAL_MS);
}

module.exports = { start };
