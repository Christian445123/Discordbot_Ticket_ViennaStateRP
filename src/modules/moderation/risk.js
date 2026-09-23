'use strict';

// Simple, transparent point-based risk score — no ML, just additive rules
// an admin can actually explain to themselves. Case history (from this
// bot) weighs heaviest since it's the most direct signal; account/join
// age are softer signals for "freshly created account, straight into
// trouble" raid/bot patterns.
function computeRisk({ activeWarns = 0, kicks = 0, bans = 0, accountAgeDays = null, joinAgeDays = null }) {
  let score = 0;

  score += activeWarns * 15;
  score += kicks * 40;
  score += bans * 60;

  if (accountAgeDays != null) {
    if (accountAgeDays < 7) score += 25;
    else if (accountAgeDays < 30) score += 10;
  }

  // Trouble within a day of joining is the classic raid/throwaway pattern
  // — only counts if they actually have a case, not just for being new.
  if (joinAgeDays != null && joinAgeDays < 1 && (activeWarns + kicks + bans) > 0) {
    score += 15;
  }

  score = Math.min(100, score);

  let tier, label;
  if (score >= 80)      { tier = 'critical'; label = '🔴 Kritisch'; }
  else if (score >= 50) { tier = 'high';     label = '🟠 Hoch'; }
  else if (score >= 20) { tier = 'medium';   label = '🟡 Mittel'; }
  else                  { tier = 'low';      label = '🟢 Niedrig'; }

  return { score, tier, label };
}

module.exports = { computeRisk };
