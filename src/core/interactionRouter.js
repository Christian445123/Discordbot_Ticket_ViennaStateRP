'use strict';

// Single, central Events.InteractionCreate listener for the whole bot.
// Every module contributes commands (via client.commands, populated in
// moduleLoader.loadCommands) and optionally a `component` handler for
// buttons/selects/modals — this file is the only place that actually
// listens to the raw Discord event, so dispatch and error handling only
// have to live in one spot.

const { Events } = require('discord.js');
const moduleLoader = require('./moduleLoader');
const logger        = require('../utils/logger');

function register(client) {
  const componentHandlers = moduleLoader.collectComponentHandlers();

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isAutocomplete()) {
        const command = client.commands.get(interaction.commandName);
        if (!command?.autocomplete) return;
        try {
          await command.autocomplete(interaction);
        } catch (err) {
          logger.error(`Autocomplete für "${interaction.commandName}" fehlgeschlagen:`, err);
        }
        return;
      }

      if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;
        try {
          await command.execute(interaction);
        } catch (err) {
          logger.error(`Command "${interaction.commandName}" fehlgeschlagen:`, err);
          const msg = { content: '❌ Fehler beim Ausführen des Befehls.', ephemeral: true };
          if (interaction.replied || interaction.deferred) await interaction.followUp(msg).catch(() => {});
          else await interaction.reply(msg).catch(() => {});
        }
        return;
      }

      // Buttons / select menus / modals: every module gets a chance to
      // recognize its own customId. Unmatched handlers are expected to no-op.
      for (const { name, handle } of componentHandlers) {
        try {
          await handle(interaction);
        } catch (err) {
          logger.error(`Component-Handler von Modul "${name}" fehlgeschlagen:`, err);
        }
      }
    } catch (err) {
      logger.error('Interaction-Router fehlgeschlagen:', err);
    }
  });
}

module.exports = { register };
