'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');
const db      = require('../db');
const actions = require('../actions');

// Accepts "10m", "2h", "7d", "3w" or a bare number (assumed minutes).
// Returns null for anything unparseable so callers can reply with a clear
// error instead of silently doing the wrong thing.
const UNIT_MINUTES = { m: 1, h: 60, d: 1440, w: 10080 };
function parseDurationMinutes(input) {
  const trimmed = String(input).trim().toLowerCase();
  const bare = Number(trimmed);
  if (!Number.isNaN(bare) && trimmed !== '') return bare > 0 ? Math.round(bare) : null;

  const match = trimmed.match(/^(\d+)\s*([mhdw])$/);
  if (!match) return null;
  const amount = Number(match[1]);
  return amount > 0 ? amount * UNIT_MINUTES[match[2]] : null;
}

const DISCORD_TIMEOUT_MAX_MINUTES = 28 * 24 * 60; // Discord's own hard cap

// /mod has no setDefaultMemberPermissions gate (see below) — visibility and
// authorization are both handled here instead, against the web-panel-
// configured moderator_role_ids, so access is tied to a specific role the
// admin picks (e.g. "Team"/"High Team") rather than Discord's generic
// "Moderate Members" permission, which this server's staff roles may or
// may not actually have. Administrator is always allowed, same convention
// as isTicketStaff/isStaffMember elsewhere in this bot.
function isModerator(member, cfg) {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;

  let moderatorRoleIds;
  try { moderatorRoleIds = JSON.parse(cfg?.moderator_role_ids || '[]'); } catch { moderatorRoleIds = []; }
  return moderatorRoleIds.some(roleId => member.roles.cache.has(roleId));
}

