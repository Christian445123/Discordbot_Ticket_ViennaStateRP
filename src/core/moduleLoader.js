'use strict';

// Discovers every folder under src/modules/*, each exporting a single shape:
//
//   module.exports = {
//     name: 'moderation',
//     core: false,        // core:true modules keep working even without a valid license
//     initSchema: async (pool) => {...},          // optional
//     commands: [{ data, execute, autocomplete? }, ...],   // optional
//     events:   [{ name, once?, execute }, ...],            // optional, NEVER InteractionCreate
//     component: async (interaction) => {...},              // optional, buttons/selects/modals
//     registerRoutes: (router, ctx) => {...},                // optional, ctx = { discordClient }
//   };
//
// Adding a new feature = adding a new folder here with an index.js in this
// shape. No other core file needs to change.

const fs     = require('fs');
const path   = require('path');
const { Events, Collection } = require('discord.js');
const logger = require('../utils/logger');

const MODULES_DIR = path.join(__dirname, '..', 'modules');

let cachedModules = null;

function getModules() {
  if (cachedModules) return cachedModules;

  cachedModules = fs.readdirSync(MODULES_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
    .map(name => ({ name, mod: require(path.join(MODULES_DIR, name)) }));

  return cachedModules;
}

async function initModuleSchemas(pool) {
  for (const { name, mod } of getModules()) {
    if (typeof mod.initSchema !== 'function') continue;
    await mod.initSchema(pool);
    logger.debug(`Schema initialisiert: Modul "${name}"`);
  }
}

// Registers every module's slash commands on the client and returns the set
// of command names that belong to `core:true` modules (these bypass the
// license gate in the interaction router).
function loadCommands(client) {
  client.commands = new Collection();
  const coreCommandNames = new Set();

  for (const { name, mod } of getModules()) {
    for (const command of mod.commands ?? []) {
      if (!command.data || !command.execute) {
        logger.warn(`Modul "${name}": ungültiger Command übersprungen.`);
        continue;
      }
      client.commands.set(command.data.name, command);
      if (mod.core) coreCommandNames.add(command.data.name);
    }
  }

  return coreCommandNames;
}

// Registers every module's non-InteractionCreate events directly on the
// client. InteractionCreate is intentionally excluded: it needs a single
// central listener (see core/interactionRouter.js) so the license gate and
// command dispatch happen exactly once, in one place, for every module.
function loadEvents(client) {
  for (const { name, mod } of getModules()) {
    for (const event of mod.events ?? []) {
      if (event.name === Events.InteractionCreate) {
        logger.warn(`Modul "${name}" registriert InteractionCreate über "events" – wird ignoriert. "component" exportieren statt dessen.`);
        continue;
      }
      if (event.once) client.once(event.name, (...args) => event.execute(...args));
      else client.on(event.name, (...args) => event.execute(...args));
    }
  }
}

// Buttons/select menus/modals: every module gets a chance to handle an
// interaction. Each handler is expected to check the customId itself and
// no-op if it doesn't recognize it (namespaced prefixes, e.g. "ticket_",
// avoid collisions between modules).
function collectComponentHandlers() {
  return getModules()
    .filter(({ mod }) => typeof mod.component === 'function')
    .map(({ name, mod }) => ({ name, handle: mod.component }));
}

function collectAllCommandsJSON() {
  return getModules().flatMap(({ mod }) => (mod.commands ?? []).map(c => c.data.toJSON()));
}

function registerRoutes(router, ctx) {
  for (const { name, mod } of getModules()) {
    if (typeof mod.registerRoutes !== 'function') continue;
    mod.registerRoutes(router, ctx);
    logger.debug(`Web-Routen registriert: Modul "${name}"`);
  }
}

module.exports = {
  getModules,
  initModuleSchemas,
  loadCommands,
  loadEvents,
  collectComponentHandlers,
  collectAllCommandsJSON,
  registerRoutes,
};
