'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const crypto         = require('crypto');
const licenseDb      = require('../db');
const guards         = require('../../../core/guards');
const licenseService = require('../../../core/license/licenseService');

function generateLicenseKey() {
  const bytes = crypto.randomBytes(10).toString('hex').toUpperCase(); // 20 hex chars
  return bytes.match(/.{1,4}/g).join('-'); // XXXX-XXXX-XXXX-XXXX-XXXX
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString('de-AT') : 'Unbefristet';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lizenz-admin')
    .setDescription('Lizenzen serverübergreifend verwalten (nur Bot-Inhaber)')
    .addSubcommand(sub =>
      sub.setName('erstellen')
         .setDescription('Erstellt einen neuen Lizenzschlüssel')
         .addStringOption(opt => opt.setName('label').setDescription('Bezeichnung (z.B. Kundenname)').setRequired(false))
         .addIntegerOption(opt => opt.setName('max_server').setDescription('Wie viele Server dürfen diesen Key aktivieren (Standard 1)').setRequired(false))
         .addIntegerOption(opt => opt.setName('gueltig_tage').setDescription('Gültig für N Tage ab jetzt (leer = unbefristet)').setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('sperren')
         .setDescription('Sperrt einen Lizenzschlüssel')
         .addStringOption(opt => opt.setName('key').setDescription('Lizenzschlüssel').setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('entsperren')
         .setDescription('Entsperrt einen zuvor gesperrten Lizenzschlüssel')
         .addStringOption(opt => opt.setName('key').setDescription('Lizenzschlüssel').setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('verlaengern')
         .setDescription('Verlängert einen Lizenzschlüssel um N Tage ab jetzt')
         .addStringOption(opt => opt.setName('key').setDescription('Lizenzschlüssel').setRequired(true))
         .addIntegerOption(opt => opt.setName('tage').setDescription('Anzahl Tage ab jetzt').setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('liste')
         .setDescription('Listet alle Lizenzschlüssel auf')),

  async execute(interaction) {
    if (!guards.isSuperAdmin(interaction.user.id)) {
      return interaction.reply({ content: '❌ Dieser Befehl ist Bot-Administratoren vorbehalten.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'erstellen') {
      const label     = interaction.options.getString('label');
      const maxGuilds = interaction.options.getInteger('max_server') ?? 1;
      const gueltigTage = interaction.options.getInteger('gueltig_tage');
      const expiresAt = gueltigTage ? new Date(Date.now() + gueltigTage * 24 * 60 * 60 * 1000) : null;

      const licenseKey = generateLicenseKey();
      await licenseDb.createLicense({ licenseKey, label, maxGuilds, expiresAt });

      const embed = new EmbedBuilder()
        .setTitle('🔑 Neue Lizenz erstellt')
        .setColor(0x57F287)
        .addFields(
          { name: 'Key',        value: `\`${licenseKey}\``, inline: false },
          { name: 'Label',      value: label || '–', inline: true },
          { name: 'Max. Server', value: `${maxGuilds}`, inline: true },
          { name: 'Läuft ab',   value: formatDate(expiresAt), inline: true },
        );
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'sperren' || sub === 'entsperren') {
      const key = interaction.options.getString('key', true).trim();
      const license = await licenseDb.getLicenseByKey(key);
      if (!license) return interaction.reply({ content: '❌ Unbekannter Lizenzschlüssel.', ephemeral: true });

      await licenseDb.setLicenseStatus(key, sub === 'sperren' ? 'revoked' : 'active');
      for (const guildId of await licenseDb.getGuildIdsForKey(key)) licenseService.invalidate(guildId);
      return interaction.reply({
        content: sub === 'sperren' ? '🔒 Lizenz gesperrt.' : '🔓 Lizenz entsperrt.',
        ephemeral: true,
      });
    }

    if (sub === 'verlaengern') {
      const key  = interaction.options.getString('key', true).trim();
      const tage = interaction.options.getInteger('tage', true);
      const license = await licenseDb.getLicenseByKey(key);
      if (!license) return interaction.reply({ content: '❌ Unbekannter Lizenzschlüssel.', ephemeral: true });

      const base = license.expires_at && new Date(license.expires_at).getTime() > Date.now()
        ? new Date(license.expires_at).getTime()
        : Date.now();
      const newExpiry = new Date(base + tage * 24 * 60 * 60 * 1000);
      await licenseDb.extendLicense(key, newExpiry);
      for (const guildId of await licenseDb.getGuildIdsForKey(key)) licenseService.invalidate(guildId);
      return interaction.reply({ content: `✅ Lizenz verlängert bis ${formatDate(newExpiry)}.`, ephemeral: true });
    }

    if (sub === 'liste') {
      const licenses = await licenseDb.listLicenses();
      if (licenses.length === 0) {
        return interaction.reply({ content: 'Noch keine Lizenzen vorhanden.', ephemeral: true });
      }
      const lines = licenses.slice(0, 20).map(l =>
        `\`${l.license_key}\` — ${l.label || '–'} — ${l.status === 'active' ? '✅' : '🔒'} — ${l.active_guilds}/${l.max_guilds} Server — läuft ab: ${formatDate(l.expires_at)}`
      );
      const embed = new EmbedBuilder()
        .setTitle(`🔑 Lizenzen (${licenses.length})`)
        .setDescription(lines.join('\n'))
        .setColor(0x5865F2);
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },
};
