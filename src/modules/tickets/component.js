'use strict';

const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');
const db             = require('./db');
const ticketLog      = require('./ticketLog');
const categoryNotify = require('./categoryNotify');
const questions      = require('./questions');

// ── Helper: close a ticket ────────────────────────────────────────────────────
async function closeTicket(interaction, ticket) {
  const { guild } = interaction;
  const closedBy = interaction.user;

  await db.closeTicket({
    id:             ticket.id,
    closed_by_id:   closedBy.id,
    closed_by_name: closedBy.tag,
  });

  // Send closing message in channel
  const closeEmbed = new EmbedBuilder()
    .setTitle('🔒 Ticket geschlossen')
    .setDescription(`Dieses Ticket wurde von ${closedBy} geschlossen.`)
    .setColor(0xED4245)
    .setTimestamp();

  await interaction.channel.send({ embeds: [closeEmbed] });

  // Log to log channel
  await ticketLog.logTicketClosed(interaction.client, guild.id, {
    ticket,
    closedByTag: closedBy.tag,
    source: '🎮 Discord',
  });

  // Lock channel, then delete after 5 seconds
  try {
    await interaction.channel.permissionOverwrites.edit(guild.id, {
      SendMessages: false,
      ViewChannel: false,
    });
  } catch (_) { /* channel may already be gone */ }

  setTimeout(async () => {
    try { await interaction.channel.delete(); } catch (_) { /* ignore */ }
  }, 5000);
}

// ── Helper: create ticket channel ─────────────────────────────────────────────
async function createTicketChannel(interaction, category, subject) {
  const { guild, user } = interaction;

  await db.ensureGuildWithDefaults(guild.id);

  // Prevent duplicate open ticket
  const existing = await db.getOpenTicketByUser(guild.id, user.id);
  if (existing) {
    const ch = guild.channels.cache.get(existing.channel_id);
    const ref = ch ? `${ch}` : `#${String(existing.ticket_number).padStart(4, '0')}`;
    return interaction.reply({
      content: `❌ Du hast bereits ein offenes Ticket: ${ref}`,
      ephemeral: true,
    });
  }

  await db.incrementTicketCount(guild.id);
  const { ticket_count } = await db.getTicketCount(guild.id);
  const guildCfg = await db.getGuild(guild.id);

  // Insert ticket record (channel_id set after channel creation)
  const result = await db.createTicket({
    ticket_number: ticket_count,
    guild_id:      guild.id,
    channel_id:    null,
    user_id:       user.id,
    username:      user.tag,
    category,
    subject: subject || '(kein Betreff)',
  });
  const ticketId = result.lastInsertRowid;

  const categoryCfg = await db.getCategoryByName(guild.id, category);

  // Build permission overwrites
  const overwrites = [
    { id: guild.id,           deny:  [PermissionFlagsBits.ViewChannel] },
    { id: user.id,            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] },
  ];
  if (guildCfg?.staff_role_id) {
    overwrites.push({
      id:    guildCfg.staff_role_id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    });
  }
  // Make sure a category's ping target can actually see the channel it gets pinged into
  if (categoryCfg?.ping_target_id && !overwrites.some(o => o.id === categoryCfg.ping_target_id)) {
    overwrites.push({
      id:    categoryCfg.ping_target_id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    });
  }

  const channel = await guild.channels.create({
    name:              `ticket-${String(ticket_count).padStart(4, '0')}`,
    type:              ChannelType.GuildText,
    parent:            guildCfg?.ticket_category_id ?? null,
    permissionOverwrites: overwrites,
    topic:             `Ticket von ${user.tag} | Kategorie: ${category} | ID: ${ticketId}`,
  });

  await db.updateTicketChannel(channel.id, ticketId);

  // Welcome embed + close button
  const embed = new EmbedBuilder()
    .setAuthor({ name: `${categoryCfg?.emoji || '🎫'} ${category}` })
    .setTitle('🎫 Ticket eröffnet')
    .setDescription(categoryCfg?.welcome_message || 'Willkommen! Ein Teammitglied wird sich bald melden.')
    .setColor(0x5865F2)
    .addFields(
      { name: '👤 Erstellt von', value: `${user}`,  inline: true },
      { name: '🏷️ Kategorie',    value: category,    inline: true },
      { name: '📌 Status',       value: '🟢 Offen',  inline: true },
      { name: '📝 Angaben',      value: subject || '(keine Angaben)', inline: false },
    )
    .setThumbnail(guild.iconURL() ?? null)
    .setFooter({ text: `Ticket #${String(ticket_count).padStart(4, '0')} · Support-System` })
    .setTimestamp();

  const closeBtn = new ButtonBuilder()
    .setCustomId('close_ticket')
    .setLabel('Ticket schließen')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('🔒');

  const row = new ActionRowBuilder().addComponents(closeBtn);

  const pingMention = categoryNotify.buildPingMention(categoryCfg);
  await channel.send({
    content: `${user}${pingMention ? ` ${pingMention}` : ''}`,
    embeds: [embed],
    components: [row],
  });

  await categoryNotify.applyCategoryExtras(interaction.client, guild.id, {
    categoryName: category, channel, userId: user.id,
  });

  // Log channel
  await ticketLog.logTicketCreated(interaction.client, guild.id, {
    channel,
    username: user.tag,
    category,
    source: '🎮 Discord',
  });

  await interaction.reply({
    content: `✅ Dein Ticket wurde erstellt: ${channel}`,
    ephemeral: true,
  });
}

