'use strict';

const db = require('./db');

const close            = require('./commands/close');
const kategorieConfig  = require('./commands/kategorie-config');
const kategorie        = require('./commands/kategorie');
const panel            = require('./commands/panel');
const setup            = require('./commands/setup');

const messageCreate = require('./events/messageCreate');
const { component } = require('./component');

module.exports = {
  name: 'tickets',
  core: false,
  initSchema: db.initSchema,
  commands: [close, kategorieConfig, kategorie, panel, setup],
  events: [messageCreate],
  component,
  registerRoutes(router, ctx) {
    router.use('/', require('./routes')(ctx.discordClient));
  },
};
