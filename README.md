# Discord Ticket-Bot mit Web-Interface

Ein vollständiges Ticket-System für Discord mit Web-Dashboard.

## Features

- **Discord-Bot**
  - Panel mit Kategorie-Auswahl per Dropdown
  - Modal für Betreff & Beschreibung
  - Automatische Kanal-Erstellung in einer konfigurierbaren Kategorie
  - Staff-Rolle erhält automatisch Zugriff auf alle Ticket-Kanäle
  - Ticket schließen per Button oder `/close`-Befehl
  - Automatischer Transkript-Export beim Schließen
  - Log-Kanal für alle Ticket-Aktionen

- **Web-Interface**
  - Login mit Discord OAuth2
  - Dashboard mit Statistiken & Suchfunktion
  - Ticket-Detail-Ansicht mit Nachrichtenverlauf
  - Direkt aus dem Browser in ein Ticket schreiben – die Nachricht landet sofort auch im
    Discord-Kanal, und Antworten aus Discord erscheinen automatisch im Web (Live-Sync alle 5s)
  - Tickets über Browser schließen (Staff & Ticket-Ersteller)

## Voraussetzungen

- Node.js 18+
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
| `PORT`                  | Web-Port (Standard: 3000)                             |
| `BASE_URL`              | Öffentliche URL des Web-Servers (z.B. http://localhost:3000) |
| `SESSION_SECRET`        | Zufälliger String (mind. 32 Zeichen)                  |

### 4. Slash-Commands registrieren

```bash
npm run deploy-commands
```

### 5. Bot starten

```bash
npm start
# oder für Entwicklung mit Auto-Reload:
npm run dev
```

## Erstkonfiguration auf dem Server

Sobald der Bot online ist, verwende `/setup` auf deinem Server:

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

Damit eine Rolle (z. B. `@Team`) volle Verwaltungsrechte über alle Tickets bekommt – Zugriff auf
jeden Ticket-Kanal, Web-Dashboard "Alle Tickets", Tickets schließen, Notizen, Kategorie ändern –
reicht es, sie einmalig als `staff_rolle` zu setzen:

```
/setup staff_rolle:@Team
```

Innerhalb eines Ticket-Kanals kann Staff die Kategorie danach jederzeit mit `/kategorie
neue_kategorie:<Kategorie>` ändern (oder über das Dropdown in der Web-Ansicht des Tickets).

## Ticket-Kategorien

Kategorien sind **pro Server konfigurierbar** (nicht mehr fest im Code) – jede hat einen Namen,
ein Emoji, eine im Panel angezeigte Beschreibung, optional ein Ping-Ziel und optional eine
automatische Nachricht. Beim ersten Kontakt mit einem Server werden fünf Standardkategorien
angelegt (Support, Bug-Report, Bewerbung, Beschwerde, Allgemein) – frei anpassbar über
`/kategorie-config`.

### Kategorien verwalten – `/kategorie-config` (nur Admins)

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
Kategorie eines Servers kann nicht gelöscht werden.

### Kategorie eines bestehenden Tickets ändern – `/kategorie`

Innerhalb eines Ticket-Kanals kann Staff die Kategorie mit `/kategorie neue_kategorie:<Kategorie>`
ändern (oder über das Dropdown in der Web-Ansicht des Tickets).

### Panel senden/aktualisieren – `/panel`

Das Panel kann auch unabhängig von `/setup` (neu) gepostet oder nach Kategorie-Änderungen
aktualisiert werden:

```
/panel senden kanal:#support
/panel aktualisieren
```

Das Panel zeigt automatisch alle konfigurierten Kategorien mit Emoji + Beschreibung im Embed,
plus optionalem Bild (`panel_bild` in `/setup`) – ähnlich einem klassischen Ticket-Panel mit
Dropdown-Auswahl.

## Web-Chat (Nachrichten aus dem Browser)

Auf der Ticket-Detailseite (`/ticket/:id`) kann direkt aus dem Browser in ein offenes Ticket
geschrieben werden – nicht nur gelesen:

- **Wer darf schreiben:** Staff (Rolle aus `/setup`) sowie der Ticket-Ersteller selbst, solange
  das Ticket offen ist. Bei einem geschlossenen Ticket wird der Schreibbereich durch den
  "Ticket ist geschlossen"-Hinweis ersetzt.
- **Bedienung:** `Enter` sendet die Nachricht, `Umschalt+Enter` fügt eine neue Zeile ein
  (max. 1800 Zeichen).
- **Synchronisierung mit Discord:** Jede Web-Nachricht wird sofort auch in den zugehörigen
  Ticket-Kanal auf Discord gepostet (als Bot-Nachricht mit Namen des Absenders und Kennzeichnung
  🌐 Web bzw. 🛠️ Staff), und in der Datenbank gespeichert. Umgekehrt holt die Ticket-Seite alle
  5 Sekunden neue Nachrichten (inkl. Antworten direkt aus Discord) nach, solange der
  "Nachrichten"-Tab aktiv und der Browser-Tab sichtbar ist – ganz ohne manuelles Neuladen.
- **Sicherheit:** Web-Nachrichten werden beim Senden an Discord mit `allowedMentions: { parse: [] }`
  verschickt, sodass über das Web-Formular niemals `@everyone`, `@here`, Rollen oder einzelne
  Nutzer im Ticket-Kanal gepingt werden können.
- **Kein Nutzer-Impersonating:** Da Discord-Bots keine Nachrichten "als" ein anderes Mitglied
  senden können (ohne Webhooks), erscheinen Web-Nachrichten im Kanal als Bot-Nachricht mit dem
  Namen des Absenders im Text (`**Name** (🌐 Web): …`) statt mit dessen echtem Profilbild/Namen.

## Projektstruktur

```
├── index.js                    # Einstiegspunkt (Bot + Web-Server)
├── ecosystem.config.js         # PM2-Konfiguration (Produktion)
├── src/
│   ├── database/
│   │   └── db.js               # SQLite-Datenbank (better-sqlite3)
│   ├── bot/
│   │   ├── bot.js              # Discord-Client mit Command/Event-Loader
│   │   ├── deploy-commands.js  # Slash-Command Registrierung
│   │   ├── ticketLog.js        # Zentrales Logging in den Log-Kanal (erstellt/geschlossen/Notiz/Kategorie)
│   │   ├── categoryNotify.js   # Ping-Ziel & automatische Nachricht pro Kategorie anwenden
│   │   ├── panelBuilder.js     # Baut das Panel-Embed + Dropdown aus den DB-Kategorien
│   │   ├── commands/
│   │   │   ├── setup.js            # /setup – System einrichten
│   │   │   ├── close.js            # /close – Ticket schließen
│   │   │   ├── kategorie.js        # /kategorie – Kategorie eines Tickets ändern
│   │   │   ├── kategorie-config.js # /kategorie-config – Kategorien verwalten (hinzufügen/bearbeiten/entfernen/liste)
│   │   │   └── panel.js            # /panel – Panel senden/aktualisieren
│   │   └── events/
│   │       ├── ready.js
│   │       ├── interactionCreate.js  # Buttons, Modals, Slash-Commands
│   │       └── messageCreate.js      # Nachrichten für Transkript loggen
│   ├── utils/
│   │   └── logger.js           # Konsolen-Logger mit Zeitstempel & Log-Level
│   └── web/
│       ├── server.js           # Express-Server Setup
│       ├── routes/
│       │   ├── auth.js         # Discord OAuth2
│       │   └── api.js          # REST-API
│       └── public/             # Statisches Frontend
│           ├── index.html
│           ├── dashboard.html
│           ├── ticket.html
│           ├── css/style.css
│           └── js/
│               ├── dashboard.js
│               └── ticket.js
└── data/
    └── tickets.db              # SQLite-Datenbank (auto-erstellt)
```

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
(über `src/bot/ticketLog.js`, gemeinsam genutzt von Bot- und Web-Pfad, damit keine Aktion vergessen wird):

| Aktion             | Inhalt                                                                | Quelle              |
|--------------------|------------------------------------------------------------------------|---------------------|
| Ticket erstellt    | Kanal, Benutzer, Kategorie                                             | 🎮 Discord / 🌐 Web |
| Ticket geschlossen | Ticket-Nr., Ersteller, wer geschlossen hat, Transkript (`.txt`-Anhang) | 🎮 Discord / 🌐 Web |
| Notiz hinzugefügt  | Ticket-Nr., Autor, Notiztext                                           | 🌐 Web (Staff)      |

Egal ob eine Aktion per Discord (Button/Slash-Command) oder über das Web-Interface ausgelöst wird,
landet sie im selben Log-Kanal – die Quelle steht im Embed.

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
