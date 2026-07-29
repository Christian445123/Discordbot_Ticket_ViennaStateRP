'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db        = require('../../database/db');
const ticketLog = require('../ticketLog');

function pingMention(c) {
  if (c.ping_type === 'role') return `<@&${c.ping_target_id}>`;
  if (c.ping_type === 'user') return `<@${c.ping_target_id}>`;
  return 'Keine';
}

function resolvePingTarget(interaction) {
  const role = interaction.options.getRole('ping_rolle');
  const user = interaction.options.getUser('ping_user');
  if (role && user) return { error: '❌ Bitte entweder eine Rolle **oder** eine Person angeben, nicht beides.' };
  if (role) return { pingType: 'role', pingTargetId: role.id, pingGiven: true };
  if (user) return { pingType: 'user', pingTargetId: user.id, pingGiven: true };
  return { pingType: null, pingTargetId: null, pingGiven: false };
}

function categoryEmbed(title, c) {
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(0x57F287)
    .addFields(
      { name: 'Name',                    value: `${c.emoji} ${c.name}`,               inline: true },
      { name: 'Ping-Ziel',                value: pingMention(c),                       inline: true },
      { name: 'Beschreibung',             value: c.description || '_keine_',           inline: false },
      { name: 'Automatische Nachricht',   value: c.auto_message || '_keine_',          inline: false },
    );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kategorie-config')
    .setDescription('Verwaltet die Ticket-Kategorien (nur Admins)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub
      .setName('hinzufuegen')
      .setDescription('Fügt eine neue Kategorie hinzu')
      .addStringOption(opt => opt.setName('name').setDescription('Name der Kategorie').setRequired(true).setMaxLength(80))
      .addStringOption(opt => opt.setName('emoji').setDescription('Emoji (Standard: 🎫)').setRequired(false))
      .addStringOption(opt => opt.setName('beschreibung').setDescription('Kurzbeschreibung, wird im Panel angezeigt').setRequired(false).setMaxLength(200))
      .addRoleOption(opt => opt.setName('ping_rolle').setDescription('Rolle, die bei neuen Tickets dieser Kategorie gepingt wird').setRequired(false))
      .addUserOption(opt => opt.setName('ping_user').setDescription('Alternativ: einzelne Person statt einer Rolle pingen').setRequired(false))
      .addStringOption(opt => opt.setName('auto_nachricht').setDescription('Automatische Nachricht bei Ticket-Erstellung').setRequired(false).setMaxLength(1000))
      .addBooleanOption(opt => opt.setName('auto_im_kanal').setDescription('Automatische Nachricht im Ticket-Kanal senden (Standard: ja)').setRequired(false))
      .addBooleanOption(opt => opt.setName('auto_als_dm').setDescription('Automatische Nachricht zusätzlich per DM senden (Standard: nein)').setRequired(false)))
    .addSubcommand(sub => sub
      .setName('bearbeiten')
      .setDescription('Bearbeitet eine bestehende Kategorie')
      .addStringOption(opt => opt.setName('name').setDescription('Zu bearbeitende Kategorie').setRequired(true).setAutocomplete(true))
      .addStringOption(opt => opt.setName('emoji').setDescription('Neues Emoji').setRequired(false))
      .addStringOption(opt => opt.setName('beschreibung').setDescription('Neue Beschreibung').setRequired(false).setMaxLength(200))
      .addRoleOption(opt => opt.setName('ping_rolle').setDescription('Neue Ping-Rolle').setRequired(false))
      .addUserOption(opt => opt.setName('ping_user').setDescription('Neue Ping-Person (überschreibt Ping-Rolle)').setRequired(false))
      .addStringOption(opt => opt.setName('auto_nachricht').setDescription('Neue automatische Nachricht').setRequired(false).setMaxLength(1000))
      .addBooleanOption(opt => opt.setName('auto_im_kanal').setDescription('Automatische Nachricht im Kanal senden?').setRequired(false))
      .addBooleanOption(opt => opt.setName('auto_als_dm').setDescription('Automatische Nachricht per DM senden?').setRequired(false)))
    .addSubcommand(sub => sub
      .setName('entfernen')
      .setDescription('Entfernt eine Kategorie')
      .addStringOption(opt => opt.setName('name').setDescription('Zu entfernende Kategorie').setRequired(true).setAutocomplete(true)))
    .addSubcommand(sub => sub
      .setName('liste')
      .setDescription('Zeigt alle konfigurierten Kategorien')),

  async autocomplete(interaction) {
    const focused    = interaction.options.getFocused().toLowerCase();
    const categories = await db.getCategories(interaction.guild.id);
    const choices = categories
      .filter(c => c.name.toLowerCase().includes(focused))
      .slice(0, 25)
      .map(c => ({ name: `${c.emoji} ${c.name}`, value: c.name }));
    await interaction.respond(choices);
  },

  async execute(interaction) {
    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    await db.ensureGuildWithDefaults(guildId);

    if (sub === 'hinzufuegen') {
      const name = interaction.options.getString('name', true).trim();
      if (await db.getCategoryByName(guildId, name)) {
        return interaction.reply({ content: `❌ Kategorie **${name}** existiert bereits.`, ephemeral: true });
      }

      const ping = resolvePingTarget(interaction);
      if (ping.error) return interaction.reply({ content: ping.error, ephemeral: true });

      const autoImKanalOpt = interaction.options.getBoolean('auto_im_kanal');
      const autoImKanal    = autoImKanalOpt === null ? true : autoImKanalOpt;
      const { count }      = await db.getCategoryCount(guildId);

      await db.insertCategory({
        guild_id:              guildId,
        name,
        emoji:                 interaction.options.getString('emoji') || '🎫',
        description:           interaction.options.getString('beschreibung') || '',
        ping_type:             ping.pingType,
        ping_target_id:        ping.pingTargetId,
        auto_message:          interaction.options.getString('auto_nachricht') || null,
        auto_message_channel:  autoImKanal ? 1 : 0,
        auto_message_dm:       interaction.options.getBoolean('auto_als_dm') ? 1 : 0,
        sort_order:            count,
      });

      const created = await db.getCategoryByName(guildId, name);
      await interaction.reply({ embeds: [categoryEmbed('✅ Kategorie hinzugefügt', created)] });
      await ticketLog.logCategoryConfigChanged(interaction.client, guildId, {
        action: 'hinzugefügt', name, changedByTag: interaction.user.tag,
      });
      return;
    }

    if (sub === 'bearbeiten') {
      const name     = interaction.options.getString('name', true);
      const existing = await db.getCategoryByName(guildId, name);
      if (!existing) return interaction.reply({ content: `❌ Kategorie **${name}** nicht gefunden.`, ephemeral: true });

      const ping = resolvePingTarget(interaction);
      if (ping.error) return interaction.reply({ content: ping.error, ephemeral: true });

      const emoji          = interaction.options.getString('emoji');
      const beschreibung    = interaction.options.getString('beschreibung');
      const autoNachricht   = interaction.options.getString('auto_nachricht');
      const autoImKanalOpt  = interaction.options.getBoolean('auto_im_kanal');
      const autoAlsDmOpt    = interaction.options.getBoolean('auto_als_dm');

      const updates = {};
      if (emoji !== null)         updates.emoji = emoji;
      if (beschreibung !== null)  updates.description = beschreibung;
      if (ping.pingGiven)         { updates.ping_type = ping.pingType; updates.ping_target_id = ping.pingTargetId; }
      if (autoNachricht !== null) updates.auto_message = autoNachricht;
      if (autoImKanalOpt !== null) updates.auto_message_channel = autoImKanalOpt ? 1 : 0;
      if (autoAlsDmOpt !== null)   updates.auto_message_dm = autoAlsDmOpt ? 1 : 0;

      if (Object.keys(updates).length === 0) {
        return interaction.reply({ content: 'ℹ️ Keine Änderungen angegeben.', ephemeral: true });
      }

      await db.updateCategory(guildId, name, updates);
      const updated = await db.getCategoryByName(guildId, name);
      await interaction.reply({ embeds: [categoryEmbed('✅ Kategorie aktualisiert', updated)] });
      await ticketLog.logCategoryConfigChanged(interaction.client, guildId, {
        action: 'bearbeitet', name, changedByTag: interaction.user.tag,
      });
      return;
    }

    if (sub === 'entfernen') {
      const name     = interaction.options.getString('name', true);
      const existing = await db.getCategoryByName(guildId, name);
      if (!existing) return interaction.reply({ content: `❌ Kategorie **${name}** nicht gefunden.`, ephemeral: true });

      const { count } = await db.getCategoryCount(guildId);
      if (count <= 1) {
        return interaction.reply({ content: '❌ Die letzte verbleibende Kategorie kann nicht gelöscht werden.', ephemeral: true });
      }

      await db.deleteCategory(guildId, name);
      await interaction.reply({ content: `🗑️ Kategorie **${name}** entfernt.` });
      await ticketLog.logCategoryConfigChanged(interaction.client, guildId, {
        action: 'entfernt', name, changedByTag: interaction.user.tag,
      });
      return;
    }

    // sub === 'liste'
    const categories = await db.getCategories(guildId);
    const embed = new EmbedBuilder().setTitle('🏷️ Konfigurierte Kategorien').setColor(0x5865F2);

    if (!categories.length) {
      embed.setDescription('Keine Kategorien konfiguriert.');
    } else {
      categories.forEach(c => {
        const auto = c.auto_message
          ? `Ja (${[c.auto_message_channel ? 'Kanal' : null, c.auto_message_dm ? 'DM' : null].filter(Boolean).join(' + ') || '—'})`
          : 'Nein';
        embed.addFields({
          name:  `${c.emoji} ${c.name}`,
          value: `${c.description || '_keine Beschreibung_'}\nPing: ${pingMention(c)} · Auto-Nachricht: ${auto}`,
        });
      });
    }
    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
