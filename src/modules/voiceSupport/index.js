'use strict';

const db = require('./db');

const voiceSupportCommand = require('./commands/voice-support');
const voiceStateUpdate    = require('./events/voiceStateUpdate');
const ready               = require('./events/ready');
const { component }       = require('./component');

module.exports = {
  name: 'voiceSupport',
  initSchema: db.initSchema,
  commands: [voiceSupportCommand],
  events: [voiceStateUpdate, ready],
  component,
  registerRoutes(router, ctx) {
    router.use('/', require('./routes')(ctx.discordClient));
  },
};
