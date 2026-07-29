'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const licenseDb      = require('../db');
const licenseService = require('../../../core/license/licenseService');

function formatDate(value) {
  return value ? new Date(value).toLocaleString('de-AT') : 'Unbefristet';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lizenz')
    .setDescription('Lizenz dieses Servers verwalten (nur Admins)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub.setName('status')
         .setDescription('Zeigt den aktuellen Lizenzstatus dieses Servers'))
    .addSubcommand(sub =>
      sub.setName('aktivieren')
         .setDescription('Aktiviert einen Lizenzschlüssel für diesen Server')
         .addStringOption(opt =>
           opt.setName('key')
              .setDescription('Der Lizenzschlüssel')
              .setRequired(true))),

  async execute(interaction) {
    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'status') {
      const info = await licenseService.status(guildId);
      if (!info.activated) {
        return interaction.reply({
          content: '❌ Für diesen Server ist keine Lizenz aktiviert. Nutze `/lizenz aktivieren key:<dein-key>`.',
          ephemeral: true,
        });
      }
      const embed = new EmbedBuilder()
        .setTitle('🔑 Lizenzstatus')
        .setColor(info.valid ? 0x57F287 : 0xED4245)
        .addFields(
          { name: 'Status',   value: info.valid ? '✅ Gültig' : `❌ Ungültig (${info.status})`, inline: true },
          { name: 'Läuft ab', value: formatDate(info.expiresAt), inline: true },
          { name: 'Label',    value: info.label || '–', inline: true },
        );
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'aktivieren') {
      const key = interaction.options.getString('key', true).trim();
      const license = await licenseDb.getLicenseByKey(key);
      if (!license) {
        return interaction.reply({ content: '❌ Unbekannter Lizenzschlüssel.', ephemeral: true });
      }
      if (license.status !== 'active') {
        return interaction.reply({ content: '❌ Dieser Lizenzschlüssel wurde gesperrt.', ephemeral: true });
      }
      if (license.expires_at && new Date(license.expires_at).getTime() <= Date.now()) {
        return interaction.reply({ content: '❌ Dieser Lizenzschlüssel ist abgelaufen.', ephemeral: true });
      }

      const activeCount = await licenseDb.countActivationsForKey(key, guildId);
      if (activeCount >= license.max_guilds) {
        return interaction.reply({
          content: `❌ Dieser Lizenzschlüssel ist bereits auf der maximalen Anzahl Server aktiv (${license.max_guilds}).`,
          ephemeral: true,
        });
      }

      await licenseDb.activateLicense(guildId, key);
      licenseService.invalidate(guildId);
      return interaction.reply({ content: '✅ Lizenz erfolgreich aktiviert! Alle Bot-Funktionen sind jetzt freigeschaltet.', ephemeral: true });
    }
  },
};
