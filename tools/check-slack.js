'use strict';
/* Check the Slack side of the setup without printing the token.
 *
 *     node tools/check-slack.js
 *
 * Reads SLACK_BOT_TOKEN from .env (or the environment), then reports what the
 * bot can actually see. It prints the team id — which is not a secret, it is in
 * every Slack URL — and never the token itself, so the output is safe to paste
 * anywhere, including back into a chat.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(function (line) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^"|"$/g, '');
  });
}

const token = process.env.SLACK_BOT_TOKEN;
const announcements = process.env.SLACK_ANNOUNCEMENTS_CHANNEL || 'general';
const issues = process.env.SLACK_ISSUES_CHANNEL || 'studio-issues';

const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => console.log(`  ✗ ${m}`);

async function call(method, params) {
  const url = `https://slack.com/api/${method}` + (params ? `?${new URLSearchParams(params)}` : '');
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  return response.json();
}

async function channels() {
  const found = new Map();
  let cursor = '';
  for (let page = 0; page < 10; page += 1) {
    const body = await call('conversations.list', {
      types: 'public_channel,private_channel',
      exclude_archived: 'true',
      limit: '200',
      cursor,
    });
    if (!body.ok) throw new Error(body.error);
    (body.channels || []).forEach((c) => found.set(c.name, c));
    cursor = (body.response_metadata && body.response_metadata.next_cursor) || '';
    if (!cursor) break;
  }
  return found;
}

(async function main() {
  console.log('\nSlack setup check\n');

  if (!token) {
    bad('SLACK_BOT_TOKEN is not set.');
    console.log('\n    Put it in .env without it touching your shell history:\n');
    console.log('      cd ~/ocp-portal && cp -n .env.example .env');
    console.log('      read -rs TOKEN && printf \'SLACK_BOT_TOKEN=%s\\n\' "$TOKEN" >> .env && unset TOKEN\n');
    process.exit(1);
  }
  if (!/^xoxb-/.test(token)) {
    // The prefix says which token it is, and picking the wrong one is the most
    // common setup mistake — worth naming precisely rather than letting Slack
    // answer with a bare invalid_auth.
    const kinds = {
      'xoxp-': 'a user token',
      'xoxe-': 'a refresh token',
      'xapp-': 'an app-level token',
      'xoxa-': 'a workspace token',
    };
    const prefix = token.slice(0, 5);
    bad(`That is ${kinds[prefix] || 'not a bot token'} (starts "${prefix}").`);
    console.log('    Trainer HQ needs the Bot User OAuth Token, which starts "xoxb-".');
    console.log('    Your app \u2192 OAuth & Permissions \u2192 OAuth Tokens for Your Workspace.\n');
    process.exit(1);
  }

  const auth = await call('auth.test');
  if (!auth.ok) {
    bad(`Slack rejected the token: ${auth.error}`);
    if (auth.error === 'invalid_auth') console.log('    Reinstall the app and copy the token again.\n');
    process.exit(1);
  }
  ok(`Token works — signed in as "${auth.user}" in "${auth.team}"`);
  console.log(`      SLACK_TEAM_ID=${auth.team_id}`);

  const wanted = process.env.SLACK_TEAM_ID;
  if (wanted && wanted !== auth.team_id) {
    bad(`SLACK_TEAM_ID is set to ${wanted}, which is not this workspace. Sign-in will refuse everyone.`);
  } else if (wanted) {
    ok('SLACK_TEAM_ID matches this workspace');
  } else {
    console.log('      (not set yet — copy the line above into .env and Vercel)');
  }

  let found;
  try {
    found = await channels();
  } catch (err) {
    bad(`Cannot list channels: ${err.message}`);
    if (String(err.message).includes('missing_scope')) {
      console.log('    Add the channels:read scope, then reinstall the app.\n');
    }
    process.exit(1);
  }

  let allGood = true;
  for (const [label, name] of [['Announcements', announcements], ['Studio issues', issues]]) {
    const channel = found.get(name.replace(/^#/, ''));
    if (!channel) {
      bad(`${label}: no channel called #${name} that the bot can see`);
      allGood = false;
    } else if (!channel.is_member) {
      bad(`${label}: #${name} exists, but the bot is not in it — run "/invite @${auth.user}" there`);
      allGood = false;
    } else {
      ok(`${label}: #${name} (${channel.id}), bot is a member`);
    }
  }

  // Reading history is what the announcements panel actually does.
  const feed = found.get(announcements.replace(/^#/, ''));
  if (feed && feed.is_member) {
    const history = await call('conversations.history', { channel: feed.id, limit: '1' });
    if (history.ok) ok(`Can read #${announcements} — ${history.messages.length ? 'found a recent message' : 'channel is empty'}`);
    else {
      bad(`Cannot read #${announcements}: ${history.error}`);
      if (history.error === 'missing_scope') console.log('    Add channels:history, then reinstall.');
      allGood = false;
    }
  }

  console.log(allGood ? '\nSlack is ready.\n' : '\nFix the above, then run this again.\n');
  process.exit(allGood ? 0 : 1);
})().catch(function (err) {
  bad(`Unexpected: ${err.message}`);
  process.exit(1);
});
