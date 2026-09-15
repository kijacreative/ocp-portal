'use strict';
/* Post a studio issue to Slack, attributed to the signed-in trainer. */
const { requireSession } = require('../_lib/session');
const { json } = require('../_lib/http');
const slack = require('../_lib/slack');

const LOCATIONS = ['Bishop Arts', 'Uptown', 'Lower Greenville'];
const AREAS = ['Lobby & front desk', 'Reformer studio', 'Bathrooms', 'Equipment', 'Building & access', 'Something else'];

module.exports = async function handler(req, res) {
  const session = requireSession(req, res);
  if (!session) return;

  if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' });
  if (!process.env.SLACK_BOT_TOKEN) {
    return json(res, 503, { error: 'Slack is not connected yet — post it in #studio-issues instead.' });
  }

  const body = typeof req.body === 'object' && req.body ? req.body : {};
  const location = LOCATIONS.includes(body.location) ? body.location : null;
  const area = AREAS.includes(body.area) ? body.area : null;
  const detail = String(body.detail || '').trim().slice(0, 1500);
  const urgent = body.urgent === true;

  if (!location) return json(res, 400, { error: 'Pick a studio.' });
  if (!area) return json(res, 400, { error: 'Pick what it relates to.' });
  if (detail.length < 10) return json(res, 400, { error: 'Add a sentence about what needs attention.' });

  const channel = process.env.SLACK_ISSUES_CHANNEL || 'studio-issues';

  try {
    const id = await slack.channelId(channel);
    const heading = `${urgent ? ':rotating_light: ' : ''}${location} — ${area}`;
    const result = await slack.post('chat.postMessage', {
      channel: id,
      text: `${heading}: ${detail}`,
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: heading, emoji: true } },
        { type: 'section', text: { type: 'plain_text', text: detail, emoji: false } },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Reported by *${session.name}* from Trainer HQ${urgent ? ' · marked urgent' : ''}`,
            },
          ],
        },
      ],
    });
    return json(res, 200, { ok: true, ts: result.ts, channel });
  } catch (err) {
    return json(res, 502, { error: `Slack refused the post: ${err.message}` });
  }
};
