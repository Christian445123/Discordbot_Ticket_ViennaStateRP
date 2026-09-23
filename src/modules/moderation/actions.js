'use strict';

// Every moderation action (manual, via /mod, or automatic, via automod.js/
// escalation) funnels through here: perform the Discord API call, write a
// case row, log it to the mod-log channel — one place, so every surface
// (commands, automod, honeypot, escalation, the tempban scheduler) behaves
// identically and shows up in the same log/case history.

const { EmbedBuilder } = require('discord.js');
const db     = require('./db');
const logger = require('../../utils/logger');

const ACTION_LABELS = {
  warn:        '⚠️ Verwarnung',
  kick:        '👢 Kick',
  ban:         '🔨 Bann',
  tempban:     '⏳ Temp-Bann',
  unban:       '🔓 Entbannt',
  timeout:     '🔇 Timeout',
  untimeout:   '🔊 Timeout aufgehoben',
};

const ACTION_COLORS = {
  warn: 0xFEE75C, kick: 0xE67E22, ban: 0xED4245, tempban: 0xED4245,
  unban: 0x57F287, timeout: 0xE67E22, untimeout: 0x57F287,
};

function formatDuration(minutes) {
  if (minutes == null) return null;
  if (minutes < 60) return `${minutes} Min.`;
  if (minutes < 1440) return `${Math.round((minutes / 60) * 10) / 10} Std.`;
  return `${Math.round((minutes / 1440) * 10) / 10} Tag(e)`;
}

async function logCase(client, guildId, caseRow) {
  try {
    const cfg = await db.getConfig(guildId);
    if (!cfg?.log_channel_id) return;
    const channel = client.channels.cache.get(cfg.log_channel_id)
      ?? await client.channels.fetch(cfg.log_channel_id).catch(() => null);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setTitle(`${ACTION_LABELS[caseRow.action] || caseRow.action} — Fall #${caseRow.case_number}`)
      .setColor(ACTION_COLORS[caseRow.action] ?? 0x5865F2)
      .addFields(
        { name: 'Nutzer',     value: `<@${caseRow.user_id}> (${caseRow.username})`, inline: true },
        { name: 'Moderator',  value: caseRow.moderator_id ? `<@${caseRow.moderator_id}>` : caseRow.moderator_name, inline: true },
      )
      .setTimestamp();

    if (caseRow.duration_minutes) {
      embed.addFields({ name: 'Dauer', value: formatDuration(caseRow.duration_minutes), inline: true });
    }
    embed.addFields({ name: 'Grund', value: caseRow.reason || '—', inline: false });

    await channel.send({ embeds: [embed] });
  } catch (err) {
    logger.error('Moderation: Fall konnte nicht geloggt werden:', err.message);
  }
}

async function createCase(client, guildId, data) {
  const caseNumber = await db.nextCaseNumber(guildId);
  await db.insertCase({ ...data, guildId, caseNumber });
  const caseRow = {
    case_number:      caseNumber,
    action:           data.action,
    user_id:          data.userId,
    username:         data.username,
    moderator_id:     data.moderatorId ?? null,
    moderator_name:   data.moderatorName,
    reason:           data.reason ?? null,
    duration_minutes: data.durationMinutes ?? null,
  };
  await logCase(client, guildId, caseRow);
  return caseRow;
}

async function kick(client, guild, user, reason, moderatorId, moderatorName) {
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) throw new Error('Nutzer ist kein Mitglied dieses Servers.');
  await member.kick(reason || undefined);
  return createCase(client, guild.id, { action: 'kick', userId: user.id, username: user.tag, moderatorId, moderatorName, reason });
}

async function ban(client, guild, user, reason, moderatorId, moderatorName, deleteMessageSeconds = 0) {
  await guild.members.ban(user.id, { reason: reason || undefined, deleteMessageSeconds });
  return createCase(client, guild.id, { action: 'ban', userId: user.id, username: user.tag, moderatorId, moderatorName, reason });
}

async function tempban(client, guild, user, reason, moderatorId, moderatorName, durationMinutes, deleteMessageSeconds = 0) {
  await guild.members.ban(user.id, { reason: reason || undefined, deleteMessageSeconds });
  const expiresAt = new Date(Date.now() + durationMinutes * 60_000);
  return createCase(client, guild.id, {
    action: 'tempban', userId: user.id, username: user.tag, moderatorId, moderatorName, reason,
    durationMinutes, expiresAt,
  });
}

async function unban(client, guild, userId, username, reason, moderatorId, moderatorName) {
  await guild.members.unban(userId, reason || undefined);
  return createCase(client, guild.id, { action: 'unban', userId, username: username || userId, moderatorId, moderatorName, reason });
}

async function timeout(client, guild, user, durationMinutes, reason, moderatorId, moderatorName) {
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) throw new Error('Nutzer ist kein Mitglied dieses Servers.');
  await member.timeout(durationMinutes * 60_000, reason || undefined);
  return createCase(client, guild.id, { action: 'timeout', userId: user.id, username: user.tag, moderatorId, moderatorName, reason, durationMinutes });
}

async function untimeout(client, guild, user, reason, moderatorId, moderatorName) {
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) throw new Error('Nutzer ist kein Mitglied dieses Servers.');
  await member.timeout(null, reason || undefined);
  return createCase(client, guild.id, { action: 'untimeout', userId: user.id, username: user.tag, moderatorId, moderatorName, reason });
}

// The "wenn X dann Y" engine: after every warn, check whether the user's
// active warn count exactly matches a configured threshold, and if so
// apply that rule's action automatically (itself creating + logging its
// own case) — chained straight off the warn that triggered it. Exact
// match (not >=) so a rule only ever fires once, right as its threshold
// is crossed, not again on every warn after it.
async function checkEscalation(client, guild, user) {
  const activeWarnCount = await db.getActiveWarnCount(guild.id, user.id);
  const rule = await db.getEscalationRuleForThreshold(guild.id, activeWarnCount);
  if (!rule) return null;

  const reason = `Automatische Eskalation: ${activeWarnCount} aktive Verwarnung(en) erreicht.`;
  try {
    if (rule.action === 'timeout') return await timeout(client, guild, user, rule.duration_minutes, reason, null, 'System (Eskalation)');
    if (rule.action === 'kick')    return await kick(client, guild, user, reason, null, 'System (Eskalation)');
    if (rule.action === 'ban')     return await ban(client, guild, user, reason, null, 'System (Eskalation)');
  } catch (err) {
    logger.error(`Moderation: Eskalationsaktion (${rule.action}) fehlgeschlagen für Guild ${guild.id}, Nutzer ${user.id}:`, err.message);
  }
  return null;
}

async function warn(client, guild, user, reason, moderatorId, moderatorName) {
  const caseRow = await createCase(client, guild.id, { action: 'warn', userId: user.id, username: user.tag, moderatorId, moderatorName, reason });
  const escalationCase = await checkEscalation(client, guild, user);
  return { caseRow, escalationCase };
}

module.exports = {
  formatDuration, createCase, logCase, checkEscalation,
  warn, kick, ban, tempban, unban, timeout, untimeout,
};
