'use strict';

// One active voice session per guild (a bot can only hold a single voice
// connection per guild anyway) — tracks the connection, the audio player,
// and which non-staff users are currently in the waiting room, so
// events/voiceStateUpdate.js knows when the room is empty again.

const path = require('path');
const fs   = require('fs');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  StreamType,
  entersState,
} = require('@discordjs/voice');
const logger = require('../../utils/logger');

// Bundled hold-music file — not included in the repo (rights vary per
// server), place your own audio file here before enabling the feature.
const AUDIO_PATH = path.join(__dirname, 'assets', 'wartemusik.mp3');

const sessions = new Map(); // guildId -> { connection, player, waitingUserIds: Set<string> }

function isActive(guildId) {
  return sessions.has(guildId);
}

function getSession(guildId) {
  return sessions.get(guildId);
}

function createLoopingResource() {
  if (!fs.existsSync(AUDIO_PATH)) return null;
  return createAudioResource(AUDIO_PATH, { inputType: StreamType.Arbitrary });
}

// Joins the waiting-room voice channel and starts looping hold music. Only
// ever called when no session exists yet for this guild — later joiners
// are just added to the returned session's waitingUserIds by the caller.
function startSession(voiceChannel, firstUserId) {
  const guildId = voiceChannel.guild.id;

  const connection = joinVoiceChannel({
    channelId:      voiceChannel.id,
    guildId,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf:       false,
  });

  const player  = createAudioPlayer();
  const session = { connection, player, waitingUserIds: new Set([firstUserId]) };
  sessions.set(guildId, session);

  let consecutiveErrors = 0;
  const playLoop = () => {
    const resource = createLoopingResource();
    if (!resource) {
      logger.warn(`Voice-Support: Keine Wartemusik-Datei gefunden unter ${AUDIO_PATH} — es wird nur beigetreten, ohne Musik abzuspielen.`);
      return;
    }
    consecutiveErrors = 0;
    player.play(resource);
  };

  player.on(AudioPlayerStatus.Idle, playLoop);
  player.on('error', err => {
    logger.error('Voice-Support: Fehler bei der Audiowiedergabe:', err.message);
    // Cap retries so a permanently broken/corrupt file can't spin this into
    // a tight error loop — five failures in a row and we just stay silent.
    if (++consecutiveErrors <= 5) playLoop();
    else logger.error(`Voice-Support: Wartemusik wiederholt fehlgeschlagen, gebe auf für Guild ${guildId}.`);
  });

  connection.subscribe(player);
  playLoop();

  // Standard @discordjs/voice reconnect-or-cleanup dance: "Disconnected" can
  // mean a real disconnect (kicked, channel deleted) or just a temporary
  // blip while moving between channels, so give it a few seconds before
  // tearing the session down for good.
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      stopSession(guildId);
    }
  });

  return session;
}

function stopSession(guildId) {
  const session = sessions.get(guildId);
  if (!session) return;
  try { session.player.stop(); } catch (_) { /* already stopped */ }
  try { session.connection.destroy(); } catch (_) { /* already destroyed */ }
  sessions.delete(guildId);
}

module.exports = { isActive, getSession, startSession, stopSession, AUDIO_PATH };
