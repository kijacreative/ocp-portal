'use strict';
/* Serves Trainer HQ — the page itself to a signed-in trainer, the sign-in
 * screen to everyone else. vercel.json rewrites / and /trainer-hq here, and the
 * compiled page never exists as a static file, so this check cannot be
 * walked around by guessing a URL. */
const { readSession } = require('../_lib/session');
const page = require('../_page');

module.exports = function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');

  let session = null;
  try {
    session = readSession(req);
  } catch (err) {
    res.status(500).send('Trainer HQ is not configured yet: HQ_SESSION_SECRET is missing.');
    return;
  }

  res.status(200).send(session ? page.render(session) : page.login);
};
