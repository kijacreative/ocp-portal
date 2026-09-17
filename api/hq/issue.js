'use strict';
/* Log a studio issue into the events workbook, through the Apps Script web app
 * named by WORKBOOK_FEED_URL. The events service does not accept writes, so
 * this is the workbook or nothing.
 *
 * This endpoint is public, because the page is. Two consequences are handled
 * here rather than hoped away: every field is bounded, and one browser can
 * only file a few reports a minute. The workbook is the destination, so the
 * worst case is rows somebody deletes — not mail sent or money moved. */
const { json } = require('../_lib/http');

const LOCATIONS = ['Bishop Arts', 'Uptown', 'Lower Greenville'];
const AREAS = ['Lobby & front desk', 'Reformer studio', 'Bathrooms', 'Equipment', 'Building & access', 'Something else'];

const WINDOW = 60 * 1000;
const PER_WINDOW = 4;
const seen = new Map();

function tooMany(req) {
  const who = (req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const hits = (seen.get(who) || []).filter((at) => now - at < WINDOW);
  hits.push(now);
  seen.set(who, hits);
  if (seen.size > 500) {
    for (const [key, times] of seen) if (!times.some((at) => now - at < WINDOW)) seen.delete(key);
  }
  return hits.length > PER_WINDOW;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' });

  const feed = process.env.WORKBOOK_FEED_URL;
  if (!feed) {
    return json(res, 503, { error: 'Not connected to the workbook yet — tell Charley directly for now.' });
  }
  if (tooMany(req)) {
    return json(res, 429, { error: 'That is a lot of reports at once. Give it a minute.' });
  }

  const body = typeof req.body === 'object' && req.body ? req.body : {};
  const location = LOCATIONS.includes(body.location) ? body.location : null;
  const area = AREAS.includes(body.area) ? body.area : null;
  const detail = String(body.detail || '').trim().slice(0, 1500);
  const reporter = String(body.reporter || '').trim().slice(0, 80);

  if (!reporter) return json(res, 400, { error: 'Add your name so we know who to ask.' });
  if (!location) return json(res, 400, { error: 'Pick a studio.' });
  if (!area) return json(res, 400, { error: 'Pick what it relates to.' });
  if (detail.length < 10) return json(res, 400, { error: 'Add a sentence about what needs attention.' });

  try {
    const url = new URL(feed);
    if (process.env.WORKBOOK_FEED_TOKEN) url.searchParams.set('token', process.env.WORKBOOK_FEED_TOKEN);
    const response = await fetch(url.toString(), {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location, area, detail, reporter, urgent: body.urgent === true }),
    });
    const result = await response.json();
    if (result.error) throw new Error(result.error);
    return json(res, 200, { ok: true });
  } catch (err) {
    return json(res, 502, { error: `Could not log it: ${err.message}` });
  }
};