function actionReplyEmbed(title, caseRow, extra) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(0x57F287)
    .addFields(
      { name: 'Fall',  value: `#${caseRow.case_number}`, inline: true },
      { name: 'Nutzer', value: `<@${caseRow.user_id}>`,  inline: true },
    );
  if (caseRow.duration_minutes) {
    embed.addFields({ name: 'Dauer', value: actions.formatDuration(caseRow.duration_minutes), inline: true });
  }
  if (extra) embed.addFields(extra);
  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mod')
    .setDescription('Moderationswerkzeuge (nur Team)')
    // Deliberately no setDefaultMemberPermissions() — every guild member
    // can see /mod in their command list, but execute() below rejects
    // anyone without the web-panel-configured moderator role (or
    // Administrator) before any subcommand logic runs.
    .addSubcommand(sub => sub
      .setName('warn')
      .setDescription('Verwarnt einen Nutzer')
      .addUserOption(o => o.setName('nutzer').setDescription('Zu verwarnender Nutzer').setRequired(true))
      .addStringOption(o => o.setName('grund').setDescription('Grund der Verwarnung').setRequired(true).setMaxLength(500)))
    .addSubcommand(sub => sub
      .setName('warnungen')
      .setDescription('Zeigt die aktiven Verwarnungen eines Nutzers')
      .addUserOption(o => o.setName('nutzer').setDescription('Nutzer').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('warnung-entfernen')
      .setDescription('Entfernt eine einzelne Verwarnung (zählt danach nicht mehr für die Eskalation)')
      .addIntegerOption(o => o.setName('fall').setDescription('Fallnummer der Verwarnung').setRequired(true).setMinValue(1)))
    .addSubcommand(sub => sub
      .setName('kick')
      .setDescription('Kickt einen Nutzer vom Server')
      .addUserOption(o => o.setName('nutzer').setDescription('Zu kickender Nutzer').setRequired(true))
      .addStringOption(o => o.setName('grund').setDescription('Grund').setRequired(true).setMaxLength(500)))
    .addSubcommand(sub => sub
      .setName('ban')
      .setDescription('Bannt einen Nutzer dauerhaft')
      .addUserOption(o => o.setName('nutzer').setDescription('Zu bannender Nutzer').setRequired(true))
      .addStringOption(o => o.setName('grund').setDescription('Grund').setRequired(true).setMaxLength(500))
      .addIntegerOption(o => o.setName('nachrichten_loeschen_tage').setDescription('Nachrichten der letzten X Tage mitlöschen (0-7, Standard 0)').setMinValue(0).setMaxValue(7)))
    .addSubcommand(sub => sub
      .setName('tempban')
      .setDescription('Bannt einen Nutzer befristet (automatische Entbannung nach Ablauf)')
      .addUserOption(o => o.setName('nutzer').setDescription('Zu bannender Nutzer').setRequired(true))
      .addStringOption(o => o.setName('dauer').setDescription('z. B. 30m, 12h, 7d, 2w').setRequired(true))
      .addStringOption(o => o.setName('grund').setDescription('Grund').setRequired(true).setMaxLength(500))
      .addIntegerOption(o => o.setName('nachrichten_loeschen_tage').setDescription('Nachrichten der letzten X Tage mitlöschen (0-7, Standard 0)').setMinValue(0).setMaxValue(7)))
    .addSubcommand(sub => sub
      .setName('unban')
      .setDescription('Hebt einen Bann auf')
      .addStringOption(o => o.setName('nutzer_id').setDescription('Discord-Nutzer-ID der gebannten Person').setRequired(true))
      .addStringOption(o => o.setName('grund').setDescription('Grund').setRequired(false).setMaxLength(500)))
    .addSubcommand(sub => sub
      .setName('timeout')
      .setDescription('Versetzt einen Nutzer in Timeout (Discord-Stummschaltung)')
      .addUserOption(o => o.setName('nutzer').setDescription('Nutzer').setRequired(true))
      .addStringOption(o => o.setName('dauer').setDescription('z. B. 10m, 1h, 1d (max. 28 Tage)').setRequired(true))
      .addStringOption(o => o.setName('grund').setDescription('Grund').setRequired(true).setMaxLength(500)))
    .addSubcommand(sub => sub
      .setName('untimeout')
      .setDescription('Hebt einen Timeout vorzeitig auf')
      .addUserOption(o => o.setName('nutzer').setDescription('Nutzer').setRequired(true))
      .addStringOption(o => o.setName('grund').setDescription('Grund').setRequired(false).setMaxLength(500)))
    .addSubcommand(sub => sub
      .setName('case')
      .setDescription('Zeigt die Details eines Falls')
      .addIntegerOption(o => o.setName('fall').setDescription('Fallnummer').setRequired(true).setMinValue(1)))
    .addSubcommand(sub => sub
      .setName('setup')
      .setDescription('Richtet Log-Kanal und Honeypot-Kanal ein (Rest: Webpanel)')
      .addChannelOption(o => o.setName('log_kanal').setDescription('Kanal für das Moderations-Log').addChannelTypes(ChannelType.GuildText).setRequired(false))
      .addChannelOption(o => o.setName('honeypot_kanal').setDescription('Kanal, dessen Nutzung automatisch als Bot-Verdacht gebannt wird').addChannelTypes(ChannelType.GuildText).setRequired(false))),

  async execute(interaction) {
    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    const guild   = interaction.guild;
    await db.ensureGuild(guildId);

    const cfg = await db.getConfig(guildId);
    if (!isModerator(interaction.member, cfg)) {
      return interaction.reply({ content: '❌ Du hast keine Berechtigung, diesen Befehl zu nutzen.', ephemeral: true });
    }

    const moderatorId   = interaction.user.id;
    const moderatorName = interaction.user.tag;

    if (sub === 'warn') {
      const target = interaction.options.getUser('nutzer', true);
      const reason = interaction.options.getString('grund', true);
      const { caseRow, escalationCase } = await actions.warn(interaction.client, guild, target, reason, moderatorId, moderatorName);

      const embed = actionReplyEmbed('⚠️ Nutzer verwarnt', caseRow, { name: 'Grund', value: reason, inline: false });
      if (escalationCase) {
        const duration    = actions.formatDuration(escalationCase.duration_minutes);
        const actionLabel = duration ? `${escalationCase.action} (${duration})` : escalationCase.action;
        embed.addFields({
          name:  '🚨 Automatische Eskalation ausgelöst',
          value: `${actionLabel} — Fall #${escalationCase.case_number}`,
        });
      }
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'warnungen') {
      const target = interaction.options.getUser('nutzer', true);
      const warnings = await db.getActiveWarnings(guildId, target.id);
      if (!warnings.length) {
        return interaction.reply({ content: `ℹ️ ${target} hat keine aktiven Verwarnungen.`, ephemeral: true });
      }
      const embed = new EmbedBuilder()
        .setTitle(`⚠️ Aktive Verwarnungen von ${target.tag}`)
        .setColor(0xFEE75C)
        .setDescription(warnings.map(w =>
          `**#${w.case_number}** – ${w.reason || '_kein Grund angegeben_'} _(${w.moderator_name}, ${new Date(w.created_at).toLocaleDateString('de-AT')})_`,
        ).join('\n'));
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'warnung-entfernen') {
      const caseNumber = interaction.options.getInteger('fall', true);
      const existing = await db.getCase(guildId, caseNumber);
      if (!existing || existing.action !== 'warn') {
        return interaction.reply({ content: `❌ Fall #${caseNumber} ist keine Verwarnung.`, ephemeral: true });
      }
      if (existing.revoked) {
        return interaction.reply({ content: `ℹ️ Fall #${caseNumber} wurde bereits entfernt.`, ephemeral: true });
      }
      await db.revokeWarning(guildId, caseNumber);
      return interaction.reply({ content: `✅ Verwarnung #${caseNumber} wurde entfernt und zählt nicht mehr für die Eskalation.` });
    }

    if (sub === 'kick') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.KickMembers)) {
        return interaction.reply({ content: '❌ Dir fehlt die Berechtigung "Mitglieder kicken".', ephemeral: true });
      }
      const target = interaction.options.getUser('nutzer', true);
      const reason = interaction.options.getString('grund', true);
      try {
        const caseRow = await actions.kick(interaction.client, guild, target, reason, moderatorId, moderatorName);
        return interaction.reply({ embeds: [actionReplyEmbed('👢 Nutzer gekickt', caseRow, { name: 'Grund', value: reason, inline: false })] });
      } catch (err) {
        return interaction.reply({ content: `❌ Kick fehlgeschlagen: ${err.message}`, ephemeral: true });
      }
    }

    if (sub === 'ban') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
        return interaction.reply({ content: '❌ Dir fehlt die Berechtigung "Mitglieder bannen".', ephemeral: true });
      }
      const target = interaction.options.getUser('nutzer', true);
      const reason = interaction.options.getString('grund', true);
      const deleteDays = interaction.options.getInteger('nachrichten_loeschen_tage') ?? 0;
      try {
        const caseRow = await actions.ban(interaction.client, guild, target, reason, moderatorId, moderatorName, deleteDays * 86400);
        return interaction.reply({ embeds: [actionReplyEmbed('🔨 Nutzer gebannt', caseRow, { name: 'Grund', value: reason, inline: false })] });
      } catch (err) {
        return interaction.reply({ content: `❌ Bann fehlgeschlagen: ${err.message}`, ephemeral: true });
      }
    }

    if (sub === 'tempban') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
        return interaction.reply({ content: '❌ Dir fehlt die Berechtigung "Mitglieder bannen".', ephemeral: true });
      }
      const target = interaction.options.getUser('nutzer', true);
      const reason = interaction.options.getString('grund', true);
      const deleteDays = interaction.options.getInteger('nachrichten_loeschen_tage') ?? 0;
      const durationMinutes = parseDurationMinutes(interaction.options.getString('dauer', true));
      if (!durationMinutes) {
        return interaction.reply({ content: '❌ Ungültige Dauer. Beispiele: `30m`, `12h`, `7d`, `2w`.', ephemeral: true });
      }
      try {
        const caseRow = await actions.tempban(interaction.client, guild, target, reason, moderatorId, moderatorName, durationMinutes, deleteDays * 86400);
        return interaction.reply({ embeds: [actionReplyEmbed('⏳ Nutzer befristet gebannt', caseRow, { name: 'Grund', value: reason, inline: false })] });
      } catch (err) {
        return interaction.reply({ content: `❌ Temp-Bann fehlgeschlagen: ${err.message}`, ephemeral: true });
      }
    }

    if (sub === 'unban') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
        return interaction.reply({ content: '❌ Dir fehlt die Berechtigung "Mitglieder bannen".', ephemeral: true });
      }
      const userId = interaction.options.getString('nutzer_id', true).trim();
      const reason = interaction.options.getString('grund') || null;
      try {
        const caseRow = await actions.unban(interaction.client, guild, userId, null, reason, moderatorId, moderatorName);
        return interaction.reply({ embeds: [actionReplyEmbed('🔓 Nutzer entbannt', caseRow)] });
      } catch (err) {
        return interaction.reply({ content: `❌ Entbannen fehlgeschlagen: ${err.message}`, ephemeral: true });
      }
    }

    if (sub === 'timeout') {
      const target = interaction.options.getUser('nutzer', true);
      const reason = interaction.options.getString('grund', true);
      const durationMinutes = parseDurationMinutes(interaction.options.getString('dauer', true));
      if (!durationMinutes) {
        return interaction.reply({ content: '❌ Ungültige Dauer. Beispiele: `10m`, `1h`, `1d`.', ephemeral: true });
      }
      if (durationMinutes > DISCORD_TIMEOUT_MAX_MINUTES) {
        return interaction.reply({ content: '❌ Discord erlaubt maximal 28 Tage Timeout.', ephemeral: true });
      }
      try {
        const caseRow = await actions.timeout(interaction.client, guild, target, durationMinutes, reason, moderatorId, moderatorName);
        return interaction.reply({ embeds: [actionReplyEmbed('🔇 Nutzer in Timeout versetzt', caseRow, { name: 'Grund', value: reason, inline: false })] });
      } catch (err) {
        return interaction.reply({ content: `❌ Timeout fehlgeschlagen: ${err.message}`, ephemeral: true });
      }
    }

    if (sub === 'untimeout') {
      const target = interaction.options.getUser('nutzer', true);
      const reason = interaction.options.getString('grund') || null;
      try {
        const caseRow = await actions.untimeout(interaction.client, guild, target, reason, moderatorId, moderatorName);
        return interaction.reply({ embeds: [actionReplyEmbed('🔊 Timeout aufgehoben', caseRow)] });
      } catch (err) {
        return interaction.reply({ content: `❌ Aufheben fehlgeschlagen: ${err.message}`, ephemeral: true });
      }
    }

    if (sub === 'case') {
      const caseNumber = interaction.options.getInteger('fall', true);
      const caseRow = await db.getCase(guildId, caseNumber);
      if (!caseRow) return interaction.reply({ content: `❌ Fall #${caseNumber} nicht gefunden.`, ephemeral: true });

      const embed = new EmbedBuilder()
        .setTitle(`Fall #${caseRow.case_number} — ${caseRow.action}`)
        .setColor(caseRow.revoked ? 0x99AAB5 : 0x5865F2)
        .addFields(
          { name: 'Nutzer',    value: `<@${caseRow.user_id}> (${caseRow.username})`, inline: true },
          { name: 'Moderator', value: caseRow.moderator_id ? `<@${caseRow.moderator_id}>` : caseRow.moderator_name, inline: true },
          { name: 'Status',    value: caseRow.revoked ? 'Aufgehoben/entfernt' : 'Aktiv', inline: true },
          { name: 'Grund',     value: caseRow.reason || '—', inline: false },
        )
        .setTimestamp(new Date(caseRow.created_at));
      if (caseRow.duration_minutes) embed.addFields({ name: 'Dauer', value: actions.formatDuration(caseRow.duration_minutes), inline: true });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // sub === 'setup'
    const logChannel = interaction.options.getChannel('log_kanal');
    const honeypotChannel = interaction.options.getChannel('honeypot_kanal');
    const updates = {};
    if (logChannel) updates.log_channel_id = logChannel.id;
    if (honeypotChannel) updates.honeypot_channel_id = honeypotChannel.id;
    if (Object.keys(updates).length) await db.updateConfig(guildId, updates);

    const updatedCfg = await db.getConfig(guildId);
    const embed = new EmbedBuilder()
      .setTitle('✅ Moderation eingerichtet')
      .setColor(0x57F287)
      .addFields(
        { name: 'Log-Kanal',       value: updatedCfg.log_channel_id ? `<#${updatedCfg.log_channel_id}>` : 'Nicht gesetzt', inline: true },
        { name: 'Honeypot-Kanal',  value: updatedCfg.honeypot_channel_id ? `<#${updatedCfg.honeypot_channel_id}>` : 'Nicht gesetzt', inline: true },
      )
      .setDescription('Automod-Filter und Eskalationsregeln werden im Webpanel (Tab „Moderation“) konfiguriert.');
    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
