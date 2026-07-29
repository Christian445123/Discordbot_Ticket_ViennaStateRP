'use strict';

const db = require('./db');

const team              = require('./commands/team');
const teamVerwarnung    = require('./commands/team-verwarnung');
const urlaub             = require('./commands/urlaub');
const bewerbungConfig    = require('./commands/bewerbung-config');
const bewerbung          = require('./commands/bewerbung');
const teamSetup          = require('./commands/team-setup');

const messageCreate = require('./events/messageCreate');
const readyEvent    = require('./events/ready');
const { component }  = require('./component');

module.exports = {
  name: 'team',
  core: false,
  initSchema: db.initSchema,
  commands: [team, teamVerwarnung, urlaub, bewerbungConfig, bewerbung, teamSetup],
  events: [messageCreate, readyEvent],
  component,
  registerRoutes(router, ctx) {
    router.use('/', require('./routes')(ctx.discordClient));
  },
};
