'use strict';
/* Record a trainer's opt-in to the quarterly bonus programme.
 *
 * Same shape as the issue form: posts to a Google Form, so the acknowledgments
 * land in a spreadsheet with no credential held here.
 *
 * Worth being clear about what this is and is not. The page has no sign-in, so
 * this records that somebody submitted a name and an email — it does not prove
 * who. For an acknowledgment that has to hold up, see the note in README under
 * "The opt-in is not a signature". */
const { json } = require('../_lib/http');

const LOCATIONS = ['Bishop Arts', 'Uptown', 'Lower Greenville', 'Multiple'];

const WINDOW = 60 * 1000;
const PER_WINDOW = 3;
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

  const action = process.env.BONUS_FORM_URL;
  if (!action) {
    return json(res, 503, {
      error: 'Opt-in is not connected yet — email Charley to be included for now.',
    });
  }
  if (tooMany(req)) return json(res, 429, { error: 'Give it a minute and try again.' });

  const body = typeof req.body === 'object' && req.body ? req.body : {};
  const name = String(body.name || '').trim().slice(0, 80);
  const email = String(body.email || '').trim().slice(0, 120);
  const location = LOCATIONS.includes(body.location) ? body.location : null;
  const code = String(body.code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);

  if (!name) return json(res, 400, { error: 'Add your full name.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, 400, { error: 'Check the email address.' });
  if (!location) return json(res, 400, { error: 'Pick your primary location.' });
  if (!code) return json(res, 400, { error: 'Pick a promo code — letters and numbers only.' });
  if (body.ack_requirements !== true) {
    return json(res, 400, { error: 'Tick the box to confirm you have read the requirements.' });
  }

  let fields = {};
  try {
    fields = JSON.parse(process.env.BONUS_FORM_FIELDS || '{}');
  } catch (err) {
    return json(res, 500, { error: 'BONUS_FORM_FIELDS is not valid JSON.' });
  }

  const payload = new URLSearchParams();
  const put = (key, value) => { if (fields[key] && value) payload.set(fields[key], value); };
  put('name', name);
  put('email', email);
  put('location', location);
  put('code', code);
  put('ack_requirements', 'Yes');

  try {
    const response = await fetch(action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payload,
      redirect: 'follow',
    });
    if (!response.ok) {
      throw new Error(
        response.status === 400
          ? 'Google rejected the form fields — check BONUS_FORM_FIELDS'
          : `the form returned ${response.status}`
      );
    }
    return json(res, 200, { ok: true });
  } catch (err) {
    return json(res, 502, { error: `Could not record it: ${err.message}` });
  }
};
