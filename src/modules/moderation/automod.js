'use strict';

const { PermissionFlagsBits } = require('discord.js');
const db      = require('./db');
const actions = require('./actions');
const logger  = require('../../utils/logger');

const INVITE_REGEX = /(?:discord\.gg|discord(?:app)?\.com\/invite)\/[a-z0-9-]+/i;

// Administrator is always exempt (same convention used throughout this
// bot); on top of that, any number of roles can be configured in the web
// panel as exempt from automod (e.g. staff/trusted roles who legitimately
// need to say "banned" words while discussing rules, ping @everyone for
// announcements, etc.).
function isExempt(member, cfg) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;

  let exemptRoleIds;
  try { exemptRoleIds = JSON.parse(cfg.exempt_role_ids || '[]'); } catch { exemptRoleIds = []; }
  return exemptRoleIds.some(roleId => member.roles.cache.has(roleId));
}

// Per-user rolling message timestamps for the spam filter — in-memory only
// (a burst of messages loses meaning across a bot restart anyway), keyed
// by "guildId:userId" same as voiceSupport's session map convention.
const recentMessageTimestamps = new Map();

function isSpamming(guildId, userId, limit, windowSeconds) {
  const key = `${guildId}:${userId}`;
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const timestamps = (recentMessageTimestamps.get(key) || []).filter(t => now - t < windowMs);
  timestamps.push(now);
  recentMessageTimestamps.set(key, timestamps);
  return timestamps.length > limit;
}

function findBannedWord(content, wordsJson) {
  let words;
  try { words = JSON.parse(wordsJson || '[]'); } catch { words = []; }
  if (!words.length) return null;
  const lower = content.toLowerCase();
  return words.find(w => w && lower.includes(w.toLowerCase())) || null;
}

// Any message in the configured honeypot channel is treated as a bot/
// self-bot giveaway — a real human has no reason to ever post there (it's
// not linked anywhere, not part of normal navigation) — instant ban, no
// warning, no escalation, no automod checks below.
async function handleHoneypot(message, cfg) {
  if (!cfg.honeypot_channel_id || message.channel.id !== cfg.honeypot_channel_id) return false;

  await message.delete().catch(() => {});
  try {
    await actions.ban(
      message.client, message.guild, message.author,
      'Automatisch gebannt: Nachricht im Honeypot-Kanal (Verdacht auf Bot-Nutzung).',
      null, 'System (Honeypot)',
    );
    logger.info(`Moderation: ${message.author.tag} automatisch gebannt (Honeypot-Kanal, Guild ${message.guild.id}).`);
  } catch (err) {
    logger.error('Moderation: Honeypot-Bann fehlgeschlagen:', err.message);
  }
  return true;
}

// Checks @everyone/@here, banned words, invite links, mass mentions and
// spam in that order (first hit wins) — deletes the message and issues an
// automatic warning, which feeds straight into the same escalation ladder
// as a manual /mod warn (see actions.js's checkEscalation). Skipped
// entirely for exempt members (see isExempt above).
async function handleAutomod(message, cfg) {
  if (isExempt(message.member, cfg)) return;

  let violation = null;

  if (cfg.everyone_mention_enabled && message.mentions.everyone) {
    violation = '@everyone/@here-Erwähnung';
  }

  const bannedWord = !violation && findBannedWord(message.content, cfg.automod_words);
  if (bannedWord) violation = `Verbotenes Wort/Phrase erkannt ("${bannedWord}")`;

  if (!violation && cfg.invite_block_enabled && INVITE_REGEX.test(message.content)) {
    violation = 'Einladungslink zu einem anderen Discord-Server';
  }

  if (!violation && cfg.mention_enabled) {
    const mentionCount = message.mentions.users.size + message.mentions.roles.size;
    if (mentionCount > cfg.mention_limit) violation = `Massen-Erwähnung (${mentionCount} Erwähnungen in einer Nachricht)`;
  }

  if (!violation && cfg.spam_enabled) {
    if (isSpamming(message.guild.id, message.author.id, cfg.spam_message_limit, cfg.spam_window_seconds)) {
      violation = `Spam (mehr als ${cfg.spam_message_limit} Nachrichten in ${cfg.spam_window_seconds}s)`;
    }
  }

  if (!violation) return;

  await message.delete().catch(() => {});
  try {
    await actions.warn(message.client, message.guild, message.author, `Automod: ${violation}`, null, 'Automod');
  } catch (err) {
    logger.error('Moderation: Automod-Verwarnung fehlgeschlagen:', err.message);
  }
}

async function handleMessage(message) {
  if (message.author.bot || !message.guild) return;

  const cfg = await db.getConfig(message.guild.id);
  if (!cfg) return;

  // Complete activity overview (message counts, last-active) for every
  // real member — recorded for everyone, exempt or not, since this is
  // just visibility, not enforcement.
  await db.recordActivity(message.guild.id, message.author.id, message.author.tag).catch(err => {
    logger.error('Moderation: Aktivität konnte nicht erfasst werden:', err.message);
  });

  if (await handleHoneypot(message, cfg)) return;
  await handleAutomod(message, cfg);
}

module.exports = { handleMessage };
