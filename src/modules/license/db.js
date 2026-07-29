'use strict';

const core = require('../../core/db');

async function initSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS licenses (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      license_key VARCHAR(64) NOT NULL UNIQUE,
      label       VARCHAR(150),
      status      VARCHAR(20) NOT NULL DEFAULT 'active',
      max_guilds  INT NOT NULL DEFAULT 1,
      expires_at  DATETIME NULL,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS license_activations (
      id                 INT AUTO_INCREMENT PRIMARY KEY,
      license_key        VARCHAR(64) NOT NULL,
      guild_id           VARCHAR(32) NOT NULL UNIQUE,
      activated_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_validated_at  DATETIME NULL,
      FOREIGN KEY (license_key) REFERENCES licenses(license_key) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
}

async function createLicense({ licenseKey, label, maxGuilds, expiresAt }) {
  await core.query(`
    INSERT INTO licenses (license_key, label, max_guilds, expires_at)
    VALUES (:licenseKey, :label, :maxGuilds, :expiresAt)
  `, { licenseKey, label: label ?? null, maxGuilds: maxGuilds ?? 1, expiresAt: expiresAt ?? null });
}

async function getLicenseByKey(licenseKey) {
  const rows = await core.query('SELECT * FROM licenses WHERE license_key = :licenseKey', { licenseKey });
  return rows[0];
}

async function listLicenses() {
  return core.query(`
    SELECT l.*, COUNT(a.id) AS active_guilds
    FROM licenses l
    LEFT JOIN license_activations a ON a.license_key = l.license_key
    GROUP BY l.id
    ORDER BY l.created_at DESC
  `);
}

async function setLicenseStatus(licenseKey, status) {
  await core.query('UPDATE licenses SET status = :status WHERE license_key = :licenseKey', { status, licenseKey });
}

async function extendLicense(licenseKey, expiresAt) {
  await core.query('UPDATE licenses SET expires_at = :expiresAt WHERE license_key = :licenseKey', { expiresAt, licenseKey });
}

async function getActivationByGuild(guildId) {
  const rows = await core.query(`
    SELECT a.*, l.status, l.expires_at, l.label
    FROM license_activations a
    JOIN licenses l ON l.license_key = a.license_key
    WHERE a.guild_id = :guildId
  `, { guildId });
  return rows[0];
}

async function getGuildIdsForKey(licenseKey) {
  const rows = await core.query('SELECT guild_id FROM license_activations WHERE license_key = :licenseKey', { licenseKey });
  return rows.map(r => r.guild_id);
}

async function countActivationsForKey(licenseKey, excludingGuildId) {
  const rows = await core.query(
    'SELECT COUNT(*) AS count FROM license_activations WHERE license_key = :licenseKey AND guild_id <> :excludingGuildId',
    { licenseKey, excludingGuildId: excludingGuildId ?? '' },
  );
  return rows[0].count;
}

async function activateLicense(guildId, licenseKey) {
  await core.query(`
    INSERT INTO license_activations (license_key, guild_id, last_validated_at)
    VALUES (:licenseKey, :guildId, CURRENT_TIMESTAMP)
    ON DUPLICATE KEY UPDATE license_key = :licenseKey, activated_at = CURRENT_TIMESTAMP, last_validated_at = CURRENT_TIMESTAMP
  `, { licenseKey, guildId });
}

async function touchValidation(guildId) {
  await core.query(
    'UPDATE license_activations SET last_validated_at = CURRENT_TIMESTAMP WHERE guild_id = :guildId',
    { guildId },
  );
}

module.exports = {
  initSchema,
  createLicense,
  getLicenseByKey,
  listLicenses,
  setLicenseStatus,
  extendLicense,
  getActivationByGuild,
  getGuildIdsForKey,
  countActivationsForKey,
  activateLicense,
  touchValidation,
};
