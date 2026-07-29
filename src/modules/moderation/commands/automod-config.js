'use strict';

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('automod-config')
    .setDescription('Automod-Regeln konfigurieren (nur Admins)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
      sub.setName('setzen')
         .setDescription('Aktiviert/konfiguriert eine Automod-Regel')
         .addStringOption(opt => opt.setName('regel').setDescription('Welche Regel').setRequired(true)
           .addChoices(
             { name: 'Wortfilter',    value: 'wordfilter' },
             { name: 'Invite-Links',  value: 'invites' },
             { name: 'Spam',         value: 'spam' },
             { name: 'CAPS-Flood',   value: 'caps' },
           ))
         .addBooleanOption(opt => opt.setName('an').setDescription('Regel aktivieren?').setRequired(true))
         .addStringOption(opt => opt.setName('aktion').setDescription('Was passiert bei Verstoß (Standard: löschen + Verwarnung)').setRequired(false)
           .addChoices(
             { name: 'Löschen + Verwarnung', value: 'delete_warn' },
             { name: 'Löschen + Timeout',    value: 'timeout' },
           ))
         .addStringOption(opt => opt.setName('dauer').setDescription('Timeout-Dauer, z.B. 10m (nur bei Aktion "Timeout")').setRequired(false))
         .addStringOption(opt => opt.setName('woerter').setDescription('Nur Wortfilter: verbotene Begriffe, kommagetrennt').setRequired(false))
         .addIntegerOption(opt => opt.setName('punkte').setDescription('Straf-Punkte pro Verstoß (Standard: 1)').setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('liste')
         .setDescription('Zeigt die aktuelle Automod-Konfiguration')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'liste') {
      const rules = await db.getRules(guildId);
      if (rules.length === 0) return interaction.reply({ content: 'Noch keine Automod-Regeln konfiguriert.', ephemeral: true });

      const lines = rules.map(r => {
        const action = JSON.parse(r.action || '{}');
        return `**${r.rule_type}** — ${r.enabled ? '✅ an' : '❌ aus'} — Aktion: ${action.type ?? '–'}${action.durationMs ? ` (${action.durationMs}ms)` : ''}, ${action.points ?? 1} Pkt.`;
      });

      const embed = new EmbedBuilder().setTitle('🤖 Automod-Konfiguration').setDescription(lines.join('\n')).setColor(0x5865F2);
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // sub === 'setzen'
    const { parseDuration } = require('../duration');
    const rule       = interaction.options.getString('regel', true);
    const enabled    = interaction.options.getBoolean('an', true);
    const actionType = interaction.options.getString('aktion') ?? 'delete_warn';
    const dauerStr   = interaction.options.getString('dauer');
    const woerter    = interaction.options.getString('woerter');
    const punkte     = interaction.options.getInteger('punkte') ?? 1;

    let durationMs = null;
    if (actionType === 'timeout') {
      durationMs = parseDuration(dauerStr);
      if (!durationMs) return interaction.reply({ content: '❌ Für die Aktion "Timeout" muss `dauer` gültig sein (z.B. 10m).', ephemeral: true });
    }

    const config = {};
    if (rule === 'wordfilter') {
      config.words = (woerter ?? '').split(',').map(w => w.trim().toLowerCase()).filter(Boolean);
    }

    await db.upsertRule(guildId, rule, {
      enabled,
      config,
      action: { type: actionType, durationMs, points: punkte },
    });

    return interaction.reply({ content: `✅ Regel **${rule}** wurde ${enabled ? 'aktiviert' : 'deaktiviert'}.`, ephemeral: true });
  },
};
