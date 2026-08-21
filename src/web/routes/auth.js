'use strict';

const express  = require('express');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;

const router = express.Router();

// ── Passport setup ────────────────────────────────────────────────────────────
passport.use(new DiscordStrategy(
  {
    clientID:     process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL:  `${process.env.BASE_URL}/auth/discord/callback`,
    scope:        ['identify', 'guilds'],
  },
  (_accessToken, _refreshToken, profile, done) => done(null, profile),
));

passport.serializeUser((user, done)   => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// ── Routes ────────────────────────────────────────────────────────────────────
router.get('/discord', passport.authenticate('discord'));

router.get('/discord/callback',
  passport.authenticate('discord', { failureRedirect: '/' }),
  (_req, res) => res.redirect('/admin'),
);

router.get('/logout', (req, res, next) => {
  req.logout(err => {
    if (err) return next(err);
    res.redirect('/');
  });
});

module.exports = router;
