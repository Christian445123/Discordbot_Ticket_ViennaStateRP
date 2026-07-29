'use strict';

// Signed offline cache for license validation results. If the database is
// briefly unreachable, licenseService falls back to this file instead of
// locking every guild out immediately — but only within a grace window, and
// only if the HMAC signature still matches (so editing the file by hand
// can't be used to fake a valid license).

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const logger = require('../../utils/logger');

const CACHE_FILE = path.join(process.cwd(), 'data', 'license-cache.json');

function getSecret() {
  return process.env.LICENSE_CACHE_SECRET || process.env.SESSION_SECRET || 'insecure-default-secret-change-me';
}

function sign(guildId, valid, checkedAt, expiresAt) {
  const payload = `${guildId}:${valid}:${checkedAt}:${expiresAt ?? ''}`;
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
}

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function writeAll(data) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    logger.error('Lizenz-Cache konnte nicht geschrieben werden:', err.message);
  }
}

function writeEntry(guildId, { valid, expiresAt }) {
  const checkedAt = new Date().toISOString();
  const entry = { valid, checkedAt, expiresAt: expiresAt ?? null, sig: sign(guildId, valid, checkedAt, expiresAt) };
  const all = readAll();
  all[guildId] = entry;
  writeAll(all);
}

// Returns the cached entry only if its signature is intact — otherwise
// null, which the caller must treat as "no usable offline data".
function readEntry(guildId) {
  const entry = readAll()[guildId];
  if (!entry) return null;
  const expected = sign(guildId, entry.valid, entry.checkedAt, entry.expiresAt);
  if (expected !== entry.sig) return null;
  return entry;
}

module.exports = { writeEntry, readEntry };
