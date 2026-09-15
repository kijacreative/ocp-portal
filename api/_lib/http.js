'use strict';
/* Small helpers shared by the Trainer HQ endpoints. */

/* The public origin of this deployment, from the proxy headers Vercel sets.
 * Used to build the OAuth redirect_uri, which must match byte for byte. */
function origin(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function json(res, status, body, cache) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache || 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.status(status).send(JSON.stringify(body));
}

/* Escape before anything from Slack or the events sheet reaches the page.
 * Both are internal, but neither is authored as HTML. */
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { origin, json, esc };
