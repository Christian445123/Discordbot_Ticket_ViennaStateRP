'use strict';

const { Client, GatewayIntentBits } = require('discord.js');
const moduleLoader      = require('./moduleLoader');
const interactionRouter = require('./interactionRouter');
const readyEvent        = require('./events/ready');

function createClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
    ],
  });

  moduleLoader.loadCommands(client);
  moduleLoader.loadEvents(client);
  interactionRouter.register(client);

  client.once(readyEvent.name, readyEvent.execute);

  return client;
}

module.exports = { createClient };
