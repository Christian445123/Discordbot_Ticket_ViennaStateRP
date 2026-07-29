'use strict';

require('dotenv').config();
const { REST, Routes } = require('discord.js');
const moduleLoader = require('../core/moduleLoader');
const logger        = require('../utils/logger');

const commands = moduleLoader.collectAllCommandsJSON();
const rest     = new REST().setToken(process.env.DISCORD_TOKEN);

// DEV_GUILD_ID registers commands instantly on a single guild for fast
// iteration. Without it, commands are registered globally (can take up to
// ~1h to propagate) — the right choice once the bot runs on more than one
// Discord server, since a guild-scoped registration only reaches one guild.
const devGuildId = process.env.DEV_GUILD_ID;

(async () => {
  try {
    logger.info(`Registriere ${commands.length} Slash-Commands${devGuildId ? ` (Dev-Guild ${devGuildId})` : ' (global)'}...`);

    const route = devGuildId
      ? Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, devGuildId)
      : Routes.applicationCommands(process.env.DISCORD_CLIENT_ID);

    await rest.put(route, { body: commands });

    logger.info('Slash-Commands erfolgreich registriert!');
  } catch (err) {
    logger.error('Slash-Command-Registrierung fehlgeschlagen:', err);
  }
})();
