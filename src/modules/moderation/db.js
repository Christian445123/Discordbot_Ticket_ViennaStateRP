'use strict';

const core = require('../../core/db');

async function query(sql, params) {
  return core.query(sql, params);
}

// ── Schema (auto-created on startup, safe to run every time) ────────────────
async function initSchema(p) {
  await p.query(`
    CREATE TABLE IF NOT EXISTS moderation_guilds (
      guild_id             VARCHAR(32) PRIMARY KEY,
      log_channel_id       VARCHAR(32),
      honeypot_channel_id  VARCHAR(32),
      automod_words        TEXT,
      spam_enabled         TINYINT(1) DEFAULT 0,
      spam_message_limit   INT DEFAULT 5,
      spam_window_seconds  INT DEFAULT 5,
      mention_enabled      TINYINT(1) DEFAULT 0,
      mention_limit        INT DEFAULT 5,
      invite_block_enabled TINYINT(1) DEFAULT 0,
      next_case_number     INT DEFAULT 1
    ) ENGINE=InnoDB
  `);

  // Every moderation action (manual or automatic) gets its own row and a
  // per-guild case number — "revoked" is reused for two related meanings
  // depending on action: a warn that was manually removed (no longer
  // counts toward escalation), or a tempban that has already been
  // auto-unbanned (no longer needs processing by the scheduler).
  await p.query(`
    CREATE TABLE IF NOT EXISTS moderation_cases (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      guild_id         VARCHAR(32) NOT NULL,
      case_number      INT NOT NULL,
      action           VARCHAR(20) NOT NULL,
      user_id          VARCHAR(32) NOT NULL,
      username         VARCHAR(150) NOT NULL,
      moderator_id     VARCHAR(32),
      moderator_name   VARCHAR(150) NOT NULL,
      reason           TEXT,
      duration_minutes INT,
      expires_at       DATETIME NULL,
      revoked          TINYINT(1) DEFAULT 0,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_guild_case (guild_id, case_number)
    ) ENGINE=InnoDB
  `);

  // One row per configured threshold — hit exactly (not >=) once per user
  // as their active warn count climbs, see actions.js's checkEscalation().
  await p.query(`
    CREATE TABLE IF NOT EXISTS moderation_escalation_rules (
      guild_id         VARCHAR(32) NOT NULL,
      threshold        INT NOT NULL,
      action           VARCHAR(20) NOT NULL,
      duration_minutes INT,
      PRIMARY KEY (guild_id, threshold)
    ) ENGINE=InnoDB
  `);
}

async function ensureGuild(guildId) {
  await query('INSERT IGNORE INTO moderation_guilds (guild_id) VALUES (:guildId)', { guildId });
}

async function getConfig(guildId) {
  const rows = await query('SELECT * FROM moderation_guilds WHERE guild_id = :guildId', { guildId });
  return rows[0];
}

async function updateConfig(guildId, data) {
  const fields = Object.keys(data).map(k => `${k} = :${k}`).join(', ');
  await query(`UPDATE moderation_guilds SET ${fields} WHERE guild_id = :guild_id`, { ...data, guild_id: guildId });
}

// ── Cases ─────────────────────────────────────────────────────────────────────
// Not wrapped in a transaction (matches this codebase's existing
// ticket_count/incrementCategoryTicketCount style) — acceptable at this
// project's scale, where two moderators racing to create a case in the
// exact same instant is a non-issue in practice.
async function nextCaseNumber(guildId) {
  await query('UPDATE moderation_guilds SET next_case_number = next_case_number + 1 WHERE guild_id = :guildId', { guildId });
  const rows = await query('SELECT next_case_number FROM moderation_guilds WHERE guild_id = :guildId', { guildId });
  return rows[0].next_case_number - 1;
}

