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
const pingRoles      = require('./pingRoles');
const { isTicketStaff } = require('./staffCheck');
const ticketEmbed = require('./ticketEmbed');

// Discord channel names only allow lowercase letters/digits/hyphens (it
// silently strips/mangles anything else), so a category name like "Bewerbung"
// or "Bug-Report" needs turning into "bewerbung"/"bug-report" first. Handles
// German umlauts explicitly rather than just dropping them, since category
// names are admin-entered German text.
function slugifyCategoryName(name) {
  // Any other diacritic/symbol just falls through to the generic strip below.
  const slug = String(name)
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'ticket';
}

function formatTicketNumber(ticketNumber) {
  return String(ticketNumber).padStart(3, '0');
}

// Shared by ticket creation (always starts un-held) and the "Warte auf
// Rückmeldung" toggle handler, which rebuilds this row with the flipped
// label/style instead of just editing the embed, so the button itself
// reflects the current state too.
function buildTicketButtonsRow(onHold) {
  const closeBtn = new ButtonBuilder()
    .setCustomId('close_ticket')
    .setLabel('Ticket schließen')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('🔒');

  const claimBtn = new ButtonBuilder()
    .setCustomId('claim_ticket')
    .setLabel('Übernehmen')
    .setStyle(ButtonStyle.Success)
    .setEmoji('🖐️');

  const askCloseBtn = new ButtonBuilder()
    .setCustomId('ask_close_ticket')
    .setLabel('Nachfragen')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('❓');

  const holdBtn = onHold
    ? new ButtonBuilder().setCustomId('toggle_hold_ticket').setLabel('Warten beenden').setStyle(ButtonStyle.Primary).setEmoji('▶️')
    : new ButtonBuilder().setCustomId('toggle_hold_ticket').setLabel('Warte auf Rückmeldung').setStyle(ButtonStyle.Secondary).setEmoji('⏸️');

  return new ActionRowBuilder().addComponents(closeBtn, claimBtn, askCloseBtn, holdBtn);
}

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

  const categoryCfg = await db.getCategoryByName(guild.id, category);

  // Per-category limit on simultaneously open tickets (categories.max_open_tickets,
  // configurable via /kategorie-config or the web panel; null = unlimited). A
  // user can have open tickets in several categories at once, each up to its
  // own category's limit — there is no separate server-wide cap.
  if (categoryCfg?.max_open_tickets != null) {
    const openInCategory = await db.getOpenTicketsByUserAndCategory(guild.id, user.id, category);
    if (openInCategory.length >= categoryCfg.max_open_tickets) {
      const blocking = openInCategory[0];
      const ch  = guild.channels.cache.get(blocking.channel_id);
      const ref = ch ? `${ch}` : `${slugifyCategoryName(category)}-${formatTicketNumber(blocking.ticket_number)}`;
      return interaction.reply({
        content: `❌ Du hast bereits das Maximum von ${categoryCfg.max_open_tickets} offenen Ticket(s) in der Kategorie **${category}** erreicht: ${ref}`,
        ephemeral: true,
      });
    }
  }

  // Ticket numbers (and the channel name below) are sequential per category —
  // "Bewerbung-001" is the first ticket ever opened in "Bewerbung", regardless
  // of how many tickets other categories have had.
  await db.incrementCategoryTicketCount(guild.id, category);
  const updatedCategoryCfg = await db.getCategoryByName(guild.id, category);
  const guildCfg      = await db.getGuild(guild.id);
  const ticketNumber  = updatedCategoryCfg?.ticket_count ?? 1;

  // Insert ticket record (channel_id set after channel creation)
  const result = await db.createTicket({
    ticket_number: ticketNumber,
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
  // Make sure a category's ping target(s) can actually see the channel they get pinged into
  const pingTargetIds = categoryCfg?.ping_type === 'role'
    ? pingRoles.parseStoredPingRoleIds(categoryCfg.ping_role_ids)
    : (categoryCfg?.ping_type === 'user' && categoryCfg.ping_target_id ? [categoryCfg.ping_target_id] : []);
  for (const id of pingTargetIds) {
    if (!overwrites.some(o => o.id === id)) {
      overwrites.push({
        id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      });
    }
  }

  const channel = await guild.channels.create({
    name:              `${slugifyCategoryName(category)}-${formatTicketNumber(ticketNumber)}`,
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
    .setFooter({ text: `Ticket #${formatTicketNumber(ticketNumber)} · Support-System` })
    .setTimestamp();

  const row = buildTicketButtonsRow(false);

  const pingMention = categoryNotify.buildPingMention(categoryCfg);
  const welcomeMsg = await channel.send({
    content: `${user}${pingMention ? ` ${pingMention}` : ''}`,
    embeds: [embed],
    components: [row],
  });
  await db.updateTicketWelcomeMessage(ticketId, welcomeMsg.id);

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
// "confirm_close_"/"claim_ticket"/"ask_close_ticket" customIds it owns.
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

    // ── Button: claim ticket ─────────────────────────────────────────────────
    // "In Bearbeitung" isn't a stored status — it's status='open' with
    // claimed_by_id set (see db.js). Re-claiming (by someone else) is allowed
    // and simply reassigns, since that's a normal "take over" use case.
    if (interaction.isButton() && interaction.customId === 'claim_ticket') {
      const ticket = await db.getTicketByChannel(interaction.channel.id);
      if (!ticket || ticket.status === 'closed') {
        return interaction.reply({ content: '❌ Ticket nicht gefunden oder bereits geschlossen.', ephemeral: true });
      }

      const guildCfg    = await db.getGuild(interaction.guild.id);
      const categoryCfg = await db.getCategoryByName(interaction.guild.id, ticket.category);
      if (!isTicketStaff(interaction.member, guildCfg, categoryCfg)) {
        return interaction.reply({ content: '❌ Nur Staff kann Tickets übernehmen.', ephemeral: true });
      }

      await db.claimTicket(ticket.id, { claimedById: interaction.user.id, claimedByName: interaction.user.tag });

      // The Claim button lives on the welcome message itself, so no lookup
      // is needed here (contrast routes.js's claim route, which has to fetch
      // it by tickets.welcome_message_id instead).
      await ticketEmbed.refreshWelcomeEmbedStatus(interaction.message, {
        ...ticket, claimed_by_id: interaction.user.id, claimed_by_name: interaction.user.tag,
      });

      await interaction.reply({
        content: `🖐️ ${interaction.user} hat dieses Ticket übernommen. Status: **In Bearbeitung**`,
      });

      await ticketLog.logTicketClaimed(interaction.client, interaction.guild.id, {
        ticket, claimedByTag: interaction.user.tag, source: '🎮 Discord',
      });
      return;
    }

    // ── Button: ask ticket opener whether it can be closed ──────────────────
    // Public prompt (not ephemeral) so the ticket opener actually sees it and
    // can respond — reuses the same confirm_close_/cancel_close customIds the
    // direct "Ticket schließen" flow uses, so no separate handler is needed.
    if (interaction.isButton() && interaction.customId === 'ask_close_ticket') {
      const ticket = await db.getTicketByChannel(interaction.channel.id);
      if (!ticket || ticket.status === 'closed') {
        return interaction.reply({ content: '❌ Ticket nicht gefunden oder bereits geschlossen.', ephemeral: true });
      }

      const guildCfg    = await db.getGuild(interaction.guild.id);
      const categoryCfg = await db.getCategoryByName(interaction.guild.id, ticket.category);
      if (!isTicketStaff(interaction.member, guildCfg, categoryCfg)) {
        return interaction.reply({ content: '❌ Nur Staff kann nachfragen, ob das Ticket geschlossen werden soll.', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle('❓ Ticket schließen?')
        .setDescription(`${interaction.user} möchte wissen, ob dieses Ticket geschlossen werden kann.`)
        .setColor(0xFEE75C);

      const yes = new ButtonBuilder()
        .setCustomId(`confirm_close_${ticket.id}`)
        .setLabel('Ja, schließen')
        .setStyle(ButtonStyle.Danger);

      const no = new ButtonBuilder()
        .setCustomId('cancel_close')
        .setLabel('Nein, offen lassen')
        .setStyle(ButtonStyle.Secondary);

      await interaction.reply({
        content: `<@${ticket.user_id}>`,
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(yes, no)],
      });
      return;
    }

    // ── Button: toggle "Warte auf Rückmeldung" (on hold) ─────────────────────
    // Orthogonal to claimed_by_id — a ticket can be claimed AND on hold at
    // once (see db.js) — toggled purely explicitly, same as Claim. Rebuilds
    // the whole button row (not just the embed) so the button's own label
    // flips between "Warte auf Rückmeldung" and "Warten beenden".
    if (interaction.isButton() && interaction.customId === 'toggle_hold_ticket') {
      const ticket = await db.getTicketByChannel(interaction.channel.id);
      if (!ticket || ticket.status === 'closed') {
        return interaction.reply({ content: '❌ Ticket nicht gefunden oder bereits geschlossen.', ephemeral: true });
      }

      const guildCfg    = await db.getGuild(interaction.guild.id);
      const categoryCfg = await db.getCategoryByName(interaction.guild.id, ticket.category);
      if (!isTicketStaff(interaction.member, guildCfg, categoryCfg)) {
        return interaction.reply({ content: '❌ Nur Staff kann den Warte-Status ändern.', ephemeral: true });
      }

      const turningOn = !ticket.on_hold_by_id;
      if (turningOn) {
        await db.setTicketOnHold(ticket.id, { onHoldById: interaction.user.id, onHoldByName: interaction.user.tag });
      } else {
        await db.clearTicketOnHold(ticket.id);
      }

      const updatedTicket = turningOn
        ? { ...ticket, on_hold_by_id: interaction.user.id, on_hold_by_name: interaction.user.tag }
        : { ...ticket, on_hold_by_id: null, on_hold_by_name: null };

      try {
        const [oldEmbed] = interaction.message.embeds;
        if (oldEmbed) {
          const embed = ticketEmbed.buildStatusEmbed(oldEmbed, ticketEmbed.computeStatusText(updatedTicket));
          await interaction.message.edit({ embeds: [embed], components: [buildTicketButtonsRow(turningOn)] });
        }
      } catch (err) { /* best-effort — the DB change above already stuck */ }

      await interaction.reply({
        content: turningOn
          ? `⏸️ ${interaction.user} hat auf **Warte auf Rückmeldung** gesetzt.`
          : `▶️ ${interaction.user} hat den Warte-Status aufgehoben.`,
      });

      await ticketLog.logTicketHoldChanged(interaction.client, interaction.guild.id, {
        ticket, changedByTag: interaction.user.tag, onHold: turningOn, source: '🎮 Discord',
      });
      return;
    }
}

module.exports = { component };
