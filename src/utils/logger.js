'use strict';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function write(level, args) {
  if (LEVELS[level] > currentLevel) return;
  const prefix = `[${new Date().toISOString()}] [${level.toUpperCase()}]`;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(prefix, ...args);
}

module.exports = {
  error: (...args) => write('error', args),
  warn:  (...args) => write('warn',  args),
  info:  (...args) => write('info',  args),
  debug: (...args) => write('debug', args),
};
