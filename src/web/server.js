'use strict';

const express  = require('express');
const session  = require('express-session');
const passport = require('passport');
const path     = require('path');

const authRoutes   = require('./routes/auth');
const moduleLoader = require('../core/moduleLoader');
const guildContext = require('./guildContext');

function createWebServer(discordClient) {
  const app = express();

  // ── Middleware ──────────────────────────────────────────────────────────────
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use(session({
    secret:            process.env.SESSION_SECRET,
    resave:            false,
    saveUninitialized: false,
    cookie: {
      secure:   false,   // set true if using HTTPS
      httpOnly: true,
      maxAge:   7 * 24 * 60 * 60 * 1000,  // 7 days
    },
  }));

  app.use(passport.initialize());
  app.use(passport.session());

  // ── Static files ────────────────────────────────────────────────────────────
  app.use(express.static(path.join(__dirname, 'public')));

  // ── Routes ──────────────────────────────────────────────────────────────────
  app.use('/auth', authRoutes);

  const apiRouter = express.Router();

  // Every /api route requires a session; which guild the request is about
  // and whether that guild's license is valid follow — every module route
  // runs behind this except the identity/guild-picker/license endpoints
  // (see guildContext.js for the allowlist).
  apiRouter.use(guildContext.requireAuth, guildContext.resolveGuildId, guildContext.requireLicense);

  // Guilds the logged-in user and the bot have in common — powers the
  // dashboard's guild switcher. Cross-cutting, so it lives here rather than
  // in any single module.
  apiRouter.get('/guilds', (req, res) => {
    const botGuildIds = new Set(discordClient.guilds.cache.map(g => g.id));
    const guilds = (req.user.guilds ?? [])
      .filter(g => botGuildIds.has(g.id))
      .map(g => ({ id: g.id, name: g.name }));
    res.json(guilds);
  });

  moduleLoader.registerRoutes(apiRouter, { discordClient });
  app.use('/api', apiRouter);

  // ── Page routes ─────────────────────────────────────────────────────────────
  app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

  app.get('/dashboard', requireLogin, (_req, res) =>
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

  app.get('/ticket/:id', requireLogin, (_req, res) =>
    res.sendFile(path.join(__dirname, 'public', 'ticket.html')));

  app.get('/moderation', requireLogin, (_req, res) =>
    res.sendFile(path.join(__dirname, 'public', 'moderation.html')));

  app.get('/team', requireLogin, (_req, res) =>
    res.sendFile(path.join(__dirname, 'public', 'team.html')));

  app.get('/lizenz', requireLogin, (_req, res) =>
    res.sendFile(path.join(__dirname, 'public', 'lizenz.html')));

  // ── 404 handler ─────────────────────────────────────────────────────────────
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  return app;
}

function requireLogin(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/');
}

module.exports = { createWebServer };
