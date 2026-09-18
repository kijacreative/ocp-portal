'use strict';
/* Events, announcements and the membership count.
 *
 * Two sources, because no single one has everything:
 *
 *   EVENTS_FEED_URL     events. Defaults to the public events service, so
 *                       nothing needs configuring for events to work. Set it
 *                       only to point somewhere else.
 *   ANNOUNCEMENTS_CSV_URL  a Google Sheet published to the web as CSV. No
 *                          credential of any kind — which is the point: it is
 *                          the shortest path from "someone typed it" (or a Zap
 *                          copied it out of Slack) to the page.
 *   WORKBOOK_FEED_URL      the Apps Script, if it is ever deployed. Serves the
 *                          same things plus events. Optional.
 *
 * When only one is set it supplies whatever it has. Each panel is answered
 * independently, so a missing workbook costs you announcements and the
 * counter but leaves events working, and vice versa.
 *
 * Both URLs and their tokens stay on the server; the browser only ever sees
 * the normalised result. */
const { json } = require('../_lib/http');
const csv = require('../_lib/csv');

/* The events service is public and needs no token, so it is the default rather
 * than something that has to be configured before the page works. Set
 * EVENTS_FEED_URL to point somewhere else — a staging feed, or the Apps Script
 * web app if events ever move back to the workbook. */
const DEFAULT_EVENTS_FEED = 'https://events.oakcliffpilates.com/api/feed';

/* The announcements sheet, read through the gviz CSV endpoint — which works on
 * any sheet shared as "anyone with the link can view", with no publishing step
 * and no credential. Defaulted for the same reason as the events feed: the
 * page should work on a fresh deploy with nothing configured.
 *
 * It follows that this sheet is readable by anyone who has this URL, and this
 * URL is in the repo. Everything in it is bound for a public page anyway —
 * but do not keep anything in that sheet you would not publish. */
const SHEET_ID = '1ydFIE2eJYmlign-i4Py_aEb4TY5hU9SVLBWMQw4hzRA';
const DEFAULT_ANNOUNCEMENTS_CSV =
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`;

const TTL = 2 * 60 * 1000;
let cache = null;

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/* Announcements from a published sheet.
 *
 * Reads the columns a Google Form drops into its response sheet as-is —
 * Timestamp, Title, Message, Link — so a form can be pointed at a sheet and
 * published without anyone renaming a header. Date/Body work too, for a sheet
 * somebody types into directly. A row is shown unless a Show On Site column
 * says otherwise, because a form has no such column and the answer for a
 * freshly submitted announcement should be yes. */
const COLUMN = {
  date: ['date', 'timestamp'],
  title: ['title', 'headline', 'subject'],
  body: ['body', 'message', 'details', 'announcement'],
  link: ['link', 'url'],
  show: ['show on site', 'show', 'publish'],
};

function pick(row, names) {
  for (const name of names) {
    if (row[name] != null && String(row[name]).trim() !== '') return String(row[name]).trim();
  }
  return '';
}

/* Sheets hand back whatever the locale wrote: an ISO date from a typed cell,
 * or "9/17/2026 14:23:45" from a form timestamp. Sorting by string would put
 * September before March, so both are turned into a real date. */
function readDate(value) {
  const text = String(value || '').trim();
  if (!text) return { iso: '', ms: 0 };
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return { iso: iso[0], ms: Date.parse(`${iso[0]}T12:00:00Z`) || 0 };
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2}))?/.exec(text);
  if (us) {
    const [, m, d, y, hh = '12', mm = '00'] = us;
    const pad = (n) => String(n).padStart(2, '0');
    return {
      iso: `${y}-${pad(m)}-${pad(d)}`,
      ms: Date.UTC(+y, +m - 1, +d, +hh, +mm),
    };
  }
  const loose = Date.parse(text);
  return Number.isNaN(loose) ? { iso: '', ms: 0 } : { iso: text.slice(0, 10), ms: loose };
}
async function fetchAnnouncementsCsv(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`sheet returned ${response.status}`);
  const text = await response.text();
  if (/^\s*</.test(text)) {
    // A sheet that is not actually published serves an HTML sign-in page with
    // a 200, which would otherwise parse as one nonsense row.
    throw new Error('that URL returned a web page, not CSV — is the sheet published?');
  }
  return csv
    .toObjects(text)
    .map(function (row) {
      const when = readDate(pick(row, COLUMN.date));
      return {
        date: when.iso,
        ms: when.ms,
        title: pick(row, COLUMN.title),
        body: pick(row, COLUMN.body),
        link: pick(row, COLUMN.link),
        show: pick(row, COLUMN.show),
      };
    })
    .filter(function (item) {
      const hidden = ['no', 'false', 'n', 'hide', 'hidden', '0'].indexOf(item.show.toLowerCase()) > -1;
      return !hidden && (item.title || item.body);
    })
    .sort(function (a, b) { return b.ms - a.ms; })
    .slice(0, 12);
}

async function fetchFeed(url, token) {
  const target = new URL(url);
  if (token) target.searchParams.set('token', token);
  const response = await fetch(target.toString(), { redirect: 'follow' });
  if (!response.ok) throw new Error(`feed returned ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(body.error);
  return body;
}

function freeOrPrice(value) {
  if (value == null || value === '') return '';
  const text = String(value).trim();
  return /^\$?0(\.0{1,2})?$/.test(text) ? 'Free' : text;
}

