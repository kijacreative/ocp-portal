'use strict';
/* Signed session cookie for Trainer HQ.
 *
 * The cookie carries the signed-in trainer's Slack identity and nothing else —
 * no token, no scopes. It is HMAC-SHA256 signed with HQ_SESSION_SECRET, so a
 * browser can read it but cannot forge one. Verification is constant-time.
 */
const crypto = require('crypto');

const COOKIE = 'ocp_hq';
const STATE_COOKIE = 'ocp_hq_state';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function secret() {
  const value = process.env.HQ_SESSION_SECRET;
  if (!value) throw new Error('HQ_SESSION_SECRET is not set');
  return value;
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function hmac(data) {
  return crypto.createHmac('sha256', secret()).update(data).digest('base64url');
}

function sign(claims) {
  const body = b64url(JSON.stringify(claims));
  return `${body}.${hmac(body)}`;
}

function verify(token) {
  if (typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const cut = token.lastIndexOf('.');
  const body = token.slice(0, cut);
  const given = Buffer.from(token.slice(cut + 1));
  const want = Buffer.from(hmac(body));
  if (given.length !== want.length) return null;
  if (!crypto.timingSafeEqual(given, want)) return null;
  let claims;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch (err) {
    return null;
  }
  if (!claims || typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now()) return null;
  return claims;
}

function cookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach(function (part) {
    const eq = part.indexOf('=');
    if (eq < 0) return;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  });
  return out;
}

function serialize(name, value, maxAge) {
  const bits = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  return bits.join('; ');
}

/* The signed-in trainer, or null. */
function readSession(req) {
  return verify(cookies(req)[COOKIE]);
}

function issue(res, user) {
  const claims = {
    uid: user.uid,
    name: user.name,
    pic: user.pic || '',
    exp: Math.floor(Date.now() / 1000) + MAX_AGE,
  };
  res.setHeader('Set-Cookie', serialize(COOKIE, sign(claims), MAX_AGE));
  return claims;
}

function clear(res) {
  res.setHeader('Set-Cookie', serialize(COOKIE, '', 0));
}

/* Guard for the JSON endpoints. Returns the session, or answers 401 and null. */
function requireSession(req, res) {
  const session = readSession(req);
  if (!session) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(401).send(JSON.stringify({ error: 'Not signed in' }));
    return null;
  }
  return session;
}

module.exports = {
  COOKIE,
  STATE_COOKIE,
  MAX_AGE,
  sign,
  verify,
  cookies,
  serialize,
  readSession,
  requireSession,
  issue,
  clear,
};
