# Discord Ticket-Bot mit Admin-Webinterface

Ein lizenzpflichtiger Discord-Bot, der ausschließlich ein Ticket-System betreibt: Panel mit
Kategorie-Auswahl, automatische Kanal-Erstellung, automatische Nachrichten pro Kategorie und
Transkripte. Dazu ein Webinterface, das **nur für Server-Administratoren** zugänglich ist und dort
Kategorien/automatische Nachrichten verwaltet sowie eine Nur-Lese-Übersicht aller Tickets zeigt.
Der Bot kann mehrere Discord-Server bedienen; jeder Server braucht eine gültige Lizenz, sonst
bleiben nur die Lizenz-Befehle nutzbar (siehe [Lizenzsystem](#lizenzsystem)).

## Features

- **Tickets** (der einzige Zweck des Bots)
  - Panel mit Kategorie-Auswahl per Dropdown, Modal für Betreff & Beschreibung
  - Automatische Kanal-Erstellung, Staff-Rolle erhält automatisch Zugriff
  - Kategorien pro Server konfigurierbar: Emoji, Panel-Beschreibung, Ping-Ziel,
    Willkommensnachricht und eine **automatische Nachricht**, die beim Erstellen eines Tickets
    dieser Kategorie zusätzlich im Kanal und/oder per DM gesendet wird
  - Ticket schließen per Button oder `/close`, automatischer Transkript-Export, Log-Kanal

- **Lizenzsystem** (`/lizenz`, `/lizenz-admin`)
  - Alles-oder-nichts pro Discord-Server: ohne gültige Lizenz bleiben nur die Lizenz-Befehle
    nutzbar. Signierter Offline-Cache überbrückt kurze DB-Ausfälle (siehe unten)

- **Admin-Webinterface** (nur Server-Administratoren)
  - Login mit Discord OAuth2, aber nur wer auf dem Server echte "Administrator"-Berechtigung hat,
    kommt hinter die Login-Seite — alle anderen sehen nur einen "Kein Zugriff"-Hinweis
  - **Kategorien & automatische Nachrichten** verwalten (anlegen/bearbeiten/löschen, Ping-Rolle,
    Willkommens- und Auto-Nachricht) — dieselbe Funktion wie `/kategorie-config`, nur im Browser
  - **Ticket-Übersicht** (Nur-Lese): Liste aller Tickets mit Status/Kategorie/Suche, Detailansicht
    mit dem echten Discord-Gesprächsverlauf und Transkript-Export. Kein Web-Chat, kein Erstellen/
    Schließen/Kategorie-Ändern über das Web — das bleibt bewusst ein Discord-seitiger Vorgang
  - **Lizenz-Status & Aktivierung**, für Bot-Administratoren zusätzlich serverübergreifende
    Lizenzverwaltung (erstellen/sperren/verlängern)
  - Interne Notizen pro Ticket (nur im Webinterface sichtbar, werden nie in den Ticket-Kanal
    gepostet) lassen sich ebenfalls im Webinterface anlegen

- **Erweiterbar**: jedes Feature ist ein eigenständiges Modul unter `src/modules/` mit
  einheitlichem Vertrag (Schema, Commands, Events, Web-Routen) — ein neues Feature ist ein neuer
  Ordner, ohne bestehenden Code anzufassen (siehe [Modul-Architektur](#modul-architektur--eigene-module-hinzufügen)).

## Voraussetzungen

- Node.js 18+
- Eine erreichbare MySQL-Datenbank (5.7+/8.0, `ticketbotDB` o.ä.) – Tabellen werden automatisch angelegt
- Discord-Applikation (https://discord.com/developers/applications)

## Einrichtung

### 1. Repository klonen & Abhängigkeiten installieren

```bash
npm install
```

### 2. Discord-Applikation konfigurieren

1. Gehe zu https://discord.com/developers/applications
2. Erstelle eine neue Applikation (oder wähle eine bestehende)
3. Unter **Bot**: Token kopieren, aktiviere **Message Content Intent**, **Server Members Intent**
4. Unter **OAuth2 → General**: Füge folgende Redirect-URI hinzu:
   ```
   http://localhost:3000/auth/discord/callback
   ```
5. Notiere **Client ID** und **Client Secret**

### 3. Umgebungsvariablen

```bash
cp .env.example .env
```

Öffne `.env` und fülle alle Felder aus:

| Variable                | Beschreibung                                          |
|-------------------------|-------------------------------------------------------|
| `DISCORD_TOKEN`         | Bot-Token aus dem Developer Portal                    |
| `DISCORD_CLIENT_ID`     | Application ID / Client ID                            |
| `DISCORD_CLIENT_SECRET` | OAuth2 Client Secret                                  |
| `DISCORD_GUILD_ID`      | ID deines Discord-Servers                             |
| `DB_HOST`               | MySQL-Host (z.B. `127.0.0.1`)                         |
| `DB_PORT`               | MySQL-Port (Standard: `3306`)                         |
| `DB_NAME`                | Datenbankname                                        |
| `DB_USER`                | Datenbank-Benutzer                                   |
| `DB_PASSWORD`            | Datenbank-Passwort                                   |
| `PORT`                  | Web-Port (Standard: 3000)                             |
| `BASE_URL`              | Öffentliche URL des Web-Servers (z.B. http://localhost:3000) |
| `SESSION_SECRET`        | Zufälliger String (mind. 32 Zeichen)                  |
| `SUPER_ADMIN_IDS`       | Discord-User-IDs (kommagetrennt) mit Zugriff auf `/lizenz-admin` und uneingeschränktem Web-Zugriff auf jeden Server |
| `LICENSE_CACHE_SECRET`  | Secret für den signierten Offline-Lizenz-Cache (fällt auf `SESSION_SECRET` zurück) |
| `LICENSE_OFFLINE_GRACE_HOURS` | Wie lange eine Lizenz bei DB-Ausfall offline gültig bleibt (Standard: 72) |
| `DEV_GUILD_ID`          | Optional: Slash-Commands nur für diese Guild registrieren (sofort aktiv statt global) |

`DISCORD_GUILD_ID` bleibt als "primäre" Guild bestehen: für sie wird beim ersten Start automatisch
eine unbefristete Bestandslizenz aktiviert (siehe [Lizenzsystem](#lizenzsystem)), und Web-Requests
ohne `?guild=`-Parameter fallen auf sie zurück — für einen Single-Server-Betrieb reicht das allein.

### 4. Slash-Commands registrieren

```bash
npm run deploy-commands
```

Ohne `DEV_GUILD_ID` werden die Commands **global** registriert (kann bis zu ~1h dauern, erreicht
aber jede Guild, auf der der Bot ist — nötig, sobald mehr als ein Server lizenziert wird). Mit
gesetztem `DEV_GUILD_ID` werden sie stattdessen nur für diese eine Guild registriert und sind
sofort aktiv — praktisch für die Entwicklung.

### 5. Bot starten

```bash
npm start
# oder für Entwicklung mit Auto-Reload:
npm run dev
```

## Datenbank (MySQL)

Die Datenbank liegt in MySQL statt in einer lokalen Datei. Beim Start verbindet sich der Bot mit
den `DB_*`-Werten aus `.env` und legt fehlende Tabellen automatisch an (`CREATE TABLE IF NOT
EXISTS`) – kein manuelles Einrichten des Schemas nötig, nur die Datenbank selbst und der Benutzer
müssen bereits existieren (inkl. Rechten für `CREATE`/`ALTER`/`SELECT`/`INSERT`/`UPDATE`/`DELETE`).

Schlägt die Verbindung beim Start fehl (falsches Passwort, Server nicht erreichbar, fehlende
Rechte), wird das klar geloggt und der Prozess beendet sich, statt mit kaputter DB-Anbindung
weiterzulaufen.

### Alte SQLite-Daten übernehmen (optional)

Falls vorher eine ältere Version dieses Bots mit lokaler SQLite-Datenbank (`data/tickets.db`)
lief und die Historie übernommen werden soll:

```bash
npm install                        # installiert better-sqlite3 als devDependency
npm run migrate:sqlite-to-mysql
```

Das Skript legt das MySQL-Schema an (falls nötig) und kopiert Guilds, Kategorien, Tickets,
Nachrichten und Notizen 1:1 inklusive IDs hinüber. Ohne vorhandene `data/tickets.db` tut es
nichts – für einen komplett neuen Server also einfach überspringen.

## Lizenzsystem

Jede Guild braucht eine aktivierte Lizenz, sonst reagiert der Bot dort nur noch auf `/lizenz` —
alle anderen Commands (Tickets) und die entsprechenden Web-Routen antworten mit einem
Lizenz-Hinweis statt auszuführen. Die bereits konfigurierte `DISCORD_GUILD_ID`-Guild bekommt beim
allerersten Start automatisch eine unbefristete Bestandslizenz (kein manueller Schritt nötig).

**Lizenzen erstellen/verwalten** (nur `SUPER_ADMIN_IDS`, funktioniert auf jeder Guild bzw. ganz
ohne Guild-Bindung):

```
/lizenz-admin erstellen label:"Kunde XY" max_server:1 gueltig_tage:365
/lizenz-admin sperren key:XXXX-XXXX-XXXX-XXXX-XXXX
/lizenz-admin entsperren key:XXXX-XXXX-XXXX-XXXX-XXXX
/lizenz-admin verlaengern key:XXXX-XXXX-XXXX-XXXX-XXXX tage:30
/lizenz-admin liste
```

**Lizenz auf einem Server aktivieren** (Server-Admin, auch über das Web-Interface möglich, Tab
"Lizenz"):

```
/lizenz aktivieren key:XXXX-XXXX-XXXX-XXXX-XXXX
/lizenz status
```

**Wie die Prüfung funktioniert:** Der Bot validiert die Lizenz einer Guild gegen die Datenbank
(mit kurzem In-Memory-Cache, damit nicht jede Interaction einen DB-Roundtrip auslöst) und schreibt
das Ergebnis signiert nach `data/license-cache.json`. Ist die Datenbank kurzzeitig nicht
erreichbar, wird dieser Cache als Fallback genutzt — aber nur innerhalb von
`LICENSE_OFFLINE_GRACE_HOURS` (Standard 72h) und nur, wenn die Signatur (HMAC mit
`LICENSE_CACHE_SECRET`) noch stimmt. Danach gilt die Lizenz als ungültig, bis die DB wieder
erreichbar ist.

## Erstkonfiguration auf dem Server

Sobald der Bot online ist und für den Server eine Lizenz aktiv ist, verwende `/setup`:

```
/setup kategorie:#ticket-kategorie log_kanal:#ticket-logs staff_rolle:@Staff panel_kanal:#support
```

| Option               | Beschreibung                                                    |
|----------------------|---------------------------------------------------------------- |
| `kategorie`          | Discord-Kategorie, in der neue Ticket-Kanäle angelegt werden   |
| `log_kanal`          | Kanal für Logs & Transkripte beim Schließen                    |
| `staff_rolle`        | Rolle, die alle Ticket-Kanäle sehen & verwalten darf            |
| `panel_kanal`        | Kanal, in dem das Ticket-Erstellungs-Panel gepostet wird        |
| `panel_beschreibung` | Eigener Beschreibungstext für das Panel-Embed                  |
| `panel_bild`         | Bild-URL, die groß im Panel-Embed angezeigt wird                |

Innerhalb eines Ticket-Kanals kann Staff die Kategorie danach jederzeit mit `/kategorie
neue_kategorie:<Kategorie>` ändern.

## Ticket-Kategorien & automatische Nachrichten

Kategorien sind **pro Server konfigurierbar** – jede hat einen Namen, ein Emoji, eine im Panel
angezeigte Beschreibung, optional ein Ping-Ziel, eine Willkommensnachricht und optional eine
**automatische Nachricht**, die zusätzlich beim Erstellen eines Tickets dieser Kategorie gesendet
wird (im Ticket-Kanal und/oder per DM an den Ersteller). Beim ersten Kontakt mit einem Server
werden fünf Standardkategorien angelegt (Support, Bug-Report, Bewerbung, Beschwerde, Allgemein).

Kategorien lassen sich auf zwei gleichwertigen Wegen pflegen:

- **Slash-Command** `/kategorie-config` (nur Admins) — siehe unten
- **Admin-Webinterface** (`/admin`, Tab "Kategorien & Nachrichten") — dieselben Felder in einer
  Kartenansicht mit Bearbeiten-Dialog, siehe [Admin-Webinterface](#admin-webinterface)

### `/kategorie-config` (nur Admins)

```
/kategorie-config hinzufuegen name:Bug-Report emoji:🐛 beschreibung:"Fehler im Spiel melden" ping_rolle:@QA-Team auto_nachricht:"Bitte Screenshots & Reproduktionsschritte angeben." auto_im_kanal:true auto_als_dm:false
/kategorie-config bearbeiten name:Bug-Report ping_user:@Max
/kategorie-config entfernen name:Beschwerde
/kategorie-config liste
```

| Feld              | Beschreibung                                                                 |
|-------------------|-------------------------------------------------------------------------------|
| `name`            | Anzeigename der Kategorie (im Dropdown, Panel, Web-Interface)                |
| `emoji`           | Icon im Dropdown & Panel                                                     |
| `beschreibung`    | Kurztext, der im Panel-Embed unter dem Kategorienamen steht                  |
| `ping_rolle` / `ping_user` | Wer beim Erstellen eines Tickets dieser Kategorie gepingt wird (nur eines von beiden) – bekommt automatisch Zugriff auf den Ticket-Kanal |
| `auto_nachricht`  | Zusätzlicher Text, der beim Erstellen automatisch gesendet wird              |
| `auto_im_kanal`   | Automatische Nachricht im neuen Ticket-Kanal posten (Standard: ja)           |
| `auto_als_dm`     | Automatische Nachricht zusätzlich per Direktnachricht an den Ersteller senden (Standard: nein) |

Name-Felder bei `bearbeiten`/`entfernen` bieten Autovervollständigung – die letzte verbleibende
Kategorie eines Servers kann nicht gelöscht werden (weder per Command noch im Web).

### Panel senden/aktualisieren – `/panel`

```
/panel senden kanal:#support
/panel aktualisieren
```

Das Panel zeigt automatisch alle konfigurierten Kategorien mit Emoji + Beschreibung im Embed,
plus optionalem Bild (`panel_bild` in `/setup`).

## Admin-Webinterface

Erreichbar unter `/admin`, Login über "Als Administrator anmelden" (Discord OAuth2). Zugriff
bekommt **ausschließlich**, wer auf dem gewählten Server echte Discord-"Administrator"-Berechtigung
hat (oder in `SUPER_ADMIN_IDS` steht) — alle anderen sehen nach dem Login nur einen
"Kein Zugriff"-Hinweis, alle `/api`-Routen antworten mit `403`.

- **Kategorien & Nachrichten**: Kategorien anlegen/bearbeiten/löschen, inkl. Ping-Rolle,
  Willkommensnachricht und automatischer Nachricht (Kanal/DM) — identische Daten wie
  `/kategorie-config`, sofort auf beiden Wegen sichtbar.
- **Tickets**: Nur-Lese-Übersicht mit Suche/Status-/Kategorie-Filter. Ein Klick auf ein Ticket
  öffnet eine Detailansicht mit dem echten (aus Discord aufgezeichneten) Gesprächsverlauf,
  Transkript-Download und internen Notizen. Ticket erstellen, Nachrichten schreiben, schließen
  oder die Kategorie ändern geht **nicht** über das Web — das bleibt bewusst Discord-seitig
  (Panel-Button/Slash-Commands), damit der Bot ausschließlich über Discord bedient wird.
- **Lizenz**: Status der aktuellen Guild, Aktivierung eines Schlüssels; für `SUPER_ADMIN_IDS`
  zusätzlich serverübergreifende Lizenzverwaltung.
- **Guild-Switcher**: Nutzer mit Administrator-Rechten auf mehreren lizenzierten Servern können
  oben rechts zwischen ihnen wechseln.

## Projektstruktur

```
├── index.js                    # Einstiegspunkt (DB → Lizenz-Bootstrap → Web-Server → Bot-Login)
├── ecosystem.config.js         # PM2-Konfiguration (Produktion)
├── scripts/
│   └── migrate-sqlite-to-mysql.js  # Optionale Einmal-Migration alter SQLite-Daten
├── src/
│   ├── core/                   # Modul-übergreifendes Fundament — siehe "Modul-Architektur"
│   │   ├── db.js               # MySQL-Pool + core_guilds-Schema + Schema-Init-Orchestrierung
│   │   ├── moduleLoader.js     # Entdeckt src/modules/*, sammelt Commands/Events/Routen ein
│   │   ├── interactionRouter.js # Einziger Events.InteractionCreate-Listener (Lizenz-Gate + Dispatch)
│   │   ├── client.js           # Baut den Discord-Client aus den Modulen
│   │   ├── guards.js           # requireLicenseSilent, isSuperAdmin, isGuildAdmin
│   │   ├── events/ready.js     # Bot-Status setzen
│   │   └── license/            # Lizenz-Prüfung (Service + signierter Offline-Cache)
│   ├── modules/                # Ein Ordner pro Feature — jedes ist eigenständig ladbar
│   │   ├── tickets/            # Ticket-System (Panel, Kategorien, Auto-Nachrichten, Admin-API)
│   │   └── license/            # /lizenz, /lizenz-admin — core:true, läuft auch ohne Lizenz
│   ├── utils/
│   │   └── logger.js           # Konsolen-Logger mit Zeitstempel & Log-Level
│   ├── bot/
│   │   └── deploy-commands.js  # Slash-Command Registrierung (global oder DEV_GUILD_ID)
│   └── web/
│       ├── server.js           # Express-Server Setup, bindet Modul-Routen dynamisch ein
│       ├── guildContext.js     # Auth-/Guild-/Lizenz-/Admin-Middleware für den /api-Router
│       ├── routes/auth.js      # Discord OAuth2
│       └── public/             # Statisches Frontend (Bootstrap 5, kein Build-Schritt)
│           ├── index.html, admin.html, admin-ticket.html
│           ├── css/style.css
│           └── js/ (admin.js, admin-ticket.js, guildSwitcher.js)
└── data/
    ├── tickets.db               # nur relevant für scripts/migrate-sqlite-to-mysql.js (alte Installationen)
    └── license-cache.json       # signierter Offline-Lizenz-Cache (automatisch angelegt)
```

Jedes Modul unter `src/modules/<name>/` folgt intern derselben Struktur: `db.js` (Schema +
Queries), `commands/*.js`, optional `events/*.js`, `component.js` (Buttons/Modals) und `routes.js`
(Web-API), zusammengeführt in `index.js`. Details dazu im nächsten Abschnitt.

## Modul-Architektur — eigene Module hinzufügen

Jedes Feature ist ein eigenständiges Modul unter `src/modules/<name>/index.js` mit demselben
Vertrag:

```js
module.exports = {
  name: 'mein-modul',
  core: false,                      // true = läuft auch ohne gültige Lizenz (wie das license-Modul)
  initSchema: async (pool) => {},   // eigene Tabellen (CREATE TABLE IF NOT EXISTS)
  commands: [ /* { data, execute, autocomplete? } */ ],
  events:   [ /* { name, once?, execute } */ ],   // NIEMALS Events.InteractionCreate!
  component: async (interaction) => {},           // Buttons/Selects/Modals, customId selbst prüfen
  registerRoutes: (router, ctx) => {},             // ctx = { discordClient }, Web-API
};
```

`src/core/moduleLoader.js` scannt `src/modules/*` automatisch beim Start (alphabetisch) — ein
neues Feature bedeutet: neuen Ordner mit diesem Vertrag anlegen, sonst nichts. Kein Kern-Code muss
angefasst werden. Wichtige Punkte:

- **Slash-Commands** landen automatisch in `client.commands` und werden von
  `src/bot/deploy-commands.js` mit registriert (`npm run deploy-commands`).
- **`Events.InteractionCreate`** wird ausschließlich zentral in `src/core/interactionRouter.js`
  behandelt (Lizenz-Gate → Autocomplete/Command-Dispatch → `component`-Handler aller Module der
  Reihe nach). Ein Modul darf dafür **keinen eigenen Listener** registrieren, sondern exportiert
  `component`, das selbst prüft, ob es die jeweilige `customId` kennt (Namenskonvention:
  Präfix wie `ticket_`, um Kollisionen zu vermeiden).
- **Lizenz-Gate**: Standardmäßig (`core: false`) blockiert `interactionRouter` alle Commands und
  Components des Moduls, wenn die aktuelle Guild keine gültige Lizenz hat. Eigene
  `events`-Handler (z. B. `messageCreate`) müssen die Prüfung selbst aufrufen —
  `guards.requireLicenseSilent(guildId)` — siehe `src/modules/tickets/events/messageCreate.js` als
  Beispiel.
- **Web-Routen** werden über `registerRoutes(router, ctx)` unter `/api` eingehängt und laufen
  automatisch hinter derselben Auth-/Lizenz-/Admin-Middleware (`src/web/guildContext.js`) wie alle
  anderen Module — außer der Pfad beginnt mit `/me`, `/guilds` oder `/license` (siehe
  `UNGATED_PREFIXES` dort). Das Webinterface ist komplett admin-only: `requireGuildAdmin` prüft
  echte Discord-"Administrator"-Berechtigung auf der gewählten Guild.

## Logging

Es gibt zwei unabhängige Logging-Ebenen.

### 1. Server-Logs (Konsole)

Alle internen Vorgänge (Start, Fehler, fehlgeschlagene Commands/Kanal-Erstellung, …) laufen über
`src/utils/logger.js` und werden mit Zeitstempel + Log-Level ausgegeben:

```
[2026-07-19T14:32:01.123Z] [INFO] ✅ Bot eingeloggt als TicketBot#1234
[2026-07-19T14:32:05.456Z] [ERROR] Command "close" fehlgeschlagen: ...
```

Steuerbar über `LOG_LEVEL` in `.env`: `error` | `warn` | `info` (Standard) | `debug`.

Zusätzlich fängt `index.js` unbehandelte Fehler ab:
- `unhandledRejection` wird geloggt, der Prozess läuft weiter (meist unkritisch, z. B. ein
  fehlgeschlagener Discord-API-Call).
- `uncaughtException` wird geloggt und der Prozess wird danach bewusst beendet (`process.exit(1)`) –
  laut Node.js ist ein Weiterlaufen nach einer uncaught exception unsicher. Unter PM2 sorgt das dafür,
  dass der Prozess sauber neu startet, statt in einem funktionsunfähigen Zustand hängen zu bleiben und
  keine weiteren Logs mehr zu produzieren.

### 2. Discord Log-Kanal

Der unter `/setup log_kanal:` konfigurierte Kanal erhält bei jeder Ticket-Aktion eine Embed-Nachricht
(über `src/modules/tickets/ticketLog.js`):

| Aktion             | Inhalt                                                                | Quelle              |
|--------------------|--------------------------------------------------------------------- |----------------------|
| Ticket erstellt    | Kanal, Benutzer, Kategorie                                             | 🎮 Discord           |
| Ticket geschlossen | Ticket-Nr., Ersteller, wer geschlossen hat, Transkript (`.txt`-Anhang) | 🎮 Discord           |
| Kategorie geändert | Ticket-Nr., alte/neue Kategorie                                        | 🎮 Discord           |
| Notiz hinzugefügt  | Ticket-Nr., Autor, Notiztext                                           | 🌐 Web (Admin)        |
| Kategorie-Konfig geändert | Welche Kategorie, welche Aktion                                  | 🎮 Discord / 🌐 Web (Admin) |

### 3. PM2 (Produktion)

Die mitgelieferte `ecosystem.config.js` schreibt die Logs in eigene Dateien statt nach `~/.pm2/logs/`:

```bash
npm run pm2:start     # Start über ecosystem.config.js
npm run pm2:logs      # Live-Logs verfolgen (tail -f)
npm run pm2:restart
npm run pm2:stop
```

Logs landen in `./logs/out.log` und `./logs/error.log` (bereits in `.gitignore`). Für automatische
Rotation empfiehlt sich das PM2-Modul `pm2-logrotate`:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 14
```

## Produktion

Für den Produktionseinsatz empfiehlt sich:
- Reverse-Proxy (nginx/Caddy) mit HTTPS
- `SESSION_SECRET` in `.env` als langen, zufälligen String setzen
- `cookie.secure = true` in `src/web/server.js` aktivieren (bei HTTPS)
- Prozessmanager (PM2) über die mitgelieferte Konfiguration starten: `npm run pm2:start`
  (siehe [Logging](#logging) für Log-Speicherort & Rotation)