function normaliseEvent(event) {
  const when = new Date(`${event.date}T12:00:00`);
  // Whatever the source decides to call a booking link. The events service
  // currently sends only `url`, which is its own event page rather than
  // somewhere you can buy a ticket — so the moment it grows a real one under
  // any of these names, the cards pick it up with no change here.
  const ticket =
    event.ticketUrl || event.ticketLink || event.registrationUrl ||
    event.bookingUrl || event.checkoutUrl || event.url || '';
  const isTicket = Boolean(
    event.ticketUrl || event.ticketLink || event.registrationUrl ||
    event.bookingUrl || event.checkoutUrl
  );
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
    // "$0" on a card reads as a bug rather than as free admission.
    price: freeOrPrice(event.price),
    discounts: event.discounts || '',
    description: event.description || '',
    capacity: event.capacity == null ? '' : String(event.capacity),
    callTime: event.callTime || '',
    ticketUrl: /^https?:\/\//.test(ticket) ? ticket : '',
    ticketIsBooking: isTicket,
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
}

/* The membership count.
 *
 * Arketa is where the real number lives, but nothing here can reach it: the
 * Arketa MCP is a tool in a Claude session, not an API this server holds a key
 * for. So the number is carried rather than fetched, from whichever of these
 * answers first:
 *
 *   1. the workbook's SITE CONFIG tab, when that is wired up — a human editing
 *      a spreadsheet should always beat an automated number
 *   2. api/_members.js, written by the weekly refresh
 *   3. MEMBER_COUNT here, for a manual override without a deploy
 *
 * Whichever it is, it is a figure somebody took, so the page dates it rather
 * than implying it is live. */
const members = require('../_members');

function withMemberCount(config) {
  const merged = Object.assign({}, config);
  const fallbacks = {
    active_members: Number(process.env.MEMBER_COUNT) || members.active_members,
    member_goal: Number(process.env.MEMBER_GOAL) || members.member_goal,
    updated: process.env.MEMBER_COUNT_UPDATED || members.updated,
  };
  Object.keys(fallbacks).forEach(function (key) {
    if (merged[key] == null && fallbacks[key] != null) merged[key] = fallbacks[key];
  });
  return merged;
}

function normaliseAnnouncement(item) {
  return {
    date: item.date || '',
    title: String(item.title || ''),
    body: String(item.body || ''),
    link: /^https?:\/\//.test(item.link || '') ? item.link : '',
  };
}

module.exports = async function handler(req, res) {
  const eventsUrl = process.env.EVENTS_FEED_URL || DEFAULT_EVENTS_FEED;
  const workbookUrl = process.env.WORKBOOK_FEED_URL;
  const csvUrl = process.env.ANNOUNCEMENTS_CSV_URL || DEFAULT_ANNOUNCEMENTS_CSV;

  if (!eventsUrl && !workbookUrl) {
    // Still hand back the membership count: it is committed in the repo, not
    // fetched from either feed, so it has no business disappearing because a
    // feed URL is unset.
    return json(res, 200, {
      configured: false,
      upcoming: [],
      past: [],
      announcements: [],
      config: withMemberCount({}),
    });
  }

  if (cache && Date.now() - cache.at < TTL) {
    return json(res, 200, cache.body, 'public, max-age=60, s-maxage=120');
  }

  const errors = [];
  let csvAnnouncements = null;
  if (csvUrl) {
    try {
      csvAnnouncements = await fetchAnnouncementsCsv(csvUrl);
    } catch (err) {
      errors.push(`announcements: ${err.message}`);
    }
  }

  const [eventsRaw, workbookRaw] = await Promise.all(
    [
      [eventsUrl, process.env.EVENTS_FEED_TOKEN, 'events'],
      [workbookUrl, process.env.WORKBOOK_FEED_TOKEN, 'workbook'],
    ].map(async function ([url, token, label]) {
      if (!url) return null;
      try {
        return await fetchFeed(url, token);
      } catch (err) {
        errors.push(`${label}: ${err.message}`);
        return null;
      }
    })
  );

  // Events come from the events feed when there is one, otherwise from the
  // workbook — which serves them too when it is the only source configured.
  const eventSource = eventsRaw || workbookRaw;
  const eventSourceName = eventsRaw ? 'the events calendar' : workbookRaw ? 'the events workbook' : '';
  // Announcements and the counter only ever come from the workbook, except
  // when the workbook IS the events feed.
  const extras = workbookRaw || (workbookUrl ? null : eventsRaw);

  const all = ((eventSource && eventSource.events) || [])
    .filter((event) => event && event.name && event.date)
    .map(normaliseEvent);

  const floor = startOfToday();
  const body = {
    configured: true,
    upcoming: all.filter((e) => e.ms >= floor).sort((a, b) => a.ms - b.ms),
    past: all.filter((e) => e.ms < floor).sort((a, b) => b.ms - a.ms).slice(0, 6),
    announcements: (csvAnnouncements || (extras && extras.announcements) || []).map(normaliseAnnouncement),
    config: withMemberCount((extras && extras.config) || {}),
    generated: (eventSource && eventSource.generated) || null,
    eventSource: eventSourceName,
    announcementsConfigured: Boolean(csvUrl || workbookUrl || (extras && extras.announcements)),
  };
  if (errors.length) body.error = errors.join('; ');

  // Only cache a result that actually carries something.
  if (!errors.length || body.upcoming.length) cache = { at: Date.now(), body };
  if (errors.length && cache && !body.upcoming.length) {
    return json(res, 200, Object.assign({ stale: true }, cache.body, { error: body.error }));
  }
  return json(res, 200, body, 'public, max-age=60, s-maxage=120');
};
