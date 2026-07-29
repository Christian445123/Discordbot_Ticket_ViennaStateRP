'use strict';

// Shared by the /bewerbung entscheiden command and the web dashboard's
// applications review page, so accepting an application always does the
// same thing regardless of where the decision was made.

const db = require('./db');

async function decide(discordClient, guild, applicationId, accepted, reviewerId, note) {
  const application = await db.getApplicationById(applicationId);
  if (!application) return { error: 'Bewerbung nicht gefunden' };

  await db.decideApplication(applicationId, accepted ? 'accepted' : 'rejected', reviewerId, note);

  if (accepted) {
    const form = await db.getFormById(application.form_id);
    if (form?.target_rank_id) {
      const rank    = await db.getRankById(form.target_rank_id);
      const current = await db.getMember(guild.id, application.user_id);
      await db.upsertMember(guild.id, application.user_id, rank.id);
      await db.addRankHistory({
        guildId: guild.id, userId: application.user_id, oldRank: current?.rank_name ?? null,
        newRank: rank.name, changedBy: reviewerId, reason: `Bewerbung #${applicationId} angenommen`,
      });
      const member = await guild.members.fetch(application.user_id).catch(() => null);
      if (member && rank.role_id) await member.roles.add(rank.role_id).catch(() => {});
    }
  }

  const user = await discordClient.users.fetch(application.user_id).catch(() => null);
  await user?.send(
    accepted
      ? `🎉 Deine Bewerbung auf **${guild.name}** wurde angenommen!`
      : `Deine Bewerbung auf **${guild.name}** wurde leider abgelehnt.${note ? `\nGrund: ${note}` : ''}`,
  ).catch(() => {});

  return { success: true };
}

module.exports = { decide };
