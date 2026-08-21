'use strict';

// Every category gets a non-empty welcome & automatic message — if an admin
// doesn't set their own text (via /kategorie-config or the web interface),
// a sensible category-name-aware default is generated instead of leaving
// the field empty. Used by db.js on category insert/update.

function defaultWelcomeMessage(name) {
  return `Willkommen im Ticket-Bereich **${name}**! Ein Teammitglied kümmert sich in Kürze um ` +
    `dein Anliegen – bitte schildere dein Anliegen so genau wie möglich, damit wir dir schnell helfen können.`;
}

function defaultAutoMessage(name) {
  return `Danke für deine Anfrage im Bereich **${name}**! Tickets werden in der Reihenfolge ihres ` +
    `Eingangs bearbeitet – wir melden uns so schnell wie möglich bei dir.`;
}

function ensureWelcomeMessage(name, value) {
  return value && String(value).trim() ? value : defaultWelcomeMessage(name);
}

function ensureAutoMessage(name, value) {
  return value && String(value).trim() ? value : defaultAutoMessage(name);
}

module.exports = { defaultWelcomeMessage, defaultAutoMessage, ensureWelcomeMessage, ensureAutoMessage };
