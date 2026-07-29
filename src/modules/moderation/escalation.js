'use strict';

// After any case is created, checks whether the user's rolling 30-day point
// total just crossed one of the guild's configured escalation thresholds,
// and if so applies that action exactly once (based on "did this case push
// the total across the line", not "is the total currently above it" — so
// repeat warns past an already-handled threshold don't re-trigger it).

const db     = require('./db');
const modLog = require('./modLog');
const logger = require('../../utils/logger');

async function checkAndApply(discordClient, guild, userId, addedPoints) {
  if (addedPoints <= 0) return;

  const newTotal = await db.getRecentPoints(guild.id, userId);
  const previousTotal = newTotal - addedPoints;

  const rules = await db.getEscalationRules(guild.id);
  const crossed = rules.filter(r => previousTotal < r.min_points && r.min_points <= newTotal);
  if (crossed.length === 0) return;

  // If multiple thresholds were crossed at once, apply only the strictest one.
  const rule = crossed.reduce((a, b) => (b.min_points > a.min_points ? b : a));

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return;

  const reason = `Automatische Eskalation (${newTotal} Punkte in 30 Tagen)`;
  const botId  = discordClient.user.id;

  try {
    if (rule.action === 'timeout') {
      await member.timeout(rule.duration_ms, reason);
    } else if (rule.action === 'kick') {
      await member.kick(reason);
    } else if (rule.action === 'ban') {
      await member.ban({ reason });
    } else {
      return;
    }
  } catch (err) {
    logger.error(`Automatische Eskalation (${rule.action}) fehlgeschlagen:`, err.message);
    return;
  }

  const caseId = await db.createCase({
    guildId: guild.id, userId, moderatorId: botId,
    type: rule.action, reason, points: 0, durationMs: rule.duration_ms,
  });

  await modLog.logCase(discordClient, guild.id, {
    caseId, type: rule.action, userTag: member.user.tag, userId,
    moderatorTag: '🤖 Automatische Eskalation', reason, points: 0, durationMs: rule.duration_ms,
  });
}

module.exports = { checkAndApply };
