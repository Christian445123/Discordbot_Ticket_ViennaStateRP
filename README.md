# Discord Ticket-Bot mit Admin-Webinterface

Ein Discord-Bot, der ausschließlich ein Ticket-System betreibt: Panel mit Kategorie-Auswahl,
automatische Kanal-Erstellung, automatische Nachrichten pro Kategorie und Transkripte. Dazu ein
Webinterface, das **nur für Server-Administratoren** zugänglich ist und dort Kategorien/
automatische Nachrichten verwaltet sowie eine Nur-Lese-Übersicht aller Tickets zeigt. Der Bot kann
mehrere Discord-Server gleichzeitig bedienen.

## Features

- **Tickets** (der einzige Zweck des Bots)
  - Panel mit Kategorie-Auswahl per Dropdown; jede Kategorie kann ihr **eigenes Frage-Formular**
    haben (bis zu 5 Fragen), das statt des Standard-Betreff/Beschreibung-Modals abgefragt wird
  - Automatische Kanal-Erstellung, Staff-Rolle erhält automatisch Zugriff
  - Kategorien pro Server konfigurierbar: Emoji, Panel-Beschreibung, Ping-Ziel, eigene Fragen —
    **Willkommensnachricht und automatische Nachricht sind für jede Kategorie Pflicht**: wird
    keine eigene angegeben, generiert der Bot automatisch einen passenden Standardtext
  - Neu gestaltetes Ticket-Embed (Autor/Titel/Status-Felder, Server-Icon) und ein eigenes,
    farblich abgesetztes Embed für die automatische Nachricht
  - Ticket schließen per Button oder `/close`, automatischer Transkript-Export, Log-Kanal

- **Admin-Webinterface** (nur Server-Administratoren)
  - Login mit Discord OAuth2, aber nur wer auf dem Server echte "Administrator"-Berechtigung hat,
    kommt hinter die Login-Seite — alle anderen sehen nur einen "Kein Zugriff"-Hinweis
  - **Kategorien & automatische Nachrichten** verwalten (anlegen/bearbeiten/löschen, Ping-Rolle,
    Willkommens- und Auto-Nachricht, eigene Fragen) — dieselbe Funktion wie `/kategorie-config`,
    nur im Browser
  - **Tickets**: Nur-Lese-Übersicht mit Status/Kategorie/Suche, Detailansicht mit dem echten
    Discord-Gesprächsverlauf, Transkript-Export und einer globalen **Auslastungs**-Übersicht
    (Ø Bearbeitungsdauer, Anteil offener Tickets je Kategorie). Kein Web-Chat, kein Erstellen/
    Schließen/Kategorie-Ändern über das Web — das bleibt bewusst ein Discord-seitiger Vorgang.
    Auch der Panel-Kanal wird ausschließlich über `/setup`/`/panel` in Discord verwaltet
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
| `SUPER_ADMIN_IDS`       | Discord-User-IDs (kommagetrennt) mit uneingeschränktem Zugriff auf das Admin-Webinterface auf jedem Server (Bot-Owner) |
| `DEV_GUILD_ID`          | Optional: Slash-Commands nur für diese Guild registrieren (sofort aktiv statt global) |

`DISCORD_GUILD_ID` bleibt als "primäre" Guild bestehen: Web-Requests ohne `?guild=`-Parameter
fallen auf sie zurück — für einen Single-Server-Betrieb reicht das allein.

### 4. Slash-Commands registrieren

```bash
npm run deploy-commands
```

Ohne `DEV_GUILD_ID` werden die Commands **global** registriert (kann bis zu ~1h dauern, erreicht
aber jede Guild, auf der der Bot ist — nötig, sobald der Bot auf mehreren Servern läuft). Mit
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

## Erstkonfiguration auf dem Server

