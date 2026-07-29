'use strict';

const { Events } = require('discord.js');
const db         = require('../db');
const modLog     = require('../modLog');
const escalation = require('../escalation');
const guards     = require('../../../core/guards');
const logger     = require('../../../utils/logger');

const INVITE_REGEX = /(discord\.gg|discord(?:app)?\.com\/invite)\/[a-z0-9-]+/i;
const CAPS_MIN_LENGTH = 10;
const CAPS_RATIO      = 0.7;
const SPAM_WINDOW_MS  = 5000;
const SPAM_MAX_MSGS   = 5;

// Rules rarely change — a short-lived per-guild cache avoids a DB round trip
// on every single message.
const ruleCache = new Map(); // guildId -> { rules, fetchedAt }
const RULE_CACHE_TTL_MS = 30_000;

async function getRulesCached(guildId) {
  const hit = ruleCache.get(guildId);
  if (hit && Date.now() - hit.fetchedAt < RULE_CACHE_TTL_MS) return hit.rules;
  const rules = await db.getRules(guildId);
  ruleCache.set(guildId, { rules, fetchedAt: Date.now() });
  return rules;
}

const spamTracker = new Map(); // `${guildId}:${userId}` -> timestamps[]

function isSpam(guildId, userId) {
  const key = `${guildId}:${userId}`;
  const now = Date.now();
  const timestamps = (spamTracker.get(key) ?? []).filter(t => now - t < SPAM_WINDOW_MS);
  timestamps.push(now);
  spamTracker.set(key, timestamps);
  return timestamps.length > SPAM_MAX_MSGS;
}

function isCapsFlood(content) {
  const letters = content.replace(/[^a-zA-ZäöüÄÖÜß]/g, '');
  if (letters.length < CAPS_MIN_LENGTH) return false;
  const upper = letters.replace(/[^A-ZÄÖÜ]/g, '');
  return upper.length / letters.length >= CAPS_RATIO;
}

function findViolatedRule(rules, message) {
  const content = message.content || '';

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const config = JSON.parse(rule.config || '{}');

    if (rule.rule_type === 'invites' && INVITE_REGEX.test(content)) return rule;
    if (rule.rule_type === 'wordfilter' && (config.words ?? []).some(w => w && content.toLowerCase().includes(w))) return rule;
    if (rule.rule_type === 'caps' && isCapsFlood(content)) return rule;
    if (rule.rule_type === 'spam' && isSpam(message.guild.id, message.author.id)) return rule;
  }
  return null;
}

module.exports = {
  name: Events.MessageCreate,

  async execute(message) {
    if (message.author.bot || !message.guild) return;
    if (!(await guards.requireLicenseSilent(message.guild.id))) return;

    const rules = await getRulesCached(message.guild.id);
    if (rules.length === 0) return;

    const rule = findViolatedRule(rules, message);
    if (!rule) return;

    const action = JSON.parse(rule.action || '{}');
    const points = action.points ?? 1;

    await message.delete().catch(() => {});

    const reason = `Automod: ${rule.rule_type}`;
    if (action.type === 'timeout' && action.durationMs) {
      const member = await message.guild.members.fetch(message.author.id).catch(() => null);
      await member?.timeout(action.durationMs, reason).catch(err =>
        logger.error('Automod-Timeout fehlgeschlagen:', err.message));
    }

    const caseId = await db.createCase({
      guildId: message.guild.id, userId: message.author.id, moderatorId: message.client.user.id,
      type: 'automod', reason, points, durationMs: action.type === 'timeout' ? action.durationMs : null,
    });

    await modLog.logCase(message.client, message.guild.id, {
      caseId, type: 'automod', userTag: message.author.tag, userId: message.author.id,
      moderatorTag: '🤖 Automod', reason, points, durationMs: action.durationMs,
    });

    message.channel.send({
      content: `⚠️ ${message.author}, deine Nachricht wurde durch Automod entfernt (${rule.rule_type}).`,
    }).then(m => setTimeout(() => m.delete().catch(() => {}), 6000)).catch(() => {});

    if (points > 0) {
      await escalation.checkAndApply(message.client, message.guild, message.author.id, points);
    }
  },
};
