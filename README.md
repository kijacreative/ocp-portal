# Trainer HQ

The internal trainer portal for Oak Cliff Pilates. Class standard, live events,
live announcements, current offers, the membership goal, studio upkeep,
onboarding and staff resources.

Deployed separately from [oakcliffpilates.com](https://oakcliffpilates.com) so
an internal tool is not riding along with marketing deploys. No framework, no
dependencies, no build step on the host.

```bash
node tools/dev.js --as "Your Name"   # → http://localhost:4333
```

`--as` skips Slack so the page can be worked on with no app configured. Without
it you get the real sign-in screen.

## Why it is a function, not a file

Everything on the public site is a static file. This page is not: it carries
per-event pay rates, the trainer promo code and the bonus scheme.

`vercel.json` rewrites `/` to `api/hq/page.js`. That function requires
`api/_page.js` — compiled from `src/` by `tools/build.py` — and returns the HTML
only to a request holding a valid session; everyone else gets the sign-in
screen. The compiled page lives inside `api/` with a leading underscore, which
Vercel treats as a shared module rather than an endpoint, so no URL serves it
unauthenticated. `.vercelignore` keeps `src/` and `tools/` out of the deployment
entirely.

Sign-in is **Sign in with Slack** (OpenID Connect). The callback refuses any
identity whose `team_id` is not `SLACK_TEAM_ID`, so access follows Slack
membership — someone removed from the workspace loses the page on their next
visit, and there is no password to rotate. The session cookie is HMAC-signed,
HttpOnly, Secure, SameSite=Lax, 30 days.

```bash
python3 tools/build.py    # after editing src/, css/portal.css or js/portal.js
```

**Run it after every change to those three**, including CSS and JS — it stamps a
content hash into their `?v=` query strings, which is what gets a change past the
year-long immutable cache on `/css` and `/js`.

## The three live feeds

| Panel | Source | Endpoint |
| --- | --- | --- |
| Announcements | Slack `#general` | `api/hq/slack.js` |
| Events, and the membership count | the events workbook, via Apps Script | `api/hq/events.js` |
| Report a studio issue | posts to Slack `#studio-issues` | `api/hq/issue.js` |

Credentials stay server-side; the browser only ever sees normalised JSON, and
every endpoint returns 401 without a session. Text from Slack and from the sheet
is escaped before it reaches the page, and only `http(s)` links become anchors —
a ticket URL with a `javascript:` scheme is dropped.

**Each panel says when it is not connected rather than showing anything
invented.** A trainer reading a made-up call time is worse than one reading
"not connected yet".

## Wiring it up

Copy `.env.example` into Vercel's environment variables. Three jobs:

1. **Slack app** — api.slack.com/apps → create an app in the OCP workspace.
   - *Sign in with Slack*: add the redirect URL
     `https://<this-deployment>/api/auth/slack/callback`, and copy the client ID
     and secret from Basic Information.
   - *Bot token*: scopes `channels:history`, `channels:read`, `users:read`,
     `chat:write`. Install, copy the `xoxb-` token, then invite the bot in Slack:
     `/invite @<the app>` in **both** `#general` and `#studio-issues`. Without the
     invite the API returns `not_in_channel`.
   - `curl -H "Authorization: Bearer xoxb-…" https://slack.com/api/auth.test`
     confirms the token and returns your `SLACK_TEAM_ID`.
2. **Events feed** — `tools/apps-script/ocp-events-feed.gs`. See below.
3. **Session secret** — `openssl rand -hex 32` into `HQ_SESSION_SECRET`.

### Checking the Slack side

```bash
node tools/check-slack.js
```

Reads `SLACK_BOT_TOKEN` from `.env` and reports what the bot can actually see:
whether the token works, the `SLACK_TEAM_ID` to copy into Vercel, whether both
channels exist, whether the bot has been invited to them, and whether it can
read history. **It never prints the token**, so the output is safe to paste
anywhere.

Put the token in `.env` without it landing in your shell history:

```bash
cp -n .env.example .env
read -rs TOKEN && printf 'SLACK_BOT_TOKEN=%s\n' "$TOKEN" >> .env && unset TOKEN
```

## The events workbook

`tools/apps-script/ocp-events-feed.gs` is bound to the event workbook. Running
`setup` once adds a `SITE CONFIG` tab (the membership count lives there), adds
three rows to each event tab, builds a `WEBSITE FEED` tab, and schedules an
hourly refresh. The sheet then gets a **Trainer HQ** menu.

`WEBSITE FEED` is flat — one row per event — and it is what this site reads. It
exists so the feed is something a person can look at.

**Three of its columns are yours**, shown on cream:

| Column | Why it is manual |
| --- | --- |
| Ticket Link | The Arketa checkout URL. Nothing in the event tabs holds it. |
| Call Time | "15 min early". Not a field the tracker has. |
| Show On Site | `No` hides an event without deleting anything. Blank means yes. |

Every other column is regenerated from the `EVENT NN` tabs on each refresh, so
edit those in the event tab. **A refresh never overwrites the three manual
columns** — they are read first and written back, matched on the tab name in
column A.

The event tabs are read by scanning column A for labels rather than fixed cell
references, so inserting a row does not break the mapping. Instructors are
serialised one per line as `Name | Role | Pay | Scope` and parsed back when the
feed is served. If `WEBSITE FEED` has not been built yet, the feed falls back to
reading the event tabs directly.

```bash
node tools/apps-script/test/feed.test.js
```

25 assertions. Apps Script cannot run locally, so `test/harness.js` stands in for
`SpreadsheetApp` with plain 2-D arrays and the fixture is shaped like the real
workbook. Run it after editing the `.gs`, then re-deploy (Manage deployments →
edit → Version: New).

## Layout

```
api/            the functions — the gate, the Slack OAuth flow, the three feeds
api/_page.js    GENERATED by tools/build.py; do not edit
src/            the page source: front matter, body, partials
css/tokens.css  design-system tokens, copied from the main site
css/base.css    the base and the three components shared with the main site
css/portal.css  everything specific to this page
js/portal.js    side nav, accordions, the live panels, the issue form
```

`css/tokens.css` and `css/base.css` are copies from
[oakcliffpilates.com](https://github.com/kijacreative/oakcliffpilates). They are
the one thing that can drift between the two sites — if a button or badge ever
looks wrong next to the main site, diff those two files first.

## Content still needed

Marked on the page with a red **Needs content** chip; grep `hq-tk` in
`src/page.html`.

- Welcome to OCP, and the full onboarding step list
- Parking registration links for all three studios, and the payroll portal link
- Lower Greenville client parking — the arrangement was never stated
- The unfinished retail rule ("clients should not leave studio")
- Staff benefits
- The eleven Arketa how-to screen shares
- Front desk to-do list
- Promo codes beyond the two intro offers and the trainer code

## Offers

The offers on this page must match the `OPTIONS` table in the main site's
`tools/build-checkout.py`, which is what the checkout actually charges. They
currently do: the $59 week and the $89 Lower Greenville fortnight.
**When prices change there, change them here.**
