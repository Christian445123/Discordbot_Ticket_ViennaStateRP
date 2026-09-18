'use strict';

const db = require('./db');

const voiceSupportCommand = require('./commands/voice-support');
const voiceStateUpdate    = require('./events/voiceStateUpdate');

module.exports = {
  name: 'voiceSupport',
  initSchema: db.initSchema,
  commands: [voiceSupportCommand],
  events: [voiceStateUpdate],
};
