'use strict';
/* Events, read from the Apps Script feed bound to the events workbook.
 *
 * The feed URL and its token stay on the server; the browser only ever sees
 * the normalised list. If the feed is not wired up yet the endpoint says so
 * plainly rather than inventing events — a trainer reading a stale or made-up
 * call time is worse than a trainer reading "not connected". */
const { requireSession } = require('../_lib/session');
const { json } = require('../_lib/http');

const TTL = 2 * 60 * 1000;
let cache = null;

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function normalise(raw) {
  const events = (raw.events || [])
    .filter(function (event) {
      return event && event.name && event.date;
    })
    .map(function (event) {
      const when = new Date(`${event.date}T12:00:00`);
      return {
        id: String(event.id || event.name),
        name: String(event.name),
        date: event.date,
        day: String(when.getDate()).padStart(2, '0'),
        month: when.toLocaleString('en-US', { month: 'short' }),
        weekday: when.toLocaleString('en-US', { weekday: 'short' }),
        time: [event.start, event.end].filter(Boolean).join(' – '),
        dateStatus: event.dateStatus || '',
        location: event.location || '',
        format: event.format || '',
        type: event.type || '',
        price: event.price || '',
        discounts: event.discounts || '',
        description: event.description || '',
        capacity: event.capacity || '',
        callTime: event.callTime || '',
        ticketUrl: /^https?:\/\//.test(event.ticketUrl || '') ? event.ticketUrl : '',
        instructors: (event.instructors || [])
          .filter((person) => person && person.name)
          .map(function (person) {
            return {
              name: String(person.name),
              role: person.role || '',
              pay: person.pay || '',
              scope: person.scope || '',
            };
          }),
        ms: when.getTime(),
      };
    });

  const floor = startOfToday();
  const upcoming = events.filter((event) => event.ms >= floor).sort((a, b) => a.ms - b.ms);
  const past = events.filter((event) => event.ms < floor).sort((a, b) => b.ms - a.ms).slice(0, 6);
  return { upcoming, past, config: raw.config || {}, generated: raw.generated || null };
}

module.exports = async function handler(req, res) {
  if (!requireSession(req, res)) return;

  const feed = process.env.EVENTS_FEED_URL;
  if (!feed) {
    return json(res, 200, { configured: false, upcoming: [], past: [], config: {} });
  }

  if (cache && Date.now() - cache.at < TTL) {
    return json(res, 200, cache.body, 'private, max-age=120');
  }

  try {
    const url = new URL(feed);
    if (process.env.EVENTS_FEED_TOKEN) url.searchParams.set('token', process.env.EVENTS_FEED_TOKEN);
    const response = await fetch(url.toString(), { redirect: 'follow' });
    if (!response.ok) throw new Error(`feed returned ${response.status}`);
    const raw = await response.json();
    if (raw.error) throw new Error(raw.error);

    const body = Object.assign({ configured: true }, normalise(raw));
    cache = { at: Date.now(), body };
    return json(res, 200, body, 'private, max-age=120');
  } catch (err) {
    if (cache) {
      return json(res, 200, Object.assign({ stale: true, error: err.message }, cache.body));
    }
    return json(res, 200, { configured: true, upcoming: [], past: [], config: {}, error: err.message });
  }
};
