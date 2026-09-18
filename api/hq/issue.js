'use strict';
/* Log a studio issue.
 *
 * Two possible destinations, whichever is configured:
 *
 *   ISSUE_FORM_URL    a Google Form. The server posts the response exactly as
 *                     a browser would, so the answers land in the form's
 *                     spreadsheet. No credential anywhere — which is why this
 *                     is the default recommendation. Google's own notification
 *                     settings are what email info@oakcliffpilates.com.
 *   WORKBOOK_FEED_URL the Apps Script, if it is ever deployed. Appends to the
 *                     STUDIO ISSUES tab.
 *
 * This endpoint is public, because the page is. Two consequences are handled
 * rather than hoped away: every field is bounded and checked against a known
 * list, and one browser only gets a few reports a minute. The destination is a
 * spreadsheet either way, so the worst case is rows somebody deletes. */
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

/* Which Google Form field takes which answer, e.g.
 * {"reporter":"entry.123","location":"entry.456","area":"entry.789","detail":"entry.101","urgent":"entry.112"} */
function formFields() {
  try {
    return JSON.parse(process.env.ISSUE_FORM_FIELDS || '{}');
  } catch (err) {
    return {};
  }
}

async function sendToGoogleForm(report) {
  const fields = formFields();
  if (!fields.detail) throw new Error('ISSUE_FORM_FIELDS is missing the detail field');

  const body = new URLSearchParams();
  const put = (key, value) => {
    if (fields[key] && value) body.set(fields[key], value);
  };
  put('reporter', report.reporter);
  put('location', report.location);
  put('area', report.area);
  put('detail', report.detail);
  put('urgent', report.urgent ? 'Urgent' : '');

  // Google answers a successful submission with a 200 confirmation page, and a
  // mis-mapped field with a 400 — so the status is the only signal there is.
  const response = await fetch(process.env.ISSUE_FORM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new Error(
      response.status === 400
        ? 'Google rejected the form fields — check ISSUE_FORM_FIELDS against the form'
        : `the form returned ${response.status}`
    );
  }
}

async function sendToWorkbook(report) {
  const url = new URL(process.env.WORKBOOK_FEED_URL);
  if (process.env.WORKBOOK_FEED_TOKEN) url.searchParams.set('token', process.env.WORKBOOK_FEED_TOKEN);
  const response = await fetch(url.toString(), {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
  });
  const result = await response.json();
  if (result.error) throw new Error(result.error);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' });

  const hasForm = Boolean(process.env.ISSUE_FORM_URL);
  const hasWorkbook = Boolean(process.env.WORKBOOK_FEED_URL);
  if (!hasForm && !hasWorkbook) {
    return json(res, 503, {
      error: 'Issue reporting is not connected yet — tell Charley directly for now.',
    });
  }
  if (tooMany(req)) {
    return json(res, 429, { error: 'That is a lot of reports at once. Give it a minute.' });
  }

  const body = typeof req.body === 'object' && req.body ? req.body : {};
  const report = {
    reporter: String(body.reporter || '').trim().slice(0, 80),
    location: LOCATIONS.includes(body.location) ? body.location : null,
    area: AREAS.includes(body.area) ? body.area : null,
    detail: String(body.detail || '').trim().slice(0, 1500),
    urgent: body.urgent === true,
  };

  if (!report.reporter) return json(res, 400, { error: 'Add your name so we know who to ask.' });
  if (!report.location) return json(res, 400, { error: 'Pick a studio.' });
  if (!report.area) return json(res, 400, { error: 'Pick what it relates to.' });
  if (report.detail.length < 10) {
    return json(res, 400, { error: 'Add a sentence about what needs attention.' });
  }

  try {
    if (hasForm) await sendToGoogleForm(report);
    else await sendToWorkbook(report);
    return json(res, 200, { ok: true });
  } catch (err) {
    return json(res, 502, { error: `Could not log it: ${err.message}` });
  }
};
