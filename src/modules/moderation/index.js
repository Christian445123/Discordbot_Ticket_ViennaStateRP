'use strict';

const db = require('./db');

const warn             = require('./commands/warn');
const timeout          = require('./commands/timeout');
const untimeout        = require('./commands/untimeout');
const kick              = require('./commands/kick');
const ban               = require('./commands/ban');
const unban             = require('./commands/unban');
const modCase           = require('./commands/case');
const modlogs           = require('./commands/modlogs');
const automodConfig     = require('./commands/automod-config');
const eskalationConfig  = require('./commands/eskalation-config');
const moderationSetup   = require('./commands/moderation-setup');

const messageCreate  = require('./events/messageCreate');
const { component }  = require('./component');

module.exports = {
  name: 'moderation',
  core: false,
  initSchema: db.initSchema,
  commands: [
    warn, timeout, untimeout, kick, ban, unban,
    modCase, modlogs, automodConfig, eskalationConfig, moderationSetup,
  ],
  events: [messageCreate],
  component,
  registerRoutes(router, ctx) {
    router.use('/', require('./routes')(ctx.discordClient));
  },
};
