'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../db');

async function syncRoles(guild, userId, { removeRoleId, addRoleId }) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return;
  if (removeRoleId && member.roles.cache.has(removeRoleId)) await member.roles.remove(removeRoleId).catch(() => {});
  if (addRoleId && !member.roles.cache.has(addRoleId)) await member.roles.add(addRoleId).catch(() => {});
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('team')
    .setDescription('Team-Hierarchie verwalten (nur Admins)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
      sub.setName('rang-erstellen')
         .setDescription('Erstellt einen neuen Team-Rang')
         .addStringOption(opt => opt.setName('name').setDescription('Name des Rangs').setRequired(true))
         .addIntegerOption(opt => opt.setName('level').setDescription('Hierarchie-Stufe (höher = höherrangig)').setRequired(true))
         .addRoleOption(opt => opt.setName('rolle').setDescription('Zugehörige Discord-Rolle').setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('rang-liste')
         .setDescription('Listet alle Team-Ränge auf'))
    .addSubcommand(sub =>
      sub.setName('mitglieder')
         .setDescription('Zeigt das Team-Roster'))
    .addSubcommand(sub =>
      sub.setName('befoerdern')
         .setDescription('Befördert/setzt ein Teammitglied auf einen Rang')
         .addUserOption(opt => opt.setName('user').setDescription('Welches Mitglied').setRequired(true))
         .addStringOption(opt => opt.setName('rang').setDescription('Zielrang').setRequired(true).setAutocomplete(true))
         .addStringOption(opt => opt.setName('grund').setDescription('Grund').setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('degradieren')
         .setDescription('Setzt ein Teammitglied auf einen niedrigeren Rang')
         .addUserOption(opt => opt.setName('user').setDescription('Welches Mitglied').setRequired(true))
         .addStringOption(opt => opt.setName('rang').setDescription('Zielrang').setRequired(true).setAutocomplete(true))
         .addStringOption(opt => opt.setName('grund').setDescription('Grund').setRequired(false))),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const ranks = await db.getRanks(interaction.guild.id);
    const filtered = ranks.filter(r => r.name.toLowerCase().includes(focused)).slice(0, 25);
    await interaction.respond(filtered.map(r => ({ name: `${r.name} (Level ${r.level})`, value: r.name })));
  },

  async execute(interaction) {
    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'rang-erstellen') {
      const name  = interaction.options.getString('name', true);
      const level = interaction.options.getInteger('level', true);
      const rolle = interaction.options.getRole('rolle');

      if (await db.getRankByName(guildId, name)) {
        return interaction.reply({ content: '❌ Es gibt bereits einen Rang mit diesem Namen.', ephemeral: true });
      }
      await db.createRank(guildId, { name, level, roleId: rolle?.id });
      return interaction.reply({ content: `✅ Rang **${name}** (Level ${level}) erstellt.`, ephemeral: true });
    }

    if (sub === 'rang-liste') {
      const ranks = await db.getRanks(guildId);
      if (ranks.length === 0) return interaction.reply({ content: 'Noch keine Ränge konfiguriert.', ephemeral: true });
      const lines = ranks.map(r => `**${r.name}** — Level ${r.level}${r.role_id ? ` — <@&${r.role_id}>` : ''}`);
      return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🏅 Team-Ränge').setDescription(lines.join('\n')).setColor(0x5865F2)], ephemeral: true });
    }

    if (sub === 'mitglieder') {
      const members = await db.getMembersByGuild(guildId);
      if (members.length === 0) return interaction.reply({ content: 'Noch keine Teammitglieder erfasst.', ephemeral: true });
      const lines = members.map(m => `<@${m.user_id}> — **${m.rank_name}** (seit ${new Date(m.since).toLocaleDateString('de-AT')})`);
      return interaction.reply({ embeds: [new EmbedBuilder().setTitle('👥 Team-Roster').setDescription(lines.join('\n')).setColor(0x5865F2)], ephemeral: true });
    }

    // befoerdern / degradieren share the same logic — the distinction is purely
    // cosmetic (the command name the staff member picked), the DB doesn't care.
    if (sub === 'befoerdern' || sub === 'degradieren') {
      const targetUser = interaction.options.getUser('user', true);
      const rankName   = interaction.options.getString('rang', true);
      const reason      = interaction.options.getString('grund');

      const rank = await db.getRankByName(guildId, rankName);
      if (!rank) return interaction.reply({ content: '❌ Unbekannter Rang.', ephemeral: true });

      const current = await db.getMember(guildId, targetUser.id);
      await db.upsertMember(guildId, targetUser.id, rank.id);
      await db.addRankHistory({
        guildId, userId: targetUser.id, oldRank: current?.rank_name ?? null,
        newRank: rank.name, changedBy: interaction.user.id, reason,
      });

      await syncRoles(interaction.guild, targetUser.id, {
        removeRoleId: current?.rank_role_id, addRoleId: rank.role_id,
      });

      const verb = sub === 'befoerdern' ? '⬆️ Befördert' : '⬇️ Degradiert';
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle(verb)
          .setColor(sub === 'befoerdern' ? 0x57F287 : 0xED4245)
          .addFields(
            { name: 'Mitglied', value: `${targetUser}`, inline: true },
            { name: 'Von',      value: current?.rank_name ?? '–', inline: true },
            { name: 'Zu',       value: rank.name, inline: true },
            ...(reason ? [{ name: 'Grund', value: reason, inline: false }] : []),
          )],
      });
    }
  },
};
