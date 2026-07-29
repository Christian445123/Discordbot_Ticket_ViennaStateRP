'use strict';

const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const db = require('./db');

async function component(interaction) {
  // ── Button: "Jetzt bewerben" ─────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('team_apply_')) {
    const formId = parseInt(interaction.customId.replace('team_apply_', ''), 10);
    const form = await db.getFormById(formId);
    if (!form || !form.open) {
      return interaction.reply({ content: '❌ Dieses Formular ist nicht mehr verfügbar.', ephemeral: true });
    }

    const questions = JSON.parse(form.questions);
    const modal = new ModalBuilder().setCustomId(`team_apply_modal_${formId}`).setTitle(form.name.slice(0, 45));

    questions.forEach((question, i) => {
      const input = new TextInputBuilder()
        .setCustomId(`q${i}`)
        .setLabel(question.slice(0, 45))
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
    });

    return interaction.showModal(modal);
  }

  // ── Modal submit: application answers ────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId.startsWith('team_apply_modal_')) {
    const formId = parseInt(interaction.customId.replace('team_apply_modal_', ''), 10);
    const form = await db.getFormById(formId);
    if (!form) return interaction.reply({ content: '❌ Formular nicht mehr verfügbar.', ephemeral: true });

    const questions = JSON.parse(form.questions);
    const answers = questions.map((question, i) => ({
      question, answer: interaction.fields.getTextInputValue(`q${i}`),
    }));

    const applicationId = await db.createApplication(formId, interaction.user.id, answers);
    return interaction.reply({
      content: `✅ Deine Bewerbung (#${applicationId}) wurde eingereicht. Die Team-Leitung meldet sich bei dir.`,
      ephemeral: true,
    });
  }
}

module.exports = { component };
