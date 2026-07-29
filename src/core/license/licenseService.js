'use strict';

const licenseDb = require('../../modules/license/db');
const cache     = require('./cache');
const logger    = require('../../utils/logger');

// Demand-driven re-validation: a short in-memory TTL means every guild with
// actual bot activity gets re-checked against the DB every few minutes,
// without a separate polling loop hammering idle guilds that never run a
// command anyway.
const MEMO_TTL_MS = 5 * 60 * 1000;
const memo = new Map(); // guildId -> { valid, checkedAt }

function isExpired(expiresAt) {
  return expiresAt != null && new Date(expiresAt).getTime() <= Date.now();
}

async function validateFromDb(guildId) {
  const activation = await licenseDb.getActivationByGuild(guildId);
  if (!activation) return { valid: false, expiresAt: null };
  const valid = activation.status === 'active' && !isExpired(activation.expires_at);
  if (valid) await licenseDb.touchValidation(guildId).catch(() => {});
  return { valid, expiresAt: activation.expires_at };
}

function fallbackFromCache(guildId) {
  const entry = cache.readEntry(guildId);
  if (!entry) return false;

  const graceHours = Number(process.env.LICENSE_OFFLINE_GRACE_HOURS) || 72;
  const ageMs       = Date.now() - new Date(entry.checkedAt).getTime();
  const withinGrace = ageMs <= graceHours * 60 * 60 * 1000;

  return entry.valid && withinGrace;
}

async function isValid(guildId) {
  const memoHit = memo.get(guildId);
  if (memoHit && Date.now() - memoHit.checkedAt < MEMO_TTL_MS) return memoHit.valid;

  try {
    const { valid, expiresAt } = await validateFromDb(guildId);
    cache.writeEntry(guildId, { valid, expiresAt });
    memo.set(guildId, { valid, checkedAt: Date.now() });
    return valid;
  } catch (err) {
    logger.warn(`Lizenzprüfung für Guild ${guildId} fehlgeschlagen (DB nicht erreichbar) – nutze Offline-Cache: ${err.message}`);
    const valid = fallbackFromCache(guildId);
    memo.set(guildId, { valid, checkedAt: Date.now() });
    return valid;
  }
}

// Drops the in-memory memo entry so the next isValid() call re-checks the
// DB immediately instead of serving a stale result for up to MEMO_TTL_MS —
// used right after activating/revoking/extending a license.
function invalidate(guildId) {
  memo.delete(guildId);
}

async function status(guildId) {
  const activation = await licenseDb.getActivationByGuild(guildId);
  if (!activation) return { activated: false };
  return {
    activated:  true,
    label:      activation.label,
    status:     activation.status,
    expiresAt:  activation.expires_at,
    valid:      activation.status === 'active' && !isExpired(activation.expires_at),
  };
}

// One-time, idempotent bootstrap so an already-running deployment (the
// guild configured via DISCORD_GUILD_ID before this rebuild) doesn't get
// locked out the moment license enforcement goes live.
async function bootstrap() {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) return;

  const existing = await licenseDb.getActivationByGuild(guildId);
  if (existing) return;

  const bootstrapKey = `BOOTSTRAP-${guildId}`;
  if (!(await licenseDb.getLicenseByKey(bootstrapKey))) {
    await licenseDb.createLicense({
      licenseKey: bootstrapKey,
      label:      'Automatisch erzeugte Bestandslizenz',
      maxGuilds:  1,
      expiresAt:  null,
    });
  }
  await licenseDb.activateLicense(guildId, bootstrapKey);
  logger.info(`Bestandslizenz für Guild ${guildId} aktiviert (Bestandsschutz für bestehende Installation).`);
}

module.exports = { isValid, status, bootstrap, invalidate };
