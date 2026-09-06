'use strict';

// Per-category ping roles. A category with ping_type = 'role' pings every
// role in this list (instead of the single role earlier versions stored in
// ping_target_id) when a new ticket of that category is opened.

const MAX_PING_ROLES = 10;

// categoryCfg.ping_role_ids is the raw JSON TEXT column value (or null/undefined).
function parseStoredPingRoleIds(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string' && id) : [];
  } catch {
    return [];
  }
}

// Normalizes arbitrary input (e.g. a web request body) into a clean role-id
// array, or null if nothing usable was given (→ store NULL → no role ping).
function sanitizePingRoleIds(input) {
  if (!Array.isArray(input)) return null;
  const cleaned = [...new Set(input.map(id => String(id ?? '').trim()).filter(Boolean))].slice(0, MAX_PING_ROLES);
  return cleaned.length ? cleaned : null;
}

module.exports = { MAX_PING_ROLES, parseStoredPingRoleIds, sanitizePingRoleIds };
