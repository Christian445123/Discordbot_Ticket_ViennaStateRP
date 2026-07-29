'use strict';

// Single, central Events.InteractionCreate listener for the whole bot.
// Every module contributes commands (via client.commands, populated in
// moduleLoader.loadCommands) and optionally a `component` handler for
// buttons/selects/modals — this file is the only place that actually
// listens to the raw Discord event, so the license gate (added once the
// license module exists) and error handling only have to live in one spot.

const { Events } = require('discord.js');
const moduleLoader = require('./moduleLoader');
const guards       = require('./guards');
const logger        = require('../utils/logger');

function register(client) {
  const coreCommandNames = new Set();
  for (const { mod } of moduleLoader.getModules()) {
    if (!mod.core) continue;
    for (const command of mod.commands ?? []) coreCommandNames.add(command.data.name);
  }
  const componentHandlers = moduleLoader.collectComponentHandlers();

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      const commandName = (interaction.isChatInputCommand() || interaction.isAutocomplete())
        ? interaction.commandName
        : null;
      const bypassLicense = Boolean(commandName && coreCommandNames.has(commandName));

      if (interaction.guildId && !bypassLicense) {
        const valid = await guards.requireLicenseSilent(interaction.guildId);
        if (!valid) {
          if (interaction.isAutocomplete()) return interaction.respond([]);
          if (interaction.isRepliable()) {
            return interaction.reply({
              content: '❌ Für diesen Server liegt keine gültige Lizenz vor. Ein Server-Admin kann den Status mit `/lizenz status` prüfen.',
              ephemeral: true,
            }).catch(() => {});
          }
          return;
        }
      }

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
