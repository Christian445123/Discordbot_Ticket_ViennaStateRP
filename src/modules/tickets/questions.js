'use strict';

// Per-category ticket-creation questions. A category without its own
// questions (categories.questions IS NULL) falls back to the classic
// Betreff + Beschreibung pair, so every existing/unconfigured category keeps
// behaving exactly as before. Configured categories get up to 5 fully
// custom questions (Discord modal limit), asked instead of the defaults.

const DEFAULT_QUESTIONS = [
  { label: 'Betreff', style: 'short', required: true },
  { label: 'Beschreibung', style: 'paragraph', required: false },
];

const MAX_QUESTIONS = 5;
const MAX_LABEL_LENGTH = 45; // Discord modal label limit

function isDefaultQuestions(questions) {
  return questions === DEFAULT_QUESTIONS;
}

// categoryCfg.questions is the raw JSON TEXT column value (or null/undefined).
function resolveQuestions(categoryCfg) {
  const parsed = parseStoredQuestions(categoryCfg?.questions);
  return parsed.length ? parsed : DEFAULT_QUESTIONS;
}

// Returns [] (not the defaults) — used by editing UIs that need to tell
// "nothing configured yet" apart from "configured with these questions".
function parseStoredQuestions(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Normalizes arbitrary input (e.g. a web request body) into a clean
// questions array, or null if nothing usable was given (→ store NULL →
// falls back to the defaults).
function sanitizeQuestions(input) {
  if (!Array.isArray(input)) return null;
  const cleaned = input
    .map(q => ({
      label:    String(q?.label ?? '').trim().slice(0, MAX_LABEL_LENGTH),
      style:    q?.style === 'paragraph' ? 'paragraph' : 'short',
      required: q?.required !== false,
    }))
    .filter(q => q.label)
    .slice(0, MAX_QUESTIONS);
  return cleaned.length ? cleaned : null;
}

// Parses the simple ";"-separated string the /kategorie-config slash
// command accepts (every question becomes a required short-text question —
// styles/optional questions are a web-only refinement).
function parseDelimitedQuestions(raw) {
  if (!raw) return null;
  const labels = raw.split(';').map(s => s.trim()).filter(Boolean).slice(0, MAX_QUESTIONS);
  if (!labels.length) return null;
  return labels.map(label => ({ label: label.slice(0, MAX_LABEL_LENGTH), style: 'short', required: true }));
}

function describeQuestions(raw) {
  const parsed = parseStoredQuestions(raw);
  return parsed.length ? parsed.map(q => q.label).join(', ') : 'Standard (Betreff, Beschreibung)';
}

// Builds the ticket "subject" text stored in the DB / shown in the ticket
// embed & list from the modal answers. Keeps the classic plain "Betreff
// (+ Beschreibung)" layout when a category uses the two default questions,
// so unconfigured categories look exactly as before; custom per-category
// questions render as a labeled Q&A block instead.
function formatAnswers(questions, values) {
  if (isDefaultQuestions(questions)) {
    const subject     = values[0]?.trim() || '(kein Betreff)';
    const description = values[1]?.trim();
    return description ? `${subject}\n\n${description}` : subject;
  }
  const parts = questions
    .map((q, i) => ({ label: q.label, value: values[i]?.trim() }))
    .filter(p => p.value)
    .map(p => `**${p.label}:** ${p.value}`);
  return parts.length ? parts.join('\n\n') : '(keine Angaben)';
}

module.exports = {
  DEFAULT_QUESTIONS,
  MAX_QUESTIONS,
  resolveQuestions,
  parseStoredQuestions,
  sanitizeQuestions,
  parseDelimitedQuestions,
  describeQuestions,
  formatAnswers,
};