Sobald der Bot online ist, verwende `/setup`:

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
angezeigte Beschreibung, optional ein Ping-Ziel, eigene Fragen fürs Ticket-Formular sowie eine
Willkommensnachricht und eine **automatische Nachricht**, die zusätzlich beim Erstellen eines
Tickets dieser Kategorie gesendet wird (im Ticket-Kanal und/oder per DM an den Ersteller). Beim
ersten Kontakt mit einem Server werden fünf Standardkategorien angelegt (Support, Bug-Report,
Bewerbung, Beschwerde, Allgemein).

**Willkommens- und automatische Nachricht sind für jede Kategorie Pflicht.** Wird beim Anlegen
oder Bearbeiten kein eigener Text angegeben (oder ein vorhandener geleert), generiert der Bot
automatisch einen passenden Standardtext mit dem Kategorienamen — leere Nachrichten gibt es nicht.

Kategorien lassen sich auf zwei gleichwertigen Wegen pflegen:

- **Slash-Command** `/kategorie-config` (nur Admins) — siehe unten
- **Admin-Webinterface** (`/admin`, Tab "Kategorien & Nachrichten") — dieselben Felder in einer
  Kartenansicht mit Bearbeiten-Dialog, siehe [Admin-Webinterface](#admin-webinterface)

### `/kategorie-config` (nur Admins)

```
/kategorie-config hinzufuegen name:Bug-Report emoji:🐛 beschreibung:"Fehler im Spiel melden" ping_rolle:@QA-Team auto_nachricht:"Bitte Screenshots & Reproduktionsschritte angeben." auto_im_kanal:true auto_als_dm:false fragen:"Was ist passiert?;Wann trat der Fehler auf?;Reproduzierbar?"
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
| `willkommensnachricht` | Text im Ticket-Embed beim Öffnen (leer = automatisch generiert)         |
| `auto_nachricht`  | Zusätzlicher Text, der beim Erstellen automatisch gesendet wird (leer = automatisch generiert) |
| `auto_im_kanal`   | Automatische Nachricht im neuen Ticket-Kanal posten (Standard: ja)           |
| `auto_als_dm`     | Automatische Nachricht zusätzlich per Direktnachricht an den Ersteller senden (Standard: nein) |
| `fragen`          | Eigene Fragen fürs Ticket-Formular, getrennt mit `;` (max. 5) — ersetzt das Standard-Betreff/Beschreibung-Modal. Bei `bearbeiten` setzt `-` auf das Standard-Formular zurück |

Name-Felder bei `bearbeiten`/`entfernen` bieten Autovervollständigung – die letzte verbleibende
Kategorie eines Servers kann nicht gelöscht werden (weder per Command noch im Web).

### Eigene Fragen pro Kategorie

Ohne eigene Fragen zeigt das Ticket-Erstellungs-Modal wie bisher "Betreff" (kurz, Pflicht) und
"Beschreibung" (Absatz, optional). Ist für eine Kategorie mindestens eine eigene Frage konfiguriert
(per `fragen`-Option oder im Web über den Fragen-Editor der Kategorie-Karte), ersetzen diese
Fragen das Standard-Formular komplett — Discord erlaubt maximal 5 Felder pro Modal. Die Antworten
landen als Frage/Antwort-Block im Ticket-Embed und in der Ticket-Übersicht statt des einfachen
Betreffs. Im Web lässt sich pro Frage zusätzlich Kurztext/Absatz und Pflicht/Optional einstellen;
über den Slash-Command werden alle per `fragen` angelegten Fragen als Pflicht-Kurztext erstellt.

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
  Willkommensnachricht, automatischer Nachricht (Kanal/DM) und eigenen Fragen fürs
  Ticket-Formular — identische Daten wie `/kategorie-config`, sofort auf beiden Wegen sichtbar.
- **Tickets**: Nur-Lese-Übersicht mit Suche/Status-/Kategorie-Filter, dazu eine globale
  **Auslastungs**-Anzeige (Ø Bearbeitungsdauer über alle geschlossenen Tickets, Anteil offener
  Tickets je Kategorie als Balken). Ein Klick auf ein Ticket öffnet eine Detailansicht mit dem
  echten (aus Discord aufgezeichneten) Gesprächsverlauf, Transkript-Download und internen Notizen.
  Ticket erstellen, Nachrichten schreiben, schließen oder die Kategorie ändern geht **nicht** über
  das Web — das bleibt bewusst Discord-seitig (Panel-Button/Slash-Commands), damit der Bot
  ausschließlich über Discord bedient wird. Auch der Panel-Kanal (`/setup panel_kanal:`,
  `/panel senden`/`/panel aktualisieren`) bleibt bewusst ein reiner Discord-Befehl.
- **Guild-Switcher**: Nutzer mit Administrator-Rechten auf mehreren Servern, auf denen der Bot
  läuft, können oben rechts zwischen ihnen wechseln.

## Projektstruktur

```
├── index.js                    # Einstiegspunkt (DB → Web-Server → Bot-Login)
├── ecosystem.config.js         # PM2-Konfiguration (Produktion)
├── scripts/
│   └── migrate-sqlite-to-mysql.js  # Optionale Einmal-Migration alter SQLite-Daten
├── src/
│   ├── core/                   # Modul-übergreifendes Fundament — siehe "Modul-Architektur"
│   │   ├── db.js               # MySQL-Pool + Schema-Init-Orchestrierung
│   │   ├── moduleLoader.js     # Entdeckt src/modules/*, sammelt Commands/Events/Routen ein
│   │   ├── interactionRouter.js # Einziger Events.InteractionCreate-Listener (Dispatch)
│   │   ├── client.js           # Baut den Discord-Client aus den Modulen
│   │   ├── guards.js           # isSuperAdmin, isGuildAdmin
│   │   └── events/ready.js     # Bot-Status setzen
│   ├── modules/                # Ein Ordner pro Feature — jedes ist eigenständig ladbar
│   │   └── tickets/            # Ticket-System (Panel, Kategorien, Auto-Nachrichten, Admin-API)
│   ├── utils/
│   │   └── logger.js           # Konsolen-Logger mit Zeitstempel & Log-Level
│   ├── bot/
│   │   └── deploy-commands.js  # Slash-Command Registrierung (global oder DEV_GUILD_ID)
│   └── web/
│       ├── server.js           # Express-Server Setup, bindet Modul-Routen dynamisch ein
│       ├── guildContext.js     # Auth-/Guild-/Admin-Middleware für den /api-Router
│       ├── routes/auth.js      # Discord OAuth2
│       └── public/             # Statisches Frontend (Bootstrap 5, kein Build-Schritt)
│           ├── index.html, admin.html, admin-ticket.html
│           ├── css/style.css
│           └── js/ (admin.js, admin-ticket.js, guildSwitcher.js)
└── data/
    └── tickets.db               # nur relevant für scripts/migrate-sqlite-to-mysql.js (alte Installationen)
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
  behandelt (Autocomplete/Command-Dispatch → `component`-Handler aller Module der Reihe nach). Ein
  Modul darf dafür **keinen eigenen Listener** registrieren, sondern exportiert `component`, das
  selbst prüft, ob es die jeweilige `customId` kennt (Namenskonvention: Präfix wie `ticket_`, um
  Kollisionen zu vermeiden).
- **Web-Routen** werden über `registerRoutes(router, ctx)` unter `/api` eingehängt und laufen
  automatisch hinter derselben Auth-/Admin-Middleware (`src/web/guildContext.js`) wie alle anderen
  Module — außer der Pfad beginnt mit `/me` oder `/guilds` (siehe `UNGATED_PREFIXES` dort). Das
  Webinterface ist komplett admin-only: `requireGuildAdmin` prüft echte Discord-"Administrator"-
  Berechtigung auf der gewählten Guild.

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
