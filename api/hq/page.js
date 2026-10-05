'use strict';
/* Serves Trainer HQ, behind the studio passcode.
 *
 * The page carries door codes, pay rates and promo codes, so it is a function
 * rather than a static file: there is no URL that serves the compiled page
 * without passing through this check. */
const { unlocked, passcode } = require('../_lib/session');
const page = require('../_page');

module.exports = function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');

  // Fail closed. An unset passcode means the gate cannot work, and serving the
  // page anyway would publish door codes to anyone who found the URL.
  if (!passcode()) {
    return res.status(503).send(page.lock('Not configured yet — HQ_PASSCODE is not set.'));
  }
  if (!unlocked(req)) return res.status(200).send(page.lock(''));
  return res.status(200).send(page.render());
};
