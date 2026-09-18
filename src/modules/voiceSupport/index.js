'use strict';

const db = require('./db');

const voiceSupportCommand = require('./commands/voice-support');
const voiceStateUpdate    = require('./events/voiceStateUpdate');
const ready               = require('./events/ready');

module.exports = {
  name: 'voiceSupport',
  initSchema: db.initSchema,
  commands: [voiceSupportCommand],
  events: [voiceStateUpdate, ready],
  registerRoutes(router, ctx) {
    router.use('/', require('./routes')(ctx.discordClient));
  },
};