async function insertCase(data) {
  await query(`
    INSERT INTO moderation_cases
      (guild_id, case_number, action, user_id, username, moderator_id, moderator_name, reason, duration_minutes, expires_at)
    VALUES
      (:guildId, :caseNumber, :action, :userId, :username, :moderatorId, :moderatorName, :reason, :durationMinutes, :expiresAt)
  `, {
    guildId:         data.guildId,
    caseNumber:      data.caseNumber,
    action:          data.action,
    userId:          data.userId,
    username:        data.username,
    moderatorId:     data.moderatorId ?? null,
    moderatorName:   data.moderatorName,
    reason:          data.reason ?? null,
    durationMinutes: data.durationMinutes ?? null,
    expiresAt:       data.expiresAt ?? null,
  });
}

async function getCase(guildId, caseNumber) {
  const rows = await query(
    'SELECT * FROM moderation_cases WHERE guild_id = :guildId AND case_number = :caseNumber',
    { guildId, caseNumber },
  );
  return rows[0];
}

// LIMIT is interpolated directly (not a named placeholder) — mysql2's
// prepared statements are unreliable binding LIMIT via namedPlaceholders,
// and the value is always an internally-controlled integer, never raw
// user input, so there's no injection risk in validating-then-inlining it.
async function getRecentCases(guildId, limit = 50) {
  const safeLimit = Math.max(1, Math.min(500, Math.trunc(Number(limit)) || 50));
  return query(
    `SELECT * FROM moderation_cases WHERE guild_id = :guildId ORDER BY case_number DESC LIMIT ${safeLimit}`,
    { guildId },
  );
}

async function getActiveWarnCount(guildId, userId) {
  const rows = await query(
    "SELECT COUNT(*) AS count FROM moderation_cases WHERE guild_id = :guildId AND user_id = :userId AND action = 'warn' AND revoked = 0",
    { guildId, userId },
  );
  return rows[0].count;
}

async function getActiveWarnings(guildId, userId) {
  return query(
    "SELECT * FROM moderation_cases WHERE guild_id = :guildId AND user_id = :userId AND action = 'warn' AND revoked = 0 ORDER BY case_number ASC",
    { guildId, userId },
  );
}

async function revokeWarning(guildId, caseNumber) {
  await query(
    "UPDATE moderation_cases SET revoked = 1 WHERE guild_id = :guildId AND case_number = :caseNumber AND action = 'warn'",
    { guildId, caseNumber },
  );
}

async function getExpiredTempbans() {
  return query(
    "SELECT * FROM moderation_cases WHERE action = 'tempban' AND revoked = 0 AND expires_at IS NOT NULL AND expires_at <= NOW()",
  );
}

async function markTempbanProcessed(guildId, caseNumber) {
  await query(
    "UPDATE moderation_cases SET revoked = 1 WHERE guild_id = :guildId AND case_number = :caseNumber AND action = 'tempban'",
    { guildId, caseNumber },
  );
}

// ── Escalation rules ──────────────────────────────────────────────────────────
async function getEscalationRules(guildId) {
  return query(
    'SELECT * FROM moderation_escalation_rules WHERE guild_id = :guildId ORDER BY threshold ASC',
    { guildId },
  );
}

async function getEscalationRuleForThreshold(guildId, threshold) {
  const rows = await query(
    'SELECT * FROM moderation_escalation_rules WHERE guild_id = :guildId AND threshold = :threshold',
    { guildId, threshold },
  );
  return rows[0];
}

// Replaces the whole ladder at once — the web panel always sends the
// complete, re-ordered rule set, so delete+reinsert is simpler than diffing.
async function setEscalationRules(guildId, rules) {
  await query('DELETE FROM moderation_escalation_rules WHERE guild_id = :guildId', { guildId });
  for (const rule of rules) {
    await query(`
      INSERT INTO moderation_escalation_rules (guild_id, threshold, action, duration_minutes)
      VALUES (:guildId, :threshold, :action, :durationMinutes)
    `, {
      guildId,
      threshold:        rule.threshold,
      action:           rule.action,
      durationMinutes:  rule.duration_minutes ?? null,
    });
  }
}

module.exports = {
  initSchema, ensureGuild, getConfig, updateConfig,
  nextCaseNumber, insertCase, getCase, getRecentCases,
  getActiveWarnCount, getActiveWarnings, revokeWarning,
  getExpiredTempbans, markTempbanProcessed,
  getEscalationRules, getEscalationRuleForThreshold, setEscalationRules,
};
