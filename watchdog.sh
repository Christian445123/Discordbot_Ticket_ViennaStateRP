#!/usr/bin/env bash
# Prueft periodisch (per Cron), ob der Bot wirklich funktioniert - nicht nur,
# ob der Prozess laeuft, sondern ob die Slash-Commands tatsaechlich bei
# Discord registriert sind. Startet per PM2 neu, falls nicht.
#
# Ergaenzt deploy.sh (das nur bei neuen Commits neu startet) und PM2's
# autorestart (das nur einen abgestuerzten Prozess erkennt, nicht einen
# Prozess, der laeuft aber dessen Commands verschwunden/nie synchronisiert
# sind, z.B. weil der Sync beim Start dauerhaft fehlgeschlagen ist).
#
# Prueft die GLOBALEN Commands (nicht guild-scoped) - siehe
# src/bot/deploy-commands.js: ohne DEV_GUILD_ID (Produktion) werden Commands
# global registriert, sobald der Bot auf mehr als einer Guild laeuft.
set -uo pipefail

cd "$(dirname "$0")"

LOG_FILE="./logs/watchdog.log"
mkdir -p ./logs

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

# Liest eine einzelne Variable direkt aus .env (siehe deploy.sh fuer denselben Ansatz)
env_get() {
    local key="$1"
    [ -f .env ] || return 0
    grep -E "^${key}=" .env | head -n1 | cut -d= -f2- | sed -E 's/[[:space:]]*(#.*)?$//'
}

notify_discord() {
    local message="$1"
    local webhook_url
    webhook_url="$(env_get DISCORD_LOG_WEBHOOK_URL)"
    [ -z "$webhook_url" ] && return 0
    local escaped="${message//\\/\\\\}"
    escaped="${escaped//\"/\\\"}"
    escaped="${escaped//$'\n'/\\n}"
    curl -fsS -X POST -H "Content-Type: application/json" \
        -d "{\"content\":\"${escaped}\"}" \
        "$webhook_url" >/dev/null 2>&1 || true
}

restart_bot() {
    local reason="$1"
    log "Neustart ausgeloest: $reason"
    notify_discord "🔁 Watchdog: Bot wird neugestartet ($reason)."
    if pm2 restart ticket-bot >> "$LOG_FILE" 2>&1; then
        log "Neustart erfolgreich."
    else
        log "pm2 restart fehlgeschlagen!"
        notify_discord "⚠️ Watchdog: pm2 restart ist fehlgeschlagen, bitte manuell pruefen."
    fi
}

TOKEN="$(env_get DISCORD_TOKEN)"

if [ -z "$TOKEN" ]; then
    log "DISCORD_TOKEN fehlt in .env, ueberspringe Check."
    exit 0
fi

# 1) Laeuft der PM2-Prozess ueberhaupt? (JSON-Parsing per Node statt
# fragilem grep/sed auf pm2's Ausgabe - node existiert immer, da der Bot
# selbst darueber laeuft.)
status="$(pm2 jlist 2>/dev/null | node -e '
let data = "";
process.stdin.on("data", c => data += c);
process.stdin.on("end", () => {
  try {
    const procs = JSON.parse(data || "[]");
    const p = procs.find(p => p.name === "ticket-bot");
    console.log(p ? (p.pm2_env && p.pm2_env.status ? p.pm2_env.status : "unknown") : "missing");
  } catch { console.log("unknown"); }
});
' 2>/dev/null)"

if [ "$status" != "online" ]; then
    restart_bot "PM2-Status ist '${status:-unbekannt}' statt 'online'"
    exit 0
fi

# 2) Sind bei Discord ueberhaupt (globale) Slash-Commands registriert?
# Direkter Check gegen die Discord-API statt nur zu vermuten, dass ein
# laufender Prozess auch funktionierende Commands hat.
app_id="$(curl -fsS --max-time 10 -H "Authorization: Bot ${TOKEN}" \
    https://discord.com/api/v10/oauth2/applications/@me 2>/dev/null \
    | node -e '
let data = "";
process.stdin.on("data", c => data += c);
process.stdin.on("end", () => {
  try { console.log(JSON.parse(data).id || ""); } catch { console.log(""); }
});
')"

if [ -z "$app_id" ]; then
    log "Konnte Application-ID nicht von der Discord-API abrufen (Netzwerk/Token-Problem?), ueberspringe Command-Check."
    exit 0
fi

command_count="$(curl -fsS --max-time 10 -H "Authorization: Bot ${TOKEN}" \
    "https://discord.com/api/v10/applications/${app_id}/commands" 2>/dev/null \
    | node -e '
let data = "";
process.stdin.on("data", c => data += c);
process.stdin.on("end", () => {
  try {
    const d = JSON.parse(data);
    console.log(Array.isArray(d) ? d.length : -1);
  } catch { console.log(-1); }
});
')"

if [ "$command_count" = "-1" ] || [ -z "$command_count" ]; then
    log "Konnte registrierte Commands nicht abrufen (API-Fehler/Rate-Limit), ueberspringe diesmal."
    exit 0
fi

if [ "$command_count" -eq 0 ]; then
    restart_bot "0 globale Slash-Command(s) bei Discord registriert"
else
    log "OK: PM2 online, ${command_count} globale Slash-Command(s) bei Discord registriert."
fi
