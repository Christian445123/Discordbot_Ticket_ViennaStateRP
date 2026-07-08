'use strict';

const {
  Events,
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
const db = require('../../database/db');

// ── Helper: close a ticket ────────────────────────────────────────────────────
async function closeTicket(interaction, ticket) {
  const { guild } = interaction;
  const closedBy = interaction.user;

  db.closeTicket.run({
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
  const guildCfg = db.getGuild.get(guild.id);
  if (guildCfg?.log_channel_id) {
    const logCh = guild.channels.cache.get(guildCfg.log_channel_id);
    if (logCh) {
      const messages = db.getMessages.all(ticket.id);
      const transcript = messages
        .map(m => `[${m.created_at}] ${m.username}: ${m.content}`)
        .join('\n') || '(keine Nachrichten)';

      const logEmbed = new EmbedBuilder()
        .setTitle('📋 Ticket geschlossen')
        .setColor(0xED4245)
        .addFields(
          { name: 'Ticket-Nr.',  value: `#${String(ticket.ticket_number).padStart(4, '0')}`, inline: true },
          { name: 'Erstellt von', value: `<@${ticket.user_id}>`,                             inline: true },
          { name: 'Geschlossen von', value: `${closedBy.tag}`,                               inline: true },
          { name: 'Nachrichten', value: `${messages.length}`,                                inline: true },
        )
        .setTimestamp();

      const transcriptBuf = Buffer.from(transcript, 'utf-8');
      await logCh.send({
        embeds: [logEmbed],
        files: [{
          attachment: transcriptBuf,
          name: `transcript-${ticket.id}.txt`,
        }],
      });
    }
  }

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

  db.ensureGuild.run(guild.id);

  // Prevent duplicate open ticket
  const existing = db.getOpenTicketByUser.get(guild.id, user.id);
  if (existing) {
    const ch = guild.channels.cache.get(existing.channel_id);
    const ref = ch ? `${ch}` : `#${String(existing.ticket_number).padStart(4, '0')}`;
    return interaction.reply({
      content: `❌ Du hast bereits ein offenes Ticket: ${ref}`,
      ephemeral: true,
    });
  }

  db.incrementTicketCount.run(guild.id);
  const { ticket_count } = db.getTicketCount.get(guild.id);
  const guildCfg = db.getGuild.get(guild.id);

  // Insert ticket record (channel_id set after channel creation)
  const result = db.createTicket.run({
    ticket_number: ticket_count,
    guild_id:      guild.id,
    channel_id:    null,
    user_id:       user.id,
    username:      user.tag,
    category,
    subject: subject || '(kein Betreff)',
  });
  const ticketId = result.lastInsertRowid;

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

  const channel = await guild.channels.create({
    name:              `ticket-${String(ticket_count).padStart(4, '0')}`,
    type:              ChannelType.GuildText,
    parent:            guildCfg?.ticket_category_id ?? null,
    permissionOverwrites: overwrites,
    topic:             `Ticket von ${user.tag} | Kategorie: ${category} | ID: ${ticketId}`,
  });

  db.updateTicketChannel.run(channel.id, ticketId);

  // Welcome embed + close button
  const embed = new EmbedBuilder()
    .setTitle(`🎫 Ticket #${String(ticket_count).padStart(4, '0')}`)
    .setColor(0x5865F2)
    .addFields(
      { name: 'Erstellt von', value: `${user}`,   inline: true },
      { name: 'Kategorie',    value: category,     inline: true },
      { name: 'Betreff',      value: subject || '(kein Betreff)', inline: false },
    )
    .setTimestamp()
    .setFooter({ text: 'Support-System' });

  const closeBtn = new ButtonBuilder()
    .setCustomId('close_ticket')
    .setLabel('Ticket schließen')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('🔒');

  const row = new ActionRowBuilder().addComponents(closeBtn);

  await channel.send({
    content: `${user} Willkommen! Ein Teammitglied wird sich bald melden.`,
    embeds: [embed],
    components: [row],
  });

  // Log channel
  if (guildCfg?.log_channel_id) {
    const logCh = guild.channels.cache.get(guildCfg.log_channel_id);
    if (logCh) {
      const logEmbed = new EmbedBuilder()
        .setTitle('📋 Ticket erstellt')
        .setColor(0x57F287)
        .addFields(
          { name: 'Ticket',       value: `${channel}`,     inline: true },
          { name: 'Benutzer',     value: user.tag,          inline: true },
          { name: 'Kategorie',    value: category,           inline: true },
        )
        .setTimestamp();
      logCh.send({ embeds: [logEmbed] }).catch(() => {});
    }
  }

  await interaction.reply({
    content: `✅ Dein Ticket wurde erstellt: ${channel}`,
    ephemeral: true,
  });
}

// ── Event handler ─────────────────────────────────────────────────────────────
module.exports = {
  name: Events.InteractionCreate,

  async execute(interaction) {

    // ── Slash commands ──────────────────────────────────────────────────────
    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) return;
      try {
        await command.execute(interaction);
      } catch (err) {
        console.error(err);
        const msg = { content: '❌ Fehler beim Ausführen des Befehls.', ephemeral: true };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(msg);
        } else {
          await interaction.reply(msg);
        }
      }
      return;
    }

    // ── Category select menu (from panel) ───────────────────────────────────
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_category') {
      const category = interaction.values[0];

      const modal = new ModalBuilder()
        .setCustomId(`ticket_modal_${category}`)
        .setTitle('Ticket erstellen');

      const subjectInput = new TextInputBuilder()
        .setCustomId('ticket_subject')
        .setLabel('Betreff')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Kurze Beschreibung deines Anliegens')
        .setRequired(true)
        .setMaxLength(100);

      const descInput = new TextInputBuilder()
        .setCustomId('ticket_description')
        .setLabel('Beschreibung')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Beschreibe dein Anliegen so genau wie möglich…')
        .setRequired(false)
        .setMaxLength(1000);

      modal.addComponents(
        new ActionRowBuilder().addComponents(subjectInput),
        new ActionRowBuilder().addComponents(descInput),
      );

      await interaction.showModal(modal);
      return;
    }

    // ── Modal submit ────────────────────────────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_modal_')) {
      const category    = interaction.customId.replace('ticket_modal_', '');
      const subject     = interaction.fields.getTextInputValue('ticket_subject');
      const description = interaction.fields.getTextInputValue('ticket_description');
      const fullSubject = description ? `${subject}\n\n${description}` : subject;

      await createTicketChannel(interaction, category, fullSubject);
      return;
    }

    // ── Button: close ticket (initial request) ──────────────────────────────
    if (interaction.isButton() && interaction.customId === 'close_ticket') {
      const ticket = db.getTicketByChannel.get(interaction.channel.id);
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
      const ticket   = db.getTicketById.get(ticketId);
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
  },
};
