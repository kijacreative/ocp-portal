'use strict';
/* Step 1 of Sign in with Slack: bounce the trainer to Slack's consent screen.
 *
 * A random `state` is stored in a short-lived cookie and echoed in the URL, so
 * the callback can tell a real return trip from a forged one (CSRF). */
const crypto = require('crypto');
const { STATE_COOKIE, serialize } = require('../../_lib/session');
const { origin } = require('../../_lib/http');

module.exports = function handler(req, res) {
  const clientId = process.env.SLACK_CLIENT_ID;
  const teamId = process.env.SLACK_TEAM_ID;
  if (!clientId) {
    res.status(500).send('SLACK_CLIENT_ID is not set.');
    return;
  }

  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = `${origin(req)}/api/auth/slack/callback`;

  const url = new URL('https://slack.com/openid/connect/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('state', state);
  url.searchParams.set('redirect_uri', redirectUri);
  // Sends the trainer straight into the right workspace rather than a picker.
  if (teamId) url.searchParams.set('team', teamId);

  res.setHeader('Set-Cookie', serialize(STATE_COOKIE, state, 600));
  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(302, { Location: url.toString() });
  res.end();
};
