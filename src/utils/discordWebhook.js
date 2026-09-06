'use strict';

// Mirrors log embeds to a globally configured webhook (see .env.example:
// DISCORD_LOG_WEBHOOK_URL / DISCORD_TICKET_LOG_WEBHOOK_URL) — a single
// destination across every guild the bot serves, independent of each
// guild's own configurable log channel (guilds.log_channel_id). Used by
// ticketLog.js so both destinations get every event without duplicating the
// embed-building logic at each call site.

const { WebhookClient } = require('discord.js');
const logger = require('./logger');

const clients = new Map();

function getClient(envVar) {
  const url = process.env[envVar];
  if (!url) return null;
  if (!clients.has(envVar)) {
    clients.set(envVar, new WebhookClient({ url }));
  }
  return clients.get(envVar);
}

// Best-effort and silent: no configured URL = no-op, and a failed send is
// logged but never thrown — this must never break the caller's own flow
// (e.g. closing a ticket in Discord shouldn't fail because a webhook 404s).
async function sendToWebhook(envVar, payload) {
  const client = getClient(envVar);
  if (!client) return;
  try {
    await client.send(payload);
  } catch (err) {
    logger.error(`Webhook (${envVar}) fehlgeschlagen:`, err.message);
  }
}

module.exports = { sendToWebhook };
