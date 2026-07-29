'use strict';

const core = require('../../core/db');

async function initSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS moderation_settings (
      guild_id       VARCHAR(32) PRIMARY KEY,
      log_channel_id VARCHAR(32),
      mute_role_id   VARCHAR(32)
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mod_cases (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      guild_id      VARCHAR(32) NOT NULL,
      user_id       VARCHAR(32) NOT NULL,
      moderator_id  VARCHAR(32) NOT NULL,
      type          VARCHAR(20) NOT NULL,
      reason        TEXT,
      points        INT NOT NULL DEFAULT 0,
      duration_ms   BIGINT NULL,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      active        TINYINT(1) NOT NULL DEFAULT 1,
      appeal_status VARCHAR(20) NOT NULL DEFAULT 'none',
      note          TEXT NULL
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS automod_rules (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      guild_id   VARCHAR(32) NOT NULL,
      rule_type  VARCHAR(20) NOT NULL,
      enabled    TINYINT(1) NOT NULL DEFAULT 1,
      config     JSON,
      action     JSON,
      UNIQUE KEY uniq_guild_rule (guild_id, rule_type)
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mod_escalation_rules (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      guild_id    VARCHAR(32) NOT NULL,
      min_points  INT NOT NULL,
      action      VARCHAR(20) NOT NULL,
      duration_ms BIGINT NULL,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS appeals (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      case_id     INT NOT NULL,
      user_id     VARCHAR(32) NOT NULL,
      message     TEXT NOT NULL,
      status      VARCHAR(20) NOT NULL DEFAULT 'pending',
      handled_by  VARCHAR(32) NULL,
      response    TEXT NULL,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (case_id) REFERENCES mod_cases(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
}

// ── Settings ──────────────────────────────────────────────────────────────────
async function getSettings(guildId) {
  const rows = await core.query('SELECT * FROM moderation_settings WHERE guild_id = :guildId', { guildId });
  return rows[0];
}

async function upsertSettings(guildId, data) {
  await core.query('INSERT IGNORE INTO moderation_settings (guild_id) VALUES (:guildId)', { guildId });
  const fields = Object.keys(data);
  if (fields.length === 0) return;
  const set = fields.map(k => `${k} = :${k}`).join(', ');
  await core.query(`UPDATE moderation_settings SET ${set} WHERE guild_id = :guildId`, { ...data, guildId });
}

// ── Cases ─────────────────────────────────────────────────────────────────────
async function createCase({ guildId, userId, moderatorId, type, reason, points = 0, durationMs = null }) {
  const result = await core.query(`
    INSERT INTO mod_cases (guild_id, user_id, moderator_id, type, reason, points, duration_ms)
    VALUES (:guildId, :userId, :moderatorId, :type, :reason, :points, :durationMs)
  `, { guildId, userId, moderatorId, type, reason: reason ?? null, points, durationMs });
  return result.insertId;
}

async function getCaseById(id) {
  const rows = await core.query('SELECT * FROM mod_cases WHERE id = :id', { id });
  return rows[0];
}

async function getCasesByUser(guildId, userId) {
  return core.query(
    'SELECT * FROM mod_cases WHERE guild_id = :guildId AND user_id = :userId ORDER BY created_at DESC',
    { guildId, userId },
  );
}

async function addCaseNote(id, note) {
  await core.query('UPDATE mod_cases SET note = :note WHERE id = :id', { id, note });
}

async function setAppealStatus(caseId, status) {
  await core.query('UPDATE mod_cases SET appeal_status = :status WHERE id = :caseId', { caseId, status });
}

// Points from active cases in the last 30 days — the rolling window used for
// automatic escalation.
async function getRecentPoints(guildId, userId) {
  const rows = await core.query(`
    SELECT COALESCE(SUM(points), 0) AS points FROM mod_cases
    WHERE guild_id = :guildId AND user_id = :userId AND active = 1
      AND created_at >= (NOW() - INTERVAL 30 DAY)
  `, { guildId, userId });
  return rows[0].points;
}

// ── Automod rules ─────────────────────────────────────────────────────────────
async function getRules(guildId) {
  return core.query('SELECT * FROM automod_rules WHERE guild_id = :guildId', { guildId });
}

async function getRule(guildId, ruleType) {
  const rows = await core.query(
    'SELECT * FROM automod_rules WHERE guild_id = :guildId AND rule_type = :ruleType',
    { guildId, ruleType },
  );
  return rows[0];
}

async function upsertRule(guildId, ruleType, { enabled, config, action }) {
  await core.query(`
    INSERT INTO automod_rules (guild_id, rule_type, enabled, config, action)
    VALUES (:guildId, :ruleType, :enabled, :config, :action)
    ON DUPLICATE KEY UPDATE enabled = :enabled, config = :config, action = :action
  `, {
    guildId, ruleType,
    enabled: enabled ? 1 : 0,
    config: JSON.stringify(config ?? {}),
    action: JSON.stringify(action ?? {}),
  });
}

// ── Escalation rules ──────────────────────────────────────────────────────────
async function getEscalationRules(guildId) {
  return core.query(
    'SELECT * FROM mod_escalation_rules WHERE guild_id = :guildId ORDER BY min_points ASC',
    { guildId },
  );
}

async function addEscalationRule(guildId, { minPoints, action, durationMs }) {
  await core.query(`
    INSERT INTO mod_escalation_rules (guild_id, min_points, action, duration_ms)
    VALUES (:guildId, :minPoints, :action, :durationMs)
  `, { guildId, minPoints, action, durationMs: durationMs ?? null });
}

// ── Appeals ───────────────────────────────────────────────────────────────────
async function createAppeal(caseId, userId, message) {
  const result = await core.query(
    'INSERT INTO appeals (case_id, user_id, message) VALUES (:caseId, :userId, :message)',
    { caseId, userId, message },
  );
  return result.insertId;
}

async function getAppealById(id) {
  const rows = await core.query('SELECT * FROM appeals WHERE id = :id', { id });
  return rows[0];
}

async function getAppealsByUser(guildId, userId) {
  return core.query(`
    SELECT a.* FROM appeals a
    JOIN mod_cases c ON c.id = a.case_id
    WHERE c.guild_id = :guildId AND a.user_id = :userId
    ORDER BY a.created_at DESC
  `, { guildId, userId });
}

async function decideAppeal(id, status, handledBy, response) {
  await core.query(
    'UPDATE appeals SET status = :status, handled_by = :handledBy, response = :response WHERE id = :id',
    { id, status, handledBy, response: response ?? null },
  );
}

module.exports = {
  initSchema,
  getSettings,
  upsertSettings,
  createCase,
  getCaseById,
  getCasesByUser,
  addCaseNote,
  setAppealStatus,
  getRecentPoints,
  getRules,
  getRule,
  upsertRule,
  getEscalationRules,
  addEscalationRule,
  createAppeal,
  getAppealById,
  getAppealsByUser,
  decideAppeal,
};
