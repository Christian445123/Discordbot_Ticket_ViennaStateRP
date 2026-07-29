'use strict';

const core = require('../../core/db');

async function initSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_settings (
      guild_id         VARCHAR(32) PRIMARY KEY,
      log_channel_id   VARCHAR(32),
      inactivity_days  INT NOT NULL DEFAULT 14
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_ranks (
      id       INT AUTO_INCREMENT PRIMARY KEY,
      guild_id VARCHAR(32) NOT NULL,
      name     VARCHAR(80) NOT NULL,
      level    INT NOT NULL,
      role_id  VARCHAR(32),
      UNIQUE KEY uniq_guild_rank (guild_id, name)
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_members (
      id       INT AUTO_INCREMENT PRIMARY KEY,
      guild_id VARCHAR(32) NOT NULL,
      user_id  VARCHAR(32) NOT NULL,
      rank_id  INT NOT NULL,
      since    DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_guild_user (guild_id, user_id),
      FOREIGN KEY (rank_id) REFERENCES team_ranks(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_rank_history (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      guild_id     VARCHAR(32) NOT NULL,
      user_id      VARCHAR(32) NOT NULL,
      old_rank     VARCHAR(80),
      new_rank     VARCHAR(80) NOT NULL,
      changed_by   VARCHAR(32) NOT NULL,
      reason       TEXT,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_warnings (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      guild_id   VARCHAR(32) NOT NULL,
      user_id    VARCHAR(32) NOT NULL,
      issued_by  VARCHAR(32) NOT NULL,
      reason     TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_activity (
      guild_id       VARCHAR(32) NOT NULL,
      user_id        VARCHAR(32) NOT NULL,
      last_active_at DATETIME,
      message_count  INT NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS loa_requests (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      guild_id    VARCHAR(32) NOT NULL,
      user_id     VARCHAR(32) NOT NULL,
      start_at    DATE NOT NULL,
      end_at      DATE NOT NULL,
      reason      TEXT,
      status      VARCHAR(20) NOT NULL DEFAULT 'pending',
      decided_by  VARCHAR(32),
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS application_forms (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      guild_id       VARCHAR(32) NOT NULL,
      name           VARCHAR(100) NOT NULL,
      questions      JSON NOT NULL,
      target_rank_id INT NULL,
      open           TINYINT(1) NOT NULL DEFAULT 1,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_guild_form (guild_id, name),
      FOREIGN KEY (target_rank_id) REFERENCES team_ranks(id) ON DELETE SET NULL
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS applications (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      form_id      INT NOT NULL,
      user_id      VARCHAR(32) NOT NULL,
      answers      JSON NOT NULL,
      status       VARCHAR(20) NOT NULL DEFAULT 'pending',
      reviewed_by  VARCHAR(32),
      review_note  TEXT,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (form_id) REFERENCES application_forms(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
}

// ── Settings ──────────────────────────────────────────────────────────────────
async function getTeamSettings(guildId) {
  const rows = await core.query('SELECT * FROM team_settings WHERE guild_id = :guildId', { guildId });
  return rows[0];
}

async function upsertTeamSettings(guildId, data) {
  await core.query('INSERT IGNORE INTO team_settings (guild_id) VALUES (:guildId)', { guildId });
  const fields = Object.keys(data);
  if (fields.length === 0) return;
  const set = fields.map(k => `${k} = :${k}`).join(', ');
  await core.query(`UPDATE team_settings SET ${set} WHERE guild_id = :guildId`, { ...data, guildId });
}

// ── Ranks ─────────────────────────────────────────────────────────────────────
async function createRank(guildId, { name, level, roleId }) {
  await core.query(
    'INSERT INTO team_ranks (guild_id, name, level, role_id) VALUES (:guildId, :name, :level, :roleId)',
    { guildId, name, level, roleId: roleId ?? null },
  );
}

async function getRanks(guildId) {
  return core.query('SELECT * FROM team_ranks WHERE guild_id = :guildId ORDER BY level ASC', { guildId });
}

async function getRankByName(guildId, name) {
  const rows = await core.query('SELECT * FROM team_ranks WHERE guild_id = :guildId AND name = :name', { guildId, name });
  return rows[0];
}

async function getRankById(id) {
  const rows = await core.query('SELECT * FROM team_ranks WHERE id = :id', { id });
  return rows[0];
}

// ── Members ───────────────────────────────────────────────────────────────────
async function upsertMember(guildId, userId, rankId) {
  await core.query(`
    INSERT INTO team_members (guild_id, user_id, rank_id) VALUES (:guildId, :userId, :rankId)
    ON DUPLICATE KEY UPDATE rank_id = :rankId
  `, { guildId, userId, rankId });
}

async function getMember(guildId, userId) {
  const rows = await core.query(`
    SELECT m.*, r.name AS rank_name, r.level AS rank_level, r.role_id AS rank_role_id
    FROM team_members m JOIN team_ranks r ON r.id = m.rank_id
    WHERE m.guild_id = :guildId AND m.user_id = :userId
  `, { guildId, userId });
  return rows[0];
}

async function getMembersByGuild(guildId) {
  return core.query(`
    SELECT m.*, r.name AS rank_name, r.level AS rank_level, r.role_id AS rank_role_id
    FROM team_members m JOIN team_ranks r ON r.id = m.rank_id
    WHERE m.guild_id = :guildId ORDER BY r.level DESC
  `, { guildId });
}

// ── Rank history ──────────────────────────────────────────────────────────────
async function addRankHistory({ guildId, userId, oldRank, newRank, changedBy, reason }) {
  await core.query(`
    INSERT INTO team_rank_history (guild_id, user_id, old_rank, new_rank, changed_by, reason)
    VALUES (:guildId, :userId, :oldRank, :newRank, :changedBy, :reason)
  `, { guildId, userId, oldRank: oldRank ?? null, newRank, changedBy, reason: reason ?? null });
}

async function getRankHistory(guildId, userId) {
  return core.query(
    'SELECT * FROM team_rank_history WHERE guild_id = :guildId AND user_id = :userId ORDER BY created_at DESC',
    { guildId, userId },
  );
}

// ── Team-internal warnings ("Teamakte") ───────────────────────────────────────
async function addWarning(guildId, userId, issuedBy, reason) {
  await core.query(
    'INSERT INTO team_warnings (guild_id, user_id, issued_by, reason) VALUES (:guildId, :userId, :issuedBy, :reason)',
    { guildId, userId, issuedBy, reason },
  );
}

async function getWarnings(guildId, userId) {
  return core.query(
    'SELECT * FROM team_warnings WHERE guild_id = :guildId AND user_id = :userId ORDER BY created_at DESC',
    { guildId, userId },
  );
}

// ── Activity ──────────────────────────────────────────────────────────────────
async function touchActivity(guildId, userId) {
  await core.query(`
    INSERT INTO team_activity (guild_id, user_id, last_active_at, message_count)
    VALUES (:guildId, :userId, CURRENT_TIMESTAMP, 1)
    ON DUPLICATE KEY UPDATE last_active_at = CURRENT_TIMESTAMP, message_count = message_count + 1
  `, { guildId, userId });
}

async function getInactiveMembers(guildId, thresholdMs) {
  return core.query(`
    SELECT m.user_id, r.name AS rank_name, a.last_active_at
    FROM team_members m
    JOIN team_ranks r ON r.id = m.rank_id
    LEFT JOIN team_activity a ON a.guild_id = m.guild_id AND a.user_id = m.user_id
    WHERE m.guild_id = :guildId
      AND (a.last_active_at IS NULL OR a.last_active_at < :threshold)
  `, { guildId, threshold: new Date(Date.now() - thresholdMs) });
}

// ── LOA (Urlaub) ──────────────────────────────────────────────────────────────
async function createLoa({ guildId, userId, startAt, endAt, reason }) {
  const result = await core.query(`
    INSERT INTO loa_requests (guild_id, user_id, start_at, end_at, reason)
    VALUES (:guildId, :userId, :startAt, :endAt, :reason)
  `, { guildId, userId, startAt, endAt, reason: reason ?? null });
  return result.insertId;
}

async function getLoaByGuild(guildId) {
  return core.query('SELECT * FROM loa_requests WHERE guild_id = :guildId ORDER BY created_at DESC', { guildId });
}

async function getLoaById(id) {
  const rows = await core.query('SELECT * FROM loa_requests WHERE id = :id', { id });
  return rows[0];
}

async function decideLoa(id, status, decidedBy) {
  await core.query('UPDATE loa_requests SET status = :status, decided_by = :decidedBy WHERE id = :id', { id, status, decidedBy });
}

async function endExpiredLoa() {
  await core.query(`
    UPDATE loa_requests SET status = 'ended'
    WHERE status = 'approved' AND end_at < CURDATE()
  `);
}

// ── Application forms & applications (Bewerbungen) ────────────────────────────
async function createForm(guildId, { name, questions, targetRankId }) {
  await core.query(`
    INSERT INTO application_forms (guild_id, name, questions, target_rank_id)
    VALUES (:guildId, :name, :questions, :targetRankId)
  `, { guildId, name, questions: JSON.stringify(questions), targetRankId: targetRankId ?? null });
}

async function getForms(guildId) {
  return core.query('SELECT * FROM application_forms WHERE guild_id = :guildId ORDER BY created_at DESC', { guildId });
}

async function getFormByName(guildId, name) {
  const rows = await core.query('SELECT * FROM application_forms WHERE guild_id = :guildId AND name = :name', { guildId, name });
  return rows[0];
}

async function getFormById(id) {
  const rows = await core.query('SELECT * FROM application_forms WHERE id = :id', { id });
  return rows[0];
}

async function setFormOpen(id, open) {
  await core.query('UPDATE application_forms SET open = :open WHERE id = :id', { id, open: open ? 1 : 0 });
}

async function createApplication(formId, userId, answers) {
  const result = await core.query(
    'INSERT INTO applications (form_id, user_id, answers) VALUES (:formId, :userId, :answers)',
    { formId, userId, answers: JSON.stringify(answers) },
  );
  return result.insertId;
}

async function getApplicationById(id) {
  const rows = await core.query('SELECT * FROM applications WHERE id = :id', { id });
  return rows[0];
}

async function getPendingApplications(guildId) {
  return core.query(`
    SELECT a.*, f.name AS form_name, f.target_rank_id
    FROM applications a JOIN application_forms f ON f.id = a.form_id
    WHERE f.guild_id = :guildId AND a.status = 'pending'
    ORDER BY a.created_at ASC
  `, { guildId });
}

async function decideApplication(id, status, reviewedBy, reviewNote) {
  await core.query(
    'UPDATE applications SET status = :status, reviewed_by = :reviewedBy, review_note = :reviewNote WHERE id = :id',
    { id, status, reviewedBy, reviewNote: reviewNote ?? null },
  );
}

module.exports = {
  initSchema,
  getTeamSettings, upsertTeamSettings,
  createRank, getRanks, getRankByName, getRankById,
  upsertMember, getMember, getMembersByGuild,
  addRankHistory, getRankHistory,
  addWarning, getWarnings,
  touchActivity, getInactiveMembers,
  createLoa, getLoaByGuild, getLoaById, decideLoa, endExpiredLoa,
  createForm, getForms, getFormByName, getFormById, setFormOpen,
  createApplication, getApplicationById, getPendingApplications, decideApplication,
};
