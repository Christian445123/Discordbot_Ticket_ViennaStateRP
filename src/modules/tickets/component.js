'use strict';

const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
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
const panelBuilder = require('./panelBuilder');

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

// Shared by ticket creation (always starts un-held/unclaimed) and the
// "Warte auf Rückmeldung" / claim toggle handlers, which rebuild this row
// with the flipped label/style instead of just editing the embed, so the
// buttons themselves reflect the current state too. Returns two rows
// (Discord caps a single row at 5 buttons) — "Mitglied hinzufügen" gets its
// own row since it's the one button here any ticket participant may use,
// not just staff.
function buildTicketButtonsRow(onHold, claimed) {
  const closeBtn = new ButtonBuilder()
    .setCustomId('close_ticket')
    .setLabel('Ticket schließen')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('🔒');

  const claimBtn = claimed
    ? new ButtonBuilder().setCustomId('release_ticket').setLabel('Freigeben').setStyle(ButtonStyle.Secondary).setEmoji('🔓')
    : new ButtonBuilder().setCustomId('claim_ticket').setLabel('Übernehmen').setStyle(ButtonStyle.Success).setEmoji('🖐️');

  const askCloseBtn = new ButtonBuilder()
    .setCustomId('ask_close_ticket')
    .setLabel('Nachfragen')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('❓');

  const holdBtn = onHold
    ? new ButtonBuilder().setCustomId('toggle_hold_ticket').setLabel('Warten beenden').setStyle(ButtonStyle.Primary).setEmoji('▶️')
    : new ButtonBuilder().setCustomId('toggle_hold_ticket').setLabel('Warte auf Rückmeldung').setStyle(ButtonStyle.Secondary).setEmoji('⏸️');

  const assignBtn = new ButtonBuilder()
    .setCustomId('assign_ticket')
    .setLabel('Zuweisen')
    .setStyle(ButtonStyle.Primary)
    .setEmoji('🎯');

  const addMemberBtn = new ButtonBuilder()
    .setCustomId('add_member_ticket')
    .setLabel('Mitglied hinzufügen')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('➕');

  return [
    new ActionRowBuilder().addComponents(closeBtn, claimBtn, askCloseBtn, holdBtn, assignBtn),
    new ActionRowBuilder().addComponents(addMemberBtn),
  ];
}

// ── Helper: close a ticket ────────────────────────────────────────────────────
// Decoupled from any interaction (client/guild/channel passed explicitly)
// so it works both from a button click (see the confirm_close_ handler
// below) and from a raw gateway event with no interaction at all — see
// events/guildMemberRemove.js, which closes a ticket automatically when
// its creator is kicked/banned/leaves.
async function closeTicket(client, guild, channel, ticket, closedByTag, closedById, closeMessage) {
  await db.closeTicket({
    id:             ticket.id,
    closed_by_id:   closedById,
    closed_by_name: closedByTag,
  });

  const closeEmbed = new EmbedBuilder()
    .setTitle('🔒 Ticket geschlossen')
    .setDescription(closeMessage || `Dieses Ticket wurde von ${closedByTag} geschlossen.`)
    .setColor(0xED4245)
    .setTimestamp();

  await channel.send({ embeds: [closeEmbed] }).catch(() => {});

  await ticketLog.logTicketClosed(client, guild.id, {
    ticket,
    closedByTag,
    source: '🎮 Discord',
  });

  // The panel's Auslastung numbers are based on open-ticket counts, so they
  // go stale the moment a ticket closes if we don't refresh here too.
  await panelBuilder.refreshPanel(client, guild.id);

  // Lock channel, then delete after 5 seconds
  try {
    await channel.permissionOverwrites.edit(guild.id, {
      SendMessages: false,
      ViewChannel: false,
    });
  } catch (_) { /* channel may already be gone */ }

  setTimeout(async () => {
    try { await channel.delete(); } catch (_) { /* ignore */ }
  }, 5000);
}

