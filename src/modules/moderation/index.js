'use strict';

const db = require('./db');

const modCommand    = require('./commands/mod');
const messageCreate = require('./events/messageCreate');
const ready         = require('./events/ready');

module.exports = {
  name: 'moderation',
  initSchema: db.initSchema,
  commands: [modCommand],
  events: [messageCreate, ready],
  registerRoutes(router, ctx) {
    router.use('/', require('./routes')(ctx.discordClient));
  },
};
