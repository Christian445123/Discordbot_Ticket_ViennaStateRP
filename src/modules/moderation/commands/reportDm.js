'use strict';

// Right-click → Apps → "Nachricht melden (DM)" on a message a Team/High
// Team member received by DM — the fast alternative to typing out
// /mod dm-melden by hand. Discord hands the bot the content of exactly
// this one flagged message as part of the interaction payload, which is
// what makes this possible at all — a bot can otherwise never see DMs
// between two other users (see commands/mod.js's dm-melden subcommand,
// which exists for exactly that reason: there's no way to detect this
// automatically, only to let staff report it after the fact).
//
// Context.Guild works out of the box with normal bot installation.
// Context.PrivateChannel (actually invoking this from inside the DM
// itself, outside any server) additionally requires "User Install" to be
// enabled for this application in the Discord Developer Portal — a
// one-time setup step outside this codebase. Without that, the menu entry
// simply won't show up while right-clicking inside a DM; it still works
// fine from within the server either way.

const { ContextMenuCommandBuilder, ApplicationCommandType, InteractionContextType, ApplicationIntegrationType, EmbedBuilder } = require('discord.js');
const db      = require('../db');
const actions = require('../actions');
const { isModerator } = require('../isModerator');

// A context menu command used from inside a DM (PrivateChannel context)
// has no interaction.guild/interaction.member of its own, so there's
// nothing to check permissions or look up moderator_role_ids against —
// find a guild (shared with the bot) where the reporting user actually
// holds the moderator role instead. Picks the first match; a staff member
// who's moderator in more than one mutual guild is an edge case not worth
// resolving further here.
async function findModeratorGuild(client, userId) {
  for (const guild of client.guilds.cache.values()) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) continue;
    const cfg = await db.getConfig(guild.id);
    if (cfg && isModerator(member, cfg)) return { guild, cfg };
  }
  return null;
}

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Nachricht melden (DM)')
    .setType(ApplicationCommandType.Message)
    .setContexts(InteractionContextType.Guild, InteractionContextType.PrivateChannel)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall),

  async execute(interaction) {
    const reportedUser = interaction.targetMessage.author;

    if (reportedUser.bot || reportedUser.id === interaction.user.id) {
      return interaction.reply({ content: '❌ Diese Nachricht kann nicht gemeldet werden.', ephemeral: true });
    }

    let guild, cfg;
    if (interaction.guild) {
      guild = interaction.guild;
      cfg   = await db.getConfig(guild.id);
      if (!isModerator(interaction.member, cfg)) {
        return interaction.reply({ content: '❌ Nur Team/High Team kann diese Nachricht melden.', ephemeral: true });
      }
    } else {
      const found = await findModeratorGuild(interaction.client, interaction.user.id);
      if (!found) {
        return interaction.reply({ content: '❌ Du bist in keinem Server, auf dem dieser Bot läuft, Team/High Team.', ephemeral: true });
      }
      ({ guild, cfg } = found);
    }

    const snippet = interaction.targetMessage.content
      ? `"${interaction.targetMessage.content.slice(0, 300)}"`
      : '(kein Textinhalt, z. B. nur ein Anhang)';
    const reason = `Unerlaubte Kontaktaufnahme per Direktnachricht an ein Teammitglied (gemeldet von ${interaction.user.tag}). Nachricht: ${snippet}`;

    const { caseRow, escalationCase } = await actions.warn(
      interaction.client, guild, reportedUser, reason, interaction.user.id, interaction.user.tag,
    );

    try {
      await reportedUser.send(
        '⚠️ Du wurdest verwarnt: Ein Teammitglied per Direktnachricht zu kontaktieren ist nicht erlaubt. '
        + `Nutze stattdessen ein Ticket oder den passenden Kanal auf dem Server. (Fall #${caseRow.case_number})`,
      );
    } catch (_) { /* DMs können blockiert sein — Verwarnung steht trotzdem */ }

    const embed = new EmbedBuilder()
      .setTitle('📨 DM-Kontakt gemeldet & Nutzer verwarnt')
      .setColor(0x57F287)
      .addFields(
        { name: 'Fall',      value: `#${caseRow.case_number}`, inline: true },
        { name: 'Nutzer',    value: `<@${caseRow.user_id}>`,    inline: true },
        { name: 'Server',    value: guild.name,                 inline: true },
        { name: 'Nachricht', value: snippet,                    inline: false },
      );
    if (escalationCase) {
      const duration    = actions.formatDuration(escalationCase.duration_minutes);
      const actionLabel = duration ? `${escalationCase.action} (${duration})` : escalationCase.action;
      embed.addFields({
        name:  '🚨 Automatische Eskalation ausgelöst',
        value: `${actionLabel} — Fall #${escalationCase.case_number}`,
      });
    }
    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
