'use strict';
/* Takes the studio passcode and, if it is right, sets the cookie.
 *
 * A plain form post rather than fetch, so the gate still works with no
 * JavaScript. Wrong attempts are rate limited per address: a four-word
 * passcode is guessable at speed otherwise. */
const { passcode, mint, serialize, same, MAX_AGE, COOKIE } = require('../_lib/session');
const page = require('../_page');

const WINDOW = 10 * 60 * 1000;
const PER_WINDOW = 10;
const tries = new Map();

function tooMany(req) {
  const who = (req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const hits = (tries.get(who) || []).filter((at) => now - at < WINDOW);
  hits.push(now);
  tries.set(who, hits);
  if (tries.size > 500) {
    for (const [key, times] of tries) if (!times.some((at) => now - at < WINDOW)) tries.delete(key);
  }
  return hits.length > PER_WINDOW;
}

function body(req) {
  if (typeof req.body === 'string') return new URLSearchParams(req.body);
  if (req.body && typeof req.body === 'object') return new Map(Object.entries(req.body));
  return new Map();
}

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');

  if (req.method !== 'POST') {
    res.writeHead(302, { Location: '/' });
    return res.end();
  }
  if (!passcode()) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(503).send(page.lock('Not configured yet — HQ_PASSCODE is not set.'));
  }
  if (tooMany(req)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(429).send(page.lock('Too many tries. Wait a few minutes.'));
  }

  const given = String(body(req).get('passcode') || '').trim();
  if (!given || !same(given, passcode())) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(401).send(page.lock('That passcode did not work.'));
  }

  res.setHeader('Set-Cookie', serialize(mint(), MAX_AGE));
  res.writeHead(303, { Location: '/' });
  return res.end();
};
