'use strict';
/* Latest posts from a Slack channel, for the Announcements panel. */
const { requireSession } = require('../_lib/session');
const { json } = require('../_lib/http');
const slack = require('../_lib/slack');

const cache = new Map(); // channel -> { at, body }
const TTL = 60 * 1000;

const SKIP = new Set([
  'channel_join',
  'channel_leave',
  'channel_topic',
  'channel_purpose',
  'channel_name',
  'bot_add',
  'bot_remove',
]);

module.exports = async function handler(req, res) {
  if (!requireSession(req, res)) return;

  const url = new URL(req.url, 'https://placeholder.invalid');
  const channel =
    url.searchParams.get('channel') || process.env.SLACK_ANNOUNCEMENTS_CHANNEL || 'general';
  const limit = Math.min(parseInt(url.searchParams.get('limit'), 10) || 3, 10);
  const key = `${channel}:${limit}`;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return json(res, 200, hit.body, 'private, max-age=60');

  if (!process.env.SLACK_BOT_TOKEN) {
    return json(res, 200, { configured: false, posts: [], channel });
  }

  try {
    const id = await slack.channelId(channel);
    const history = await slack.call('conversations.history', {
      channel: id,
      limit: String(limit + 8),
    });

    const usable = (history.messages || [])
      .filter(function (m) {
        return m.type === 'message' && !SKIP.has(m.subtype) && (m.text || '').trim();
      })
      .slice(0, limit);

    const names = {};
    await Promise.all(
      Array.from(new Set(usable.map((m) => m.user).filter(Boolean))).map(async function (uid) {
        names[uid] = (await slack.user(uid)).name;
      })
    );

    const posts = await Promise.all(
      usable.map(async function (message) {
        const who = message.user ? await slack.user(message.user) : { name: message.username || 'Oak Cliff Pilates', avatar: '' };
        let permalink = '';
        try {
          permalink = (await slack.call('chat.getPermalink', { channel: id, message_ts: message.ts })).permalink;
        } catch (err) {
          /* Not fatal — the post still renders, just without a jump link. */
        }
        return {
          id: message.ts,
          author: who.name,
          avatar: who.avatar,
          at: Math.floor(Number(message.ts) * 1000),
          html: slack.render(message.text, names),
          permalink,
        };
      })
    );

    const body = { configured: true, channel, posts };
    cache.set(key, { at: Date.now(), body });
    return json(res, 200, body, 'private, max-age=60');
  } catch (err) {
    return json(res, 200, { configured: true, channel, posts: [], error: err.message });
  }
};
