'use strict';
/* Thin Slack Web API client — no SDK, no dependencies.
 *
 * Channel and user lookups are cached in module scope, which survives between
 * warm invocations of the same function instance. A cold start just refetches. */
const { esc } = require('./http');

const API = 'https://slack.com/api/';
const channelCache = new Map(); // name -> { id, at }
const userCache = new Map(); // id -> { name, avatar, at }
const TTL = 10 * 60 * 1000;

function token() {
  const value = process.env.SLACK_BOT_TOKEN;
  if (!value) throw new Error('SLACK_BOT_TOKEN is not set');
  return value;
}

async function call(method, params, init) {
  const options = Object.assign(
    { headers: { Authorization: `Bearer ${token()}` } },
    init || {}
  );
  let url = API + method;
  if (params) url += `?${new URLSearchParams(params)}`;
  const response = await fetch(url, options);
  const body = await response.json();
  if (!body.ok) throw new Error(`slack ${method}: ${body.error || 'unknown error'}`);
  return body;
}

async function post(method, body) {
  const response = await fetch(API + method, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!payload.ok) throw new Error(`slack ${method}: ${payload.error || 'unknown error'}`);
  return payload;
}

/* Resolve a channel name (without the #) to its ID. */
async function channelId(name) {
  const clean = String(name || '').replace(/^#/, '');
  if (/^[CG][A-Z0-9]+$/.test(clean)) return clean; // already an ID
  const hit = channelCache.get(clean);
  if (hit && Date.now() - hit.at < TTL) return hit.id;

  let cursor = '';
  for (let page = 0; page < 10; page += 1) {
    const body = await call('conversations.list', {
      types: 'public_channel,private_channel',
      exclude_archived: 'true',
      limit: '200',
      cursor,
    });
    const match = (body.channels || []).find(function (c) {
      return c.name === clean;
    });
    if (match) {
      channelCache.set(clean, { id: match.id, at: Date.now() });
      return match.id;
    }
    cursor = (body.response_metadata && body.response_metadata.next_cursor) || '';
    if (!cursor) break;
  }
  throw new Error(`no channel called #${clean} that the bot can see`);
}

async function user(id) {
  if (!id) return { name: 'Oak Cliff Pilates', avatar: '' };
  const hit = userCache.get(id);
  if (hit && Date.now() - hit.at < TTL) return hit;
  let record = { name: 'Someone', avatar: '', at: Date.now() };
  try {
    const body = await call('users.info', { user: id });
    const profile = body.user.profile || {};
    record = {
      name: profile.display_name || profile.real_name || body.user.name || 'Someone',
      avatar: profile.image_72 || '',
      at: Date.now(),
    };
  } catch (err) {
    /* A deleted or invisible user should not sink the whole feed. */
  }
  userCache.set(id, record);
  return record;
}

/* Slack mrkdwn → safe HTML.
 *
 * The text is escaped first and the formatting patterns are then matched
 * against the escaped form, so no message can inject markup no matter what
 * someone types into Slack. Only http(s) links are ever turned into anchors. */
function render(text, names) {
  let html = esc(text || '');

  html = html.replace(/&lt;(https?:\/\/[^|&\s]+)\|([^&]*?)&gt;/g, function (m, href, label) {
    return `<a href="${href}" target="_blank" rel="noopener">${label}</a>`;
  });
  html = html.replace(/&lt;(https?:\/\/[^|&\s]+)&gt;/g, function (m, href) {
    return `<a href="${href}" target="_blank" rel="noopener">${href}</a>`;
  });
  html = html.replace(/&lt;mailto:([^|&\s]+)(?:\|[^&]*?)?&gt;/g, function (m, address) {
    return `<a href="mailto:${address}">${address}</a>`;
  });
  html = html.replace(/&lt;@([A-Z0-9]+)&gt;/g, function (m, id) {
    return `<b class="hq-mention">@${esc((names && names[id]) || 'teammate')}</b>`;
  });
  html = html.replace(/&lt;#[A-Z0-9]+\|([^&]*?)&gt;/g, '<b class="hq-mention">#$1</b>');
  html = html.replace(/&lt;!channel&gt;|&lt;!here&gt;/g, '<b class="hq-mention">@channel</b>');

  html = html.replace(/```([\s\S]+?)```/g, '<pre>$1</pre>');
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  html = html.replace(/(^|\s)\*([^*\n]+)\*/g, '$1<strong>$2</strong>');
  html = html.replace(/(^|\s)_([^_\n]+)_/g, '$1<em>$2</em>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

module.exports = { call, post, channelId, user, render };
