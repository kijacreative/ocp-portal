'use strict';
/* Events, announcements and the membership count.
 *
 * Two sources, because no single one has everything:
 *
 *   EVENTS_FEED_URL     events. Either the events service at
 *                       events.oakcliffpilates.com/api/feed, or the Apps
 *                       Script web app bound to the events workbook.
 *   WORKBOOK_FEED_URL   the Apps Script: announcements, the membership count,
 *                       and where the issue form logs. Optional.
 *
 * When only one is set it supplies whatever it has. Each panel is answered
 * independently, so a missing workbook costs you announcements and the
 * counter but leaves events working, and vice versa.
 *
 * Both URLs and their tokens stay on the server; the browser only ever sees
 * the normalised result. */
const { json } = require('../_lib/http');

const TTL = 2 * 60 * 1000;
let cache = null;

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
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
  // The events service calls it `url`; the Apps Script calls it `ticketUrl`.
  const ticket = event.ticketUrl || event.url || '';
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
  const eventsUrl = process.env.EVENTS_FEED_URL;
  const workbookUrl = process.env.WORKBOOK_FEED_URL;

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
    announcements: ((extras && extras.announcements) || []).map(normaliseAnnouncement),
    config: withMemberCount((extras && extras.config) || {}),
    generated: (eventSource && eventSource.generated) || null,
    eventSource: eventSourceName,
    announcementsConfigured: Boolean(workbookUrl || (extras && extras.announcements)),
  };
  if (errors.length) body.error = errors.join('; ');

  // Only cache a result that actually carries something.
  if (!errors.length || body.upcoming.length) cache = { at: Date.now(), body };
  if (errors.length && cache && !body.upcoming.length) {
    return json(res, 200, Object.assign({ stale: true }, cache.body, { error: body.error }));
  }
  return json(res, 200, body, 'public, max-age=60, s-maxage=120');
};
