'use strict';

const { PermissionFlagsBits } = require('discord.js');
const db        = require('./db');
const actions   = require('./actions');
const ticketsDb = require('../tickets/db');
const logger    = require('../../utils/logger');

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

function parseRoleIds(json) {
  try { return JSON.parse(json || '[]'); } catch { return []; }
}

// "Team/Staff" for this purpose is the same moderator_role_ids list that
// gates /mod itself (see commands/mod.js's isModerator) — Administrator
// always counts too, same convention as everywhere else in this bot.
function isStaffMember(member, moderatorRoleIds) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return moderatorRoleIds.some(roleId => member.roles.cache.has(roleId));
}

// Catches both a direct @user ping of someone holding one of roleIds
// (message.mentions.members — already-resolved GuildMembers, more
// reliable than looking members up via guild.members.cache ourselves) and
// a ping of one of those roles itself (message.mentions.roles). Used both
// for the team-mention check (roleIds = moderator_role_ids) and the
// separate, freely configurable protected-mention check (roleIds =
// protected_mention_role_ids) below.
function mentionsAnyRole(message, roleIds) {
  if (message.mentions.roles.some(r => roleIds.includes(r.id))) return true;
  return message.mentions.members.some(m => roleIds.some(roleId => m.roles.cache.has(roleId)));
}

function findBannedWord(content, wordsJson) {
  let words;
  try { words = JSON.parse(wordsJson || '[]'); } catch { words = []; }
  if (!words.length) return null;
  const lower = content.toLowerCase();
  return words.find(w => w && lower.includes(w.toLowerCase())) || null;
}

const HONEYPOT_TIMEOUT_MINUTES = 10 * 24 * 60; // 10 Tage
const AUTOMOD_ESCALATION_TIMEOUT_MINUTES = 24 * 60; // 1 Tag

// Own fixed, staged ladder for automod-triggered violations (staff
// mentions, banned words, invites, mass mentions, spam — not honeypot,
// which already has its own separate ladder above), same idea as
// handleHoneypot: 1x Verwarnung, 2x Timeout, 3x Kick, 4x+ Bann, counted via
// automod_violation_count so it persists across leaves/rejoins and doesn't
// depend on the admin having configured moderation_escalation_rules.
async function applyAutomodEscalation(message, violation) {
  const reason = `Automod: ${violation}`;
  const count  = await db.incrementAutomodViolationCount(message.guild.id, message.author.id, message.author.tag);

  try {
    if (count === 1) {
      await actions.warn(message.client, message.guild, message.author, reason, null, 'Automod');
    } else if (count === 2) {
      await actions.timeout(message.client, message.guild, message.author, AUTOMOD_ESCALATION_TIMEOUT_MINUTES, reason, null, 'Automod');
    } else if (count === 3) {
      await actions.kick(message.client, message.guild, message.author, reason, null, 'Automod');
    } else {
      await actions.ban(message.client, message.guild, message.author, reason, null, 'Automod');
    }
  } catch (err) {
    logger.error('Moderation: Automod-Eskalation fehlgeschlagen:', err.message);
  }
}

// Any message in the configured honeypot channel is treated as a bot/
// self-bot giveaway — a real human has no reason to ever post there (it's
// not linked anywhere, not part of normal navigation). Staged response
// instead of an instant ban: 1st time → 10 Tage Timeout, 2nd time → Kick,
// 3rd time (and every time after) → Bann. The count persists per user
// across leaves/rejoins (see db.incrementHoneypotCount), so kicking and
// coming back to trip it again still escalates to a ban, not a fresh
// timeout. No warning/escalation-ladder involvement — this is its own,
// separate ladder.
async function handleHoneypot(message, cfg) {
  if (!cfg.honeypot_channel_id || message.channel.id !== cfg.honeypot_channel_id) return false;

  await message.delete().catch(() => {});

  const count  = await db.incrementHoneypotCount(message.guild.id, message.author.id, message.author.tag);
  const reason = `Verdacht auf Bot-Nutzung (Honeypot-Kanal, ${count}. Auffälligkeit).`;

  try {
    if (count === 1) {
      await actions.timeout(message.client, message.guild, message.author, HONEYPOT_TIMEOUT_MINUTES, reason, null, 'System (Honeypot)');
      logger.info(`Moderation: ${message.author.tag} automatisch in 10-Tage-Timeout versetzt (Honeypot, 1. Mal, Guild ${message.guild.id}).`);
    } else if (count === 2) {
      await actions.kick(message.client, message.guild, message.author, reason, null, 'System (Honeypot)');
      logger.info(`Moderation: ${message.author.tag} automatisch gekickt (Honeypot, 2. Mal, Guild ${message.guild.id}).`);
    } else {
      await actions.ban(message.client, message.guild, message.author, reason, null, 'System (Honeypot)');
      logger.info(`Moderation: ${message.author.tag} automatisch gebannt (Honeypot, ${count}. Mal, Guild ${message.guild.id}).`);
    }
  } catch (err) {
    logger.error('Moderation: Honeypot-Aktion fehlgeschlagen:', err.message);
  }
  return true;
}

// Checks @everyone/@here, staff mentions, banned words, invite links, mass
// mentions and spam in that order (first hit wins) — deletes the message
// and runs the staged automod escalation ladder (see
// applyAutomodEscalation above). Skipped entirely for exempt members (see
// isExempt above).
async function handleAutomod(message, cfg) {
  if (isExempt(message.member, cfg)) return;

  let violation = null;

  if (cfg.everyone_mention_enabled && message.mentions.everyone) {
    violation = '@everyone/@here-Erwähnung';
  }

  // Staff is exempt from both checks below (pinging staff/protected
  // members is normal for staff) — computed once up front either way.
  const moderatorRoleIds = parseRoleIds(cfg.moderator_role_ids);
  const authorIsStaff    = isStaffMember(message.member, moderatorRoleIds);

  // Pinging/@-mentioning team members is off-limits for anyone who isn't
  // staff themselves, and doesn't apply inside ticket channels, where
  // asking for staff by @ is the whole point of the channel (see
  // tickets/categoryNotify.js).
  if (!violation && cfg.staff_mention_block_enabled) {
    if (moderatorRoleIds.length && !authorIsStaff && mentionsAnyRole(message, moderatorRoleIds)) {
      const ticket = await ticketsDb.getTicketByChannel(message.channel.id).catch(() => null);
      if (!ticket) violation = 'Erwähnung eines Teammitglieds (nicht erlaubt)';
    }
  }

  // Separate, freely admin-configured role list (any role, not just the
  // team/moderator one above) — no enable toggle, an empty list just means
  // nothing extra is protected (see db.js's protected_mention_role_ids).
  if (!violation) {
    const protectedRoleIds = parseRoleIds(cfg.protected_mention_role_ids);
    if (protectedRoleIds.length && !authorIsStaff && mentionsAnyRole(message, protectedRoleIds)) {
      const ticket = await ticketsDb.getTicketByChannel(message.channel.id).catch(() => null);
      if (!ticket) violation = 'Erwähnung eines Mitglieds einer geschützten Rolle (nicht erlaubt)';
    }
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
  await applyAutomodEscalation(message, violation);
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
