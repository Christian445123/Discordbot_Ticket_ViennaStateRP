'use strict';

const express  = require('express');
const session  = require('express-session');
const passport = require('passport');
const path     = require('path');

const authRoutes   = require('./routes/auth');
const moduleLoader = require('../core/moduleLoader');
const guildContext = require('./guildContext');
const guards       = require('../core/guards');

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
  // and whether the user is a real Discord Administrator on it follow —
  // every module route runs behind both except the identity/guild-picker
  // endpoints (see guildContext.js for the allowlist). The web interface is
  // admin-only.
  apiRouter.use(
    guildContext.requireAuth,
    guildContext.resolveGuildId,
    guildContext.requireGuildAdmin(discordClient),
  );

  // Guilds the logged-in user administrates and the bot is also in — powers
  // the admin panel's guild switcher. Cross-cutting, so it lives here rather
  // than in any single module. Bot owners (SUPER_ADMIN_IDS) see every guild
  // the bot is in, not just ones they personally happen to be a member of —
  // "full access to everything" includes guilds they haven't joined.
  apiRouter.get('/guilds', async (req, res) => {
    if (guards.isSuperAdmin(req.user.id)) {
      return res.json(discordClient.guilds.cache.map(g => ({ id: g.id, name: g.name })));
    }
    const botGuildIds = new Set(discordClient.guilds.cache.map(g => g.id));
    const candidates  = (req.user.guilds ?? []).filter(g => botGuildIds.has(g.id));
    const adminFlags  = await Promise.all(
      candidates.map(g => guards.isGuildAdmin(discordClient, g.id, req.user.id)),
    );
    const guilds = candidates
      .filter((_, i) => adminFlags[i])
      .map(g => ({ id: g.id, name: g.name }));
    res.json(guilds);
  });

  moduleLoader.registerRoutes(apiRouter, { discordClient });
  app.use('/api', apiRouter);

  // ── Page routes ─────────────────────────────────────────────────────────────
  app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

  app.get('/admin', requireLogin, (_req, res) =>
    res.sendFile(path.join(__dirname, 'public', 'admin.html')));

  app.get('/admin/ticket/:id', requireLogin, (_req, res) =>
    res.sendFile(path.join(__dirname, 'public', 'admin-ticket.html')));

  // ── 404 handler ─────────────────────────────────────────────────────────────
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  return app;
}

function requireLogin(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/');
}

module.exports = { createWebServer };
