'use strict';

const db          = require('./db');
const lizenz      = require('./commands/lizenz');
const lizenzAdmin = require('./commands/lizenz-admin');

module.exports = {
  name: 'license',
  core: true, // license commands must keep working even when the license itself is invalid
  initSchema: db.initSchema,
  commands: [lizenz, lizenzAdmin],
  registerRoutes(router, ctx) {
    router.use('/', require('./routes')(ctx.discordClient));
  },
};
