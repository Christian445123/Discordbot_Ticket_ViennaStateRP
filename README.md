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

| Option          | Beschreibung                                                    |
|-----------------|---------------------------------------------------------------- |
| `kategorie`     | Kategorie, in der neue Ticket-Kanäle angelegt werden           |
| `log_kanal`     | Kanal für Logs & Transkripte beim Schließen                    |
| `staff_rolle`   | Rolle, die alle Ticket-Kanäle sehen & verwalten darf           |
| `panel_kanal`   | Kanal, in dem das Ticket-Erstellungs-Panel gepostet wird       |

## Ticket-Kategorien

- Support
- Bug-Report
- Bewerbung
- Beschwerde
- Allgemein

## Projektstruktur

```
├── index.js                    # Einstiegspunkt (Bot + Web-Server)
├── src/
│   ├── database/
│   │   └── db.js               # SQLite-Datenbank (better-sqlite3)
│   ├── bot/
│   │   ├── bot.js              # Discord-Client mit Command/Event-Loader
│   │   ├── deploy-commands.js  # Slash-Command Registrierung
│   │   ├── commands/
│   │   │   ├── setup.js        # /setup – System einrichten
│   │   │   └── close.js        # /close – Ticket schließen
│   │   └── events/
│   │       ├── ready.js
│   │       ├── interactionCreate.js  # Buttons, Modals, Slash-Commands
│   │       └── messageCreate.js      # Nachrichten für Transkript loggen
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

## Produktion

Für den Produktionseinsatz empfiehlt sich:
- Reverse-Proxy (nginx/Caddy) mit HTTPS
- `SESSION_SECRET` in `.env` als langen, zufälligen String setzen
- `cookie.secure = true` in `src/web/server.js` aktivieren (bei HTTPS)
- Prozessmanager (PM2): `pm2 start index.js --name ticket-bot`