// ── Helper: create ticket channel ─────────────────────────────────────────────
// `guild` defaults to interaction.guild (the normal in-guild case: panel
// select menu, modal submit) but can be passed explicitly for an
// interaction that has no guild context of its own — e.g. a button click
// on a DM (see voiceSupport/component.js's "Supportticket erstellen"
// button, sent by waitRoom.sendClosedNotice), where the target guild is
// encoded in the customId instead.
async function createTicketChannel(interaction, category, subject, guild = interaction.guild) {
  const { user } = interaction;

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

  const rows = buildTicketButtonsRow(false, false);

  const pingMention = categoryNotify.buildPingMention(categoryCfg);
  const welcomeMsg = await channel.send({
    content: `${user}${pingMention ? ` ${pingMention}` : ''}`,
    embeds: [embed],
    components: rows,
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

  // The panel's Auslastung numbers are based on open-ticket counts, so they
  // go stale the moment a new ticket opens if we don't refresh here too.
  await panelBuilder.refreshPanel(interaction.client, guild.id);

  await interaction.reply({
    content: `✅ Dein Ticket wurde erstellt: ${channel}`,
    ephemeral: true,
  });
}

// ── Component handler (buttons/selects/modals) ────────────────────────────────
// Slash-command dispatch and autocomplete are handled centrally by
// src/core/interactionRouter.js — this only ever sees buttons/selects/
// modals, and only reacts to the "ticket_"/"close_"/"cancel_close"/
// "confirm_close_"/"claim_ticket"/"release_ticket"/"ask_close_ticket"/
// "manage_categories"/"manage_categories_toggle"/"assign_ticket"/
// "assign_ticket_select_"/"add_member_ticket"/"add_member_ticket_select"
// customIds it owns.
async function component(interaction) {

    // ── Button: manage categories (lock/unlock) from the panel ──────────────
    // Visible to everyone on the panel (Discord buttons can't be hidden
    // per-role), gated here instead — categoryCfg is null since this isn't
    // about one category's ping-role staff, just guild-wide staff/admins.
    if (interaction.isButton() && interaction.customId === 'manage_categories') {
      const guildCfg = await db.getGuild(interaction.guild.id);
      if (!isTicketStaff(interaction.member, guildCfg, null)) {
        return interaction.reply({ content: '❌ Nur Staff kann Kategorien sperren/entsperren.', ephemeral: true });
      }
      const payload = await panelBuilder.buildManageCategoriesPayload(interaction.guild);
      await interaction.reply({ ...payload, ephemeral: true });
      return;
    }

    // ── Select: toggle a category's locked status ────────────────────────────
    // Lives on the ephemeral message from the button above, so re-checking
    // staff here is defense-in-depth rather than a real requirement (only the
    // invoking user can ever see/use an ephemeral message).
    if (interaction.isStringSelectMenu() && interaction.customId === 'manage_categories_toggle') {
      const guildCfg = await db.getGuild(interaction.guild.id);
      if (!isTicketStaff(interaction.member, guildCfg, null)) {
        return interaction.reply({ content: '❌ Nur Staff kann Kategorien sperren/entsperren.', ephemeral: true });
      }

      const name     = interaction.values[0];
      const existing = await db.getCategoryByName(interaction.guild.id, name);
      if (!existing) return interaction.reply({ content: `❌ Kategorie **${name}** nicht gefunden.`, ephemeral: true });

      const locking = !existing.locked;
      await db.updateCategory(interaction.guild.id, name, { locked: locking ? 1 : 0 });

      await ticketLog.logCategoryConfigChanged(interaction.client, interaction.guild.id, {
        action: locking ? 'gesperrt' : 'entsperrt', name, changedByTag: interaction.user.tag,
      });
      await panelBuilder.refreshPanel(interaction.client, interaction.guild.id);

      const payload = await panelBuilder.buildManageCategoriesPayload(interaction.guild);
      await interaction.update({
        content:    `${locking ? '🔒' : '🟢'} Kategorie **${name}** wurde ${locking ? 'gesperrt' : 'entsperrt'}.\n\n${payload.content}`,
        components: payload.components,
      });
      return;
    }

    // ── Category select menu (from panel) ───────────────────────────────────
    // Each category can define up to 5 of its own questions (see
    // src/modules/tickets/questions.js); categories without custom
    // questions fall back to the classic Betreff/Beschreibung pair.
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_category') {
      const category    = interaction.values[0];
      const categoryCfg = await db.getCategoryByName(interaction.guild.id, category);

      // Locked categories are already excluded from the panel's dropdown
      // (see panelBuilder.js), but a stale/cached panel could still submit
      // one — re-check here so a locked category can never be opened.
      if (categoryCfg?.locked) {
        return interaction.reply({
          content: `🔒 Die Kategorie **${category}** ist derzeit gesperrt. Es können keine neuen Tickets erstellt werden.`,
          ephemeral: true,
        });
      }

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
      await closeTicket(interaction.client, interaction.guild, interaction.channel, ticket, interaction.user.tag, interaction.user.id);
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
    // and simply reassigns, since that's a normal "take over" use case. Once
    // claimed, this same button spot turns into "Freigeben" (see
    // buildTicketButtonsRow) — whoever claimed it (or any other staff) can
    // release it again for someone else to pick up (see release_ticket below).
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

      const updatedTicket = { ...ticket, claimed_by_id: interaction.user.id, claimed_by_name: interaction.user.tag };

      // The Claim button lives on the welcome message itself, so no lookup
      // is needed here (contrast routes.js's claim route, which has to fetch
      // it by tickets.welcome_message_id instead).
      try {
        const [oldEmbed] = interaction.message.embeds;
        if (oldEmbed) {
          const embed = ticketEmbed.buildStatusEmbed(oldEmbed, ticketEmbed.computeStatusText(updatedTicket));
          await interaction.message.edit({ embeds: [embed], components: buildTicketButtonsRow(!!ticket.on_hold_by_id, true) });
        }
      } catch (err) { /* best-effort — the DB change above already stuck */ }

      await interaction.reply({
        content: `🖐️ ${interaction.user} hat dieses Ticket übernommen. Status: **In Bearbeitung**`,
      });

      await ticketLog.logTicketClaimed(interaction.client, interaction.guild.id, {
        ticket, claimedByTag: interaction.user.tag, source: '🎮 Discord',
      });
      return;
    }

    // ── Button: release ticket ───────────────────────────────────────────────
    // Counterpart to "Übernehmen" — puts the ticket back to unclaimed so it
    // shows as open again and anyone (not just whoever claimed it) can pick
    // it up. Any staff member may release, same as any staff member may claim.
    if (interaction.isButton() && interaction.customId === 'release_ticket') {
      const ticket = await db.getTicketByChannel(interaction.channel.id);
      if (!ticket || ticket.status === 'closed') {
        return interaction.reply({ content: '❌ Ticket nicht gefunden oder bereits geschlossen.', ephemeral: true });
      }

      const guildCfg    = await db.getGuild(interaction.guild.id);
      const categoryCfg = await db.getCategoryByName(interaction.guild.id, ticket.category);
      if (!isTicketStaff(interaction.member, guildCfg, categoryCfg)) {
        return interaction.reply({ content: '❌ Nur Staff kann Tickets freigeben.', ephemeral: true });
      }

      await db.unclaimTicket(ticket.id);

      const updatedTicket = { ...ticket, claimed_by_id: null, claimed_by_name: null };

      try {
        const [oldEmbed] = interaction.message.embeds;
        if (oldEmbed) {
          const embed = ticketEmbed.buildStatusEmbed(oldEmbed, ticketEmbed.computeStatusText(updatedTicket));
          await interaction.message.edit({ embeds: [embed], components: buildTicketButtonsRow(!!ticket.on_hold_by_id, false) });
        }
      } catch (err) { /* best-effort — the DB change above already stuck */ }

      await interaction.reply({
        content: `🔓 ${interaction.user} hat dieses Ticket freigegeben. Status: **Offen**`,
      });

      await ticketLog.logTicketReleased(interaction.client, interaction.guild.id, {
        ticket, releasedByTag: interaction.user.tag, source: '🎮 Discord',
      });
      return;
    }

    // ── Button: assign ticket to a specific staff member ────────────────────
    // Unlike "Übernehmen" (self-claim), this lets staff hand a ticket to
    // someone else — stored in the same claimed_by_id/claimed_by_name fields,
    // since "assigned to" and "in Bearbeitung von" are the same state.
    if (interaction.isButton() && interaction.customId === 'assign_ticket') {
      const ticket = await db.getTicketByChannel(interaction.channel.id);
      if (!ticket || ticket.status === 'closed') {
        return interaction.reply({ content: '❌ Ticket nicht gefunden oder bereits geschlossen.', ephemeral: true });
      }

      const guildCfg    = await db.getGuild(interaction.guild.id);
      const categoryCfg = await db.getCategoryByName(interaction.guild.id, ticket.category);
      if (!isTicketStaff(interaction.member, guildCfg, categoryCfg)) {
        return interaction.reply({ content: '❌ Nur Staff kann Tickets zuweisen.', ephemeral: true });
      }

      const userSelect = new UserSelectMenuBuilder()
        .setCustomId(`assign_ticket_select_${ticket.id}`)
        .setPlaceholder('Person auswählen, der das Ticket zugewiesen werden soll…')
        .setMinValues(1)
        .setMaxValues(1);

      await interaction.reply({
        content: 'Wähle die Person aus, der dieses Ticket zugewiesen werden soll:',
        components: [new ActionRowBuilder().addComponents(userSelect)],
        ephemeral: true,
      });
      return;
    }

    // ── Select: target of "Zuweisen" chosen ──────────────────────────────────
    if (interaction.isUserSelectMenu() && interaction.customId.startsWith('assign_ticket_select_')) {
      const ticketId = parseInt(interaction.customId.replace('assign_ticket_select_', ''), 10);
      const ticket    = await db.getTicketById(ticketId);
      if (!ticket || ticket.status === 'closed') {
        return interaction.update({ content: '❌ Ticket nicht gefunden oder bereits geschlossen.', components: [] });
      }

      const guildCfg    = await db.getGuild(interaction.guild.id);
      const categoryCfg = await db.getCategoryByName(interaction.guild.id, ticket.category);
      if (!isTicketStaff(interaction.member, guildCfg, categoryCfg)) {
        return interaction.update({ content: '❌ Nur Staff kann Tickets zuweisen.', components: [] });
      }

      const target       = interaction.users.first();
      const targetMember = await interaction.guild.members.fetch(target.id).catch(() => null);
      if (!targetMember || !isTicketStaff(targetMember, guildCfg, categoryCfg)) {
        return interaction.update({
          content: `❌ ${target} ist kein Staff-Mitglied und kann diesem Ticket nicht zugewiesen werden.`,
          components: [],
        });
      }

      await db.claimTicket(ticket.id, { claimedById: target.id, claimedByName: target.tag });

      // Assigning doesn't imply the person could already see the channel
      // (contrast self-claim, where the clicker is already staff-visible).
      await interaction.channel.permissionOverwrites.edit(target.id, {
        ViewChannel: true, SendMessages: true, ReadMessageHistory: true,
      }).catch(() => {});

      const welcomeMsg = ticket.welcome_message_id
        ? await interaction.channel.messages.fetch(ticket.welcome_message_id).catch(() => null)
        : null;
      if (welcomeMsg) {
        try {
          const [oldEmbed] = welcomeMsg.embeds;
          if (oldEmbed) {
            const updatedTicket = { ...ticket, claimed_by_id: target.id, claimed_by_name: target.tag };
            const embed = ticketEmbed.buildStatusEmbed(oldEmbed, ticketEmbed.computeStatusText(updatedTicket));
            await welcomeMsg.edit({ embeds: [embed], components: buildTicketButtonsRow(!!ticket.on_hold_by_id, true) });
          }
        } catch (err) { /* best-effort — the DB change above already stuck */ }
      }

      await interaction.update({ content: `🎯 Ticket wurde ${target} zugewiesen.`, components: [] });
      await interaction.channel.send({ content: `🎯 ${interaction.user} hat dieses Ticket ${target} zugewiesen. Status: **In Bearbeitung**` });

      await ticketLog.logTicketClaimed(interaction.client, interaction.guild.id, {
        ticket, claimedByTag: target.tag, source: '🎮 Discord',
      });
      return;
    }

    // ── Button: add another Discord member to the ticket ────────────────────
    // Deliberately open to any ticket participant, not just staff — the
    // ticket opener is the main person expected to use this (e.g. pulling in
    // a friend or witness), so there is no isTicketStaff gate here.
    if (interaction.isButton() && interaction.customId === 'add_member_ticket') {
      const ticket = await db.getTicketByChannel(interaction.channel.id);
      if (!ticket || ticket.status === 'closed') {
        return interaction.reply({ content: '❌ Ticket nicht gefunden oder bereits geschlossen.', ephemeral: true });
      }

      const userSelect = new UserSelectMenuBuilder()
        .setCustomId('add_member_ticket_select')
        .setPlaceholder('Mitglied(er) auswählen…')
        .setMinValues(1)
        .setMaxValues(5);

      await interaction.reply({
        content: 'Wähle die Mitglieder aus, die zu diesem Ticket hinzugefügt werden sollen:',
        components: [new ActionRowBuilder().addComponents(userSelect)],
        ephemeral: true,
      });
      return;
    }

    // ── Select: members to add chosen ────────────────────────────────────────
    if (interaction.isUserSelectMenu() && interaction.customId === 'add_member_ticket_select') {
      const ticket = await db.getTicketByChannel(interaction.channel.id);
      if (!ticket || ticket.status === 'closed') {
        return interaction.update({ content: '❌ Ticket nicht gefunden oder bereits geschlossen.', components: [] });
      }

      const targets = [...interaction.users.values()];
      for (const target of targets) {
        await interaction.channel.permissionOverwrites.edit(target.id, {
          ViewChannel: true, SendMessages: true, ReadMessageHistory: true,
        }).catch(() => {});
      }

      const mentions = targets.map(t => `${t}`).join(', ');
      await interaction.update({ content: `✅ Hinzugefügt: ${mentions}`, components: [] });
      await interaction.channel.send({ content: `➕ ${interaction.user} hat ${mentions} zu diesem Ticket hinzugefügt.` });

      await ticketLog.logMemberAdded(interaction.client, interaction.guild.id, {
        ticket, addedByTag: interaction.user.tag, addedTags: targets.map(t => t.tag), source: '🎮 Discord',
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
          await interaction.message.edit({ embeds: [embed], components: buildTicketButtonsRow(turningOn, !!ticket.claimed_by_id) });
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

// createTicketChannel is also reused by src/modules/voiceSupport/component.js
// (the "Supportticket erstellen" button posted when someone joins the voice
// waiting room outside support hours) — it only needs a guild-context
// interaction (interaction.guild/.user/.reply), a configured category name,
// and a subject string, so it works unchanged from that button click too.
// closeTicket is reused by events/guildMemberRemove.js to auto-close a
// leaving/kicked/banned member's open tickets outside of any interaction.
module.exports = { component, createTicketChannel, closeTicket, buildTicketButtonsRow };
