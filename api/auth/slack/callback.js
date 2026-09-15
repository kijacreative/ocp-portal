'use strict';
/* Step 2 of Sign in with Slack: trade the code for an identity, then sign in.
 *
 * The code is exchanged server-side over TLS directly with Slack, so the
 * id_token arrives from a trusted channel and its claims are used as they
 * stand. Access is still refused unless the identity belongs to the one
 * workspace named in SLACK_TEAM_ID — otherwise any Slack user anywhere could
 * sign in to the studio's internal page. */
const crypto = require('crypto');
const { STATE_COOKIE, MAX_AGE, COOKIE, sign, serialize, cookies } = require('../../_lib/session');
const { origin } = require('../../_lib/http');

function fail(res, message) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(403).send(
    `<!doctype html><meta charset="utf-8"><title>Sign-in failed</title>` +
      `<body style="background:#0B0B0B;color:#F4EFE6;font:16px/1.6 system-ui;padding:48px">` +
      `<h1 style="font-size:22px">Sign-in failed</h1><p>${message}</p>` +
      `<p><a href="/trainer-hq" style="color:#C9A24A">Try again</a></p></body>`
  );
}

function claimsFrom(idToken) {
  const parts = String(idToken).split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (err) {
    return null;
  }
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'https://placeholder.invalid');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expected = cookies(req)[STATE_COOKIE];

  if (!code || !state || !expected) return fail(res, 'The sign-in link expired. Start again.');

  const given = Buffer.from(state);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
    return fail(res, 'That sign-in request did not start here.');
  }

  let payload;
  try {
    const response = await fetch('https://slack.com/api/openid.connect.token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: process.env.SLACK_CLIENT_ID || '',
        client_secret: process.env.SLACK_CLIENT_SECRET || '',
        redirect_uri: `${origin(req)}/api/auth/slack/callback`,
      }),
    });
    payload = await response.json();
  } catch (err) {
    return fail(res, 'Could not reach Slack. Try again in a moment.');
  }

  if (!payload || !payload.ok || !payload.id_token) {
    return fail(res, 'Slack refused the sign-in.');
  }

  const claims = claimsFrom(payload.id_token);
  if (!claims) return fail(res, 'Slack returned an identity we could not read.');

  const team = claims['https://slack.com/team_id'];
  const wanted = process.env.SLACK_TEAM_ID;
  if (!wanted || team !== wanted) {
    return fail(res, 'That Slack account is not in the Oak Cliff Pilates workspace.');
  }

  const session = {
    uid: claims['https://slack.com/user_id'] || claims.sub || '',
    name: claims.name || claims.email || 'Trainer',
    pic: claims['https://slack.com/user_image_72'] || claims.picture || '',
    exp: Math.floor(Date.now() / 1000) + MAX_AGE,
  };

  res.setHeader('Set-Cookie', [
    serialize(COOKIE, sign(session), MAX_AGE),
    serialize(STATE_COOKIE, '', 0),
  ]);
  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(302, { Location: '/trainer-hq' });
  res.end();
};
