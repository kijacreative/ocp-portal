'use strict';
/* The passcode gate.
 *
 * One shared code in HQ_PASSCODE. A correct entry sets a cookie carrying
 * nothing but an expiry and a signature, so a browser can hold it for 30 days
 * but cannot forge one.
 *
 * The signing key is derived from the passcode itself rather than kept
 * separately: one secret to manage, and changing the passcode invalidates
 * every existing cookie, which is what anyone changing it expects to happen.
 *
 * Both the passcode comparison and the signature check are constant-time. */
const crypto = require('crypto');

const COOKIE = 'ocp_hq';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function passcode() {
  const value = process.env.HQ_PASSCODE;
  return value && value.trim() ? value.trim() : null;
}

function key() {
  return crypto.createHash('sha256').update(`ocp-hq|${passcode()}`).digest();
}

function hmac(data) {
  return crypto.createHmac('sha256', key()).update(data).digest('base64url');
}

/* Constant-time compare that does not leak length through an early return. */
function same(a, b) {
  const left = crypto.createHash('sha256').update(String(a)).digest();
  const right = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(left, right);
}

function mint() {
  const body = String(Math.floor(Date.now() / 1000) + MAX_AGE);
  return `${body}.${hmac(body)}`;
}

function valid(token) {
  if (!passcode() || typeof token !== 'string') return false;
  const cut = token.lastIndexOf('.');
  if (cut < 1) return false;
  const body = token.slice(0, cut);
  if (!same(token.slice(cut + 1), hmac(body))) return false;
  const expires = Number(body);
  return Number.isFinite(expires) && expires * 1000 > Date.now();
}

function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(function (part) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  });
  return out;
}

function serialize(value, maxAge) {
  return [
    `${COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ].join('; ');
}

function unlocked(req) {
  return valid(cookies(req)[COOKIE]);
}

/* Guard for the JSON endpoints: the data behind the gate should not be
 * readable just because somebody skipped the page. */
function requireUnlocked(req, res) {
  if (unlocked(req)) return true;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(401).send(JSON.stringify({ error: 'Locked.' }));
  return false;
}

module.exports = { COOKIE, MAX_AGE, passcode, mint, valid, cookies, serialize, unlocked, requireUnlocked, same };