// ── Component handler (buttons/selects/modals) ────────────────────────────────
// Slash-command dispatch and autocomplete are handled centrally by
// src/core/interactionRouter.js — this only ever sees buttons/selects/
// modals, and only reacts to the "ticket_"/"close_"/"cancel_close"/
// "confirm_close_" customIds it owns.
async function component(interaction) {

    // ── Category select menu (from panel) ───────────────────────────────────
    // Each category can define up to 5 of its own questions (see
    // src/modules/tickets/questions.js); categories without custom
    // questions fall back to the classic Betreff/Beschreibung pair.
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_category') {
      const category    = interaction.values[0];
      const categoryCfg = await db.getCategoryByName(interaction.guild.id, category);
      const qs           = questions.resolveQuestions(categoryCfg);

      const modal = new ModalBuilder()
        .setCustomId(`ticket_modal_${category}`)
        .setTitle('Ticket erstellen');

      modal.addComponents(qs.map((q, i) => new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(`ticket_q_${i}`)
          .setLabel(q.label)
          .setStyle(q.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
          .setRequired(q.required)
          .setMaxLength(q.style === 'paragraph' ? 1000 : 100),
      )));

      await interaction.showModal(modal);
      return;
    }

    // ── Modal submit ────────────────────────────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_modal_')) {
      const category    = interaction.customId.replace('ticket_modal_', '');
      const categoryCfg = await db.getCategoryByName(interaction.guild.id, category);
      const qs           = questions.resolveQuestions(categoryCfg);
      const values       = qs.map((_, i) => {
        try { return interaction.fields.getTextInputValue(`ticket_q_${i}`); } catch { return ''; }
      });
      const subject = questions.formatAnswers(qs, values);

      await createTicketChannel(interaction, category, subject);
      return;
    }

    // ── Button: close ticket (initial request) ──────────────────────────────
    if (interaction.isButton() && interaction.customId === 'close_ticket') {
      const ticket = await db.getTicketByChannel(interaction.channel.id);
      if (!ticket || ticket.status === 'closed') {
        return interaction.reply({ content: '❌ Ticket nicht gefunden oder bereits geschlossen.', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle('🔒 Ticket schließen?')
        .setDescription('Möchtest du dieses Ticket wirklich schließen?')
        .setColor(0xFEE75C);

      const confirm = new ButtonBuilder()
        .setCustomId(`confirm_close_${ticket.id}`)
        .setLabel('Ja, schließen')
        .setStyle(ButtonStyle.Danger);

      const cancel = new ButtonBuilder()
        .setCustomId('cancel_close')
        .setLabel('Abbrechen')
        .setStyle(ButtonStyle.Secondary);

      await interaction.reply({
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(confirm, cancel)],
        ephemeral: true,
      });
      return;
    }

    // ── Button: confirm close ───────────────────────────────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('confirm_close_')) {
      const ticketId = parseInt(interaction.customId.replace('confirm_close_', ''), 10);
      const ticket   = await db.getTicketById(ticketId);
      if (!ticket || ticket.status === 'closed') {
        return interaction.reply({ content: '❌ Ticket bereits geschlossen.', ephemeral: true });
      }
      await interaction.deferUpdate();
      await closeTicket(interaction, ticket);
      return;
    }

    // ── Button: cancel close ────────────────────────────────────────────────
    if (interaction.isButton() && interaction.customId === 'cancel_close') {
      await interaction.reply({ content: 'Schließen abgebrochen.', ephemeral: true });
      return;
    }
}

module.exports = { component };
