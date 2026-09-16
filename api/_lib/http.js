'use strict';
/* Small helpers shared by the Trainer HQ endpoints. */

function json(res, status, body, cache) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache || 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.status(status).send(JSON.stringify(body));
}

/* Escape before anything from the events sheet reaches the page. It is written
 * by people, not authored as HTML. */
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { json, esc };
