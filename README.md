# Trainer HQ

The internal trainer portal for Oak Cliff Pilates. Class standard, live events,
live announcements, current offers, the membership goal, studio upkeep,
onboarding and staff resources.

Deployed separately from [oakcliffpilates.com](https://oakcliffpilates.com) so
an internal tool is not riding along with marketing deploys. No framework, no
dependencies, no build step on the host.

```bash
node tools/dev.js   # → http://localhost:4333
```

## There is no sign-in

The page is **public but unlisted**: no login, `noindex, nofollow, noarchive`
on every response, `Disallow: /` in robots.txt, and in no sitemap. Anyone with
the URL can read it, including former staff and anyone they forward it to, and
it carries per-event pay rates, the trainer promo code and the bonus-scheme
figures. Share the link with that in mind.

It was built with Slack sign-in first. That was removed deliberately — standing
up a Slack app was blocking launch — and the code is in git history
(`git log --diff-filter=D -- api/auth`) if it is ever wanted back. A shared
passcode is the cheaper middle option: one env var and a cookie, roughly an
afternoon.

It is still served by a function rather than as a static file. `vercel.json`
rewrites `/` to `api/hq/page.js`, which returns `api/_page.js` — compiled from
`src/` by `tools/build.py`. That keeps the page assembled from one source, and
guarantees the noindex headers on every response rather than trusting a meta tag.

```bash
python3 tools/build.py    # after editing src/, css/portal.css or js/portal.js
```

**Run it after every change to those three**, including CSS and JS — it stamps a
content hash into their `?v=` query strings, which is what gets a change past the
year-long immutable cache on `/css` and `/js`.

## Where the content comes from

Two sources, because neither has everything. Each panel is answered
independently, so one being absent never takes the other down.

| Panel | Source | Variable |
| --- | --- | --- |
| Events | the events service, `events.oakcliffpilates.com/api/feed` | `EVENTS_FEED_URL` |
| Announcements | the `ANNOUNCEMENTS` tab | `WORKBOOK_FEED_URL` |
| The 1,000 | the `SITE CONFIG` tab | `WORKBOOK_FEED_URL` |
| Report a studio issue | appends to the `STUDIO ISSUES` tab | `WORKBOOK_FEED_URL` |

`WORKBOOK_FEED_URL` is the Apps Script web app and is optional. Without it,
events still work and the other three panels say plainly that they are not
connected. Set only `WORKBOOK_FEED_URL` and it serves everything including
events, which is how this started.

**The events service carries no instructors, pay or call time.** Those three
fields are simply absent from the cards when events come from it — the card
drops any field with no value rather than showing an empty label. If trainers
need to see what an event pays, either add those fields to the events service
or serve events from the workbook instead, where the `EVENT NN` tabs have them.

Both URLs and their tokens stay on the server; the browser only ever sees the
normalised result and never a URL it could write to. Text from either source is
escaped before it reaches the page, and only `http(s)` links become anchors.

**Each panel says when it is not connected rather than showing anything
invented.** A trainer reading a made-up call time is worse than one reading
"not connected yet".

Responses are cached 60 seconds in the browser and 120 at the edge. Worth
knowing while developing: a change to the endpoint will not show for a minute
unless you hard-reload.

### The issue form is a public write endpoint

Because the page is public, so is `POST /api/hq/issue`. Three things bound it:
every field is length-capped and the studio and area must match a known value;
one browser gets four reports a minute; and the destination is a spreadsheet
tab, so the worst case is rows somebody deletes — no mail sent, nothing charged.

The rate limit is per warm instance and best-effort, which is the honest limit
of counting in memory on serverless. If the form ever gets abused, the cheap
fix is a passcode on the page rather than a cleverer limiter.

## Wiring it up

Copy `.env.example` to `.env` for local work, and into Vercel's environment
variables for the deployment.

```
EVENTS_FEED_URL=https://events.oakcliffpilates.com/api/feed
EVENTS_FEED_TOKEN=        # not needed for the events service
WORKBOOK_FEED_URL=        # the /exec URL of the deployed Apps Script
WORKBOOK_FEED_TOKEN=      # the TOKEN you set at the top of that script
```

The events URL is already filled in. The workbook pair comes from deploying
the Apps Script — see the next section.

## The events workbook

`tools/apps-script/ocp-events-feed.gs` is bound to the event workbook. Running
`setup` once adds a `SITE CONFIG` tab (the membership count lives there), adds
three rows to each event tab, builds a `WEBSITE FEED` tab, and schedules an
hourly refresh. The sheet then gets a **Trainer HQ** menu.

`setup` creates four tabs in all:

| Tab | What it is for |
| --- | --- |
| `WEBSITE FEED` | one row per event, rebuilt from the `EVENT NN` tabs |
| `ANNOUNCEMENTS` | Date, Title, Body, Link, Show On Site — type a row, it appears on the page |
| `SITE CONFIG` | the membership count and goal |
| `STUDIO ISSUES` | what the issue form writes, newest at the top |

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

38 assertions, covering the feed, the announcements tab, and issue logging. Apps Script cannot run locally, so `test/harness.js` stands in for
`SpreadsheetApp` with plain 2-D arrays and the fixture is shaped like the real
workbook. Run it after editing the `.gs`, then re-deploy (Manage deployments →
edit → Version: New).

## Layout

```
api/            three functions — serve the page, read the feed, log an issue
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
