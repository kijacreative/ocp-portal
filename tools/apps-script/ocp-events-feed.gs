/**
 * Oak Cliff Pilates — Trainer HQ events feed
 * ==========================================
 * Bound to the event workbook. Builds a flat WEBSITE FEED tab from the
 * EVENT NN tabs and publishes it as JSON for oakcliffpilates.com/trainer-hq.
 *
 * WHY A FEED TAB rather than reading the event tabs directly: it is a table a
 * person can look at. You can see exactly what the website will show, and the
 * three columns the site needs but the event tabs do not carry — Ticket Link,
 * Call Time, Show On Site — are typed straight into it.
 *
 * THOSE THREE COLUMNS ARE NEVER OVERWRITTEN. A refresh regenerates every other
 * column from the event tabs and carries your typing forward, matched on the
 * tab name in column A. Everything else in the row is generated: edit it in the
 * event tab, not here.
 *
 * SETUP — about five minutes, once.
 *
 *  1. Open the events workbook → Extensions → Apps Script.
 *  2. Delete what is in Code.gs, paste this whole file in, Save.
 *  3. Put a long random string in TOKEN below (Terminal: openssl rand -hex 24).
 *  4. Run → setup. Approve the permission prompt. This adds the SITE CONFIG
 *     tab, adds a Ticket Link / Call Time / Show On Site row to each event tab,
 *     builds WEBSITE FEED for the first time, and schedules an hourly refresh.
 *  5. Deploy → New deployment → Web app.
 *       Execute as:      Me
 *       Who has access:  Anyone
 *     "Anyone" is safe: TOKEN gates every request, and the URL is only ever
 *     called by the Vercel function — never from a browser.
 *  6. Put the /exec URL in EVENTS_FEED_URL in Vercel, and TOKEN in
 *     EVENTS_FEED_TOKEN.
 *
 * DAY TO DAY: the sheet gets an "Trainer HQ" menu. Refresh website feed after
 * adding an event. It also refreshes itself hourly.
 *
 * Re-deploy (Manage deployments → edit → Version: New) after changing this file.
 */

var TOKEN = 'PUT-A-LONG-RANDOM-STRING-HERE';

/** Tabs to read. Anything matching this is one event. */
var EVENT_TAB = /^EVENT\s*\d+$/i;

var FEED_TAB = 'WEBSITE FEED';
var CONFIG_TAB = 'SITE CONFIG';
var NEWS_TAB = 'ANNOUNCEMENTS';
var ISSUES_TAB = 'STUDIO ISSUES';

var NEWS_COLUMNS = ['Date', 'Title', 'Body', 'Link', 'Show On Site'];
var ISSUE_COLUMNS = ['Logged', 'Studio', 'Area', 'Detail', 'Urgent', 'Reported by', 'Status'];

/** Column A label on an event tab → key in the feed. Matched case-insensitively
 *  by scanning column A, so inserting a row cannot break the mapping the way a
 *  hardcoded cell reference would. */
var FIELDS = {
  'event name': 'name',
  location: 'location',
  'event date': 'date',
  'date status': 'dateStatus',
  'start time': 'start',
  'end time': 'end',
  format: 'format',
  'event type': 'type',
  'capacity (max)': 'capacity',
  'event description': 'description',
  price: 'price',
  discounts: 'discounts',
  'ticket link': 'ticketUrl',
  'call time': 'callTime',
  'show on site': 'show'
};

/** WEBSITE FEED columns, in order. Read back by name, so this order can change. */
var COLUMNS = [
  { header: 'Tab', key: 'id', width: 90 },
  { header: 'Event', key: 'name', width: 260 },
  { header: 'Date', key: 'date', width: 100 },
  { header: 'Start', key: 'start', width: 80 },
  { header: 'End', key: 'end', width: 80 },
  { header: 'Date Status', key: 'dateStatus', width: 100 },
  { header: 'Location', key: 'location', width: 150 },
  { header: 'Format', key: 'format', width: 130 },
  { header: 'Event Type', key: 'type', width: 130 },
  { header: 'Price', key: 'price', width: 80 },
  { header: 'Discounts', key: 'discounts', width: 160 },
  { header: 'Description', key: 'description', width: 320 },
  { header: 'Capacity', key: 'capacity', width: 80 },
  { header: 'Instructors', key: 'instructors', width: 300 },
  { header: 'Ticket Link', key: 'ticketUrl', width: 260, manual: true },
  { header: 'Call Time', key: 'callTime', width: 110, manual: true },
  { header: 'Show On Site', key: 'show', width: 110, manual: true }
];

/* ══ MENU ═══════════════════════════════════════════════════════════════ */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Trainer HQ')
    .addItem('Refresh website feed', 'buildFeedTab')
    .addItem('Open the feed tab', 'showFeedTab')
    .addItem('Open announcements', 'showNewsTab')
    .addSeparator()
    .addItem('Run first-time setup', 'setup')
    .addToUi();
}

function showNewsTab() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(NEWS_TAB);
  if (sheet) SpreadsheetApp.getActive().setActiveSheet(sheet);
  else SpreadsheetApp.getUi().alert('No ' + NEWS_TAB + ' tab yet — run Trainer HQ → Run first-time setup.');
}

function showFeedTab() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(FEED_TAB);
  if (sheet) {
    SpreadsheetApp.getActive().setActiveSheet(sheet);
  } else {
    SpreadsheetApp.getUi().alert('No ' + FEED_TAB + ' tab yet — run Trainer HQ → Refresh website feed.');
  }
}

/* ══ BUILDING THE FEED TAB ══════════════════════════════════════════════ */

/**
 * Regenerate WEBSITE FEED from the event tabs.
 * Safe to run as often as you like: the manual columns are read first and
 * written back, so nothing typed into them is ever lost.
 */
function buildFeedTab() {
  var book = SpreadsheetApp.getActive();
  var zone = book.getSpreadsheetTimeZone();
  var sheet = book.getSheetByName(FEED_TAB) || book.insertSheet(FEED_TAB);

  var keep = readManualColumns_(sheet);
  var events = collectEvents_(book, zone);

  events.sort(function (a, b) {
    return String(a.date || '9999').localeCompare(String(b.date || '9999'));
  });

  var rows = events.map(function (event) {
    var manual = keep[event.id] || {};
    return COLUMNS.map(function (column) {
      if (column.manual) {
        // Typed into the feed tab wins; otherwise fall back to the event tab,
        // so a Ticket Link entered in either place is picked up.
        var typed = manual[column.header];
        if (typed !== undefined && typed !== '') return typed;
        return event[column.key] === undefined ? '' : event[column.key];
      }
      if (column.key === 'instructors') return serialiseInstructors_(event.instructors);
      return event[column.key] === undefined ? '' : event[column.key];
    });
  });

  writeGrid_(sheet, rows, zone);
  return rows.length;
}

/** Existing values of the manual columns, keyed by the Tab column. */
function readManualColumns_(sheet) {
  var keep = {};
  if (sheet.getLastRow() < 2 || sheet.getLastColumn() < 1) return keep;

  var grid = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  var headers = grid[0].map(function (value) { return String(value || '').trim(); });
  var tabAt = headers.indexOf('Tab');
  if (tabAt < 0) return keep;

  for (var r = 1; r < grid.length; r++) {
    var id = String(grid[r][tabAt] || '').trim();
    if (!id) continue;
    keep[id] = {};
    COLUMNS.forEach(function (column) {
      if (!column.manual) return;
      var at = headers.indexOf(column.header);
      if (at > -1) keep[id][column.header] = grid[r][at];
    });
  }
  return keep;
}

function collectEvents_(book, zone) {
  var events = [];
  book.getSheets().forEach(function (sheet) {
    if (!EVENT_TAB.test(sheet.getName().trim())) return;
    var event = readEvent_(sheet, zone);
    if (event && event.name && event.date) events.push(event);
  });
  return events;
}

/** One line per person: Name | Role | Pay | Scope — readable in the cell, and
 *  parsed straight back out when the feed is served. */
function serialiseInstructors_(people) {
  return (people || [])
    .map(function (person) {
      return [person.name, person.role, person.pay, person.scope]
        .map(function (part) { return String(part || '').replace(/[|\n]/g, ' ').trim(); })
        .join(' | ')
        .replace(/(\s*\|\s*)+$/, '');
    })
    .join('\n');
}

function parseInstructors_(value) {
  return String(value || '')
    .split('\n')
    .map(function (line) { return line.trim(); })
    .filter(Boolean)
    .map(function (line) {
      var parts = line.split('|').map(function (part) { return part.trim(); });
      return { name: parts[0] || '', role: parts[1] || '', pay: parts[2] || '', scope: parts[3] || '' };
    })
    .filter(function (person) { return person.name; });
}

function writeGrid_(sheet, rows, zone) {
  sheet.clear();

  var headers = COLUMNS.map(function (column) { return column.header; });
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  // Everything is text. Without this, Sheets turns "09/20" into a date and
  // strips the leading zero off a time, and the website shows the mangled value.
  sheet.getRange(1, 1, Math.max(rows.length + 1, 2), headers.length).setNumberFormat('@');

  var header = sheet.getRange(1, 1, 1, headers.length);
  header.setFontWeight('bold').setBackground('#0B0B0B').setFontColor('#F4EFE6');
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(2);

  COLUMNS.forEach(function (column, index) {
    sheet.setColumnWidth(index + 1, column.width);
    if (column.manual && rows.length) {
      sheet.getRange(2, index + 1, rows.length, 1).setBackground('#FBF8F2').setFontColor('#0B0B0B');
    }
    if (column.manual) {
      sheet.getRange(1, index + 1).setBackground('#8E6B2A');
    }
  });

  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setVerticalAlignment('top').setWrap(false);
    var descriptionAt = headers.indexOf('Description') + 1;
    var instructorsAt = headers.indexOf('Instructors') + 1;
    sheet.getRange(2, descriptionAt, rows.length, 1).setWrap(true);
    sheet.getRange(2, instructorsAt, rows.length, 1).setWrap(true);

    var showAt = headers.indexOf('Show On Site') + 1;
    sheet.getRange(2, showAt, rows.length, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(['Yes', 'No'], true).build()
    );
  }

  sheet
    .getRange(1, 1)
    .setNote(
      'Generated by Trainer HQ — do not edit the dark columns; they are rebuilt from the ' +
        'EVENT tabs on every refresh.\n\nThe three cream columns (Ticket Link, Call Time, ' +
        'Show On Site) are yours. They are kept across refreshes.\n\nLast refreshed: ' +
        Utilities.formatDate(new Date(), zone, 'EEE d MMM yyyy, h:mm a')
    );
}

/* ══ SERVING THE FEED ═══════════════════════════════════════════════════ */

function doGet(e) {
  var given = (e && e.parameter && e.parameter.token) || '';
  if (!TOKEN || TOKEN.indexOf('PUT-A-LONG') === 0) {
    return json_({ error: 'The feed token has not been set in the script yet.' });
  }
  if (given !== TOKEN) {
    return json_({ error: 'Bad token.' });
  }
  try {
    return json_(buildFeed_());
  } catch (err) {
    return json_({ error: String(err) });
  }
}

/**
 * Log a studio issue into the STUDIO ISSUES tab.
 *
 * The portal posts here instead of to Slack, so reporting an issue needs no
 * Slack app. The tab is an ordinary sheet: sort it, filter it, mark things
 * done, or hang a notification rule off it.
 */
function doPost(e) {
  try {
    var given = (e && e.parameter && e.parameter.token) || '';
    if (!TOKEN || TOKEN.indexOf('PUT-A-LONG') === 0) {
      return json_({ error: 'The feed token has not been set in the script yet.' });
    }
    if (given !== TOKEN) return json_({ error: 'Bad token.' });

    var payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var book = SpreadsheetApp.getActive();
    var sheet = book.getSheetByName(ISSUES_TAB) || makeIssuesTab_(book);

    sheet.insertRowAfter(1);
    sheet.getRange(2, 1, 1, ISSUE_COLUMNS.length).setValues([[
      Utilities.formatDate(new Date(), book.getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm'),
      String(payload.location || '').slice(0, 80),
      String(payload.area || '').slice(0, 80),
      String(payload.detail || '').slice(0, 1500),
      payload.urgent ? 'URGENT' : '',
      String(payload.reporter || '').slice(0, 80),
      'New'
    ]]);
    return json_({ ok: true });
  } catch (err) {
    return json_({ error: String(err) });
  }
}

function makeIssuesTab_(book) {
  var sheet = book.insertSheet(ISSUES_TAB);
  sheet.getRange(1, 1, 1, ISSUE_COLUMNS.length).setValues([ISSUE_COLUMNS]);
  sheet.getRange(1, 1, 1, ISSUE_COLUMNS.length)
    .setFontWeight('bold').setBackground('#0B0B0B').setFontColor('#F4EFE6');
  sheet.setFrozenRows(1);
  [140, 130, 150, 460, 80, 140, 90].forEach(function (width, index) {
    sheet.setColumnWidth(index + 1, width);
  });
  return sheet;
}

function buildFeed_() {
  var book = SpreadsheetApp.getActive();
  var zone = book.getSpreadsheetTimeZone();
  var sheet = book.getSheetByName(FEED_TAB);

  // The feed tab is one read and is what a person can actually see. If it has
  // not been built yet, fall back to the event tabs so the website still works.
  var events = sheet ? readFeedTab_(sheet, zone) : collectEvents_(book, zone);

  return {
    generated: Utilities.formatDate(new Date(), zone, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    source: sheet ? FEED_TAB : 'event tabs',
    config: readConfig_(book),
    events: events.filter(function (event) { return event.show !== false; }),
    announcements: readAnnouncements_(book, zone)
  };
}

function readFeedTab_(sheet, zone) {
  if (sheet.getLastRow() < 2) return [];
  var grid = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  var headers = grid[0].map(function (value) { return String(value || '').trim(); });

  return grid.slice(1).map(function (row) {
    var event = { instructors: [] };
    COLUMNS.forEach(function (column) {
      var at = headers.indexOf(column.header);
      if (at < 0) return;
      var value = row[at];
      if (column.key === 'instructors') event.instructors = parseInstructors_(value);
      else if (column.key === 'show') event.show = truthy_(value);
      else if (column.key === 'date') event.date = asDate_(value, zone);
      else if (column.key === 'start' || column.key === 'end') event[column.key] = asTime_(value, zone);
      else event[column.key] = String(value == null ? '' : value).trim();
    });
    return event;
  }).filter(function (event) { return event.name && event.date; });
}

/** Announcements, newest first. Somebody types these; nothing generates them. */
function readAnnouncements_(book, zone) {
  var sheet = book.getSheetByName(NEWS_TAB);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var grid = sheet.getRange(1, 1, sheet.getLastRow(), NEWS_COLUMNS.length).getValues();
  var headers = grid[0].map(function (value) { return String(value || '').trim(); });
  var at = {};
  NEWS_COLUMNS.forEach(function (name) { at[name] = headers.indexOf(name); });

  return grid
    .slice(1)
    .map(function (row) {
      var pick = function (name) { return at[name] > -1 ? row[at[name]] : ''; };
      return {
        date: asDate_(pick('Date'), zone),
        title: String(pick('Title') || '').trim(),
        body: String(pick('Body') || '').trim(),
        link: String(pick('Link') || '').trim(),
        show: truthy_(pick('Show On Site'))
      };
    })
    .filter(function (item) { return item.show && (item.title || item.body); })
    .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); })
    .slice(0, 12);
}

/* ══ READING AN EVENT TAB ═══════════════════════════════════════════════ */

function readEvent_(sheet, zone) {
  var rows = sheet.getRange(1, 1, sheet.getLastRow(), Math.min(sheet.getLastColumn(), 8)).getValues();
  var event = { id: sheet.getName().trim(), instructors: [] };

  for (var r = 0; r < rows.length; r++) {
    var label = String(rows[r][0] || '').trim().toLowerCase();
    if (!label) continue;

    var key = FIELDS[label];
    if (key) {
      event[key] = cell_(rows[r][1], key, zone);
      continue;
    }

    // INSTRUCTORS is followed by a header row, then one row per person until
    // the names run out. HELPERS has the same shape and is read the same way.
    if (label === 'instructors' || label === 'helpers / support staff') {
      for (var i = r + 2; i < rows.length; i++) {
        var name = String(rows[i][0] || '').trim();
        if (!name) break;
        if (FIELDS[name.toLowerCase()] || name.toLowerCase() === 'name') break;
        event.instructors.push({
          name: name,
          role: String(rows[i][1] || '').trim(),
          pay: money_(rows[i][2]),
          scope: String(rows[i][3] || '').trim()
        });
      }
    }
  }
  return event;
}

function cell_(value, key, zone) {
  if (value === '' || value === null || value === undefined) return '';
  if (key === 'date') return asDate_(value, zone);
  if (key === 'start' || key === 'end') return asTime_(value, zone);
  if (key === 'price') return money_(value);
  if (key === 'show') return truthy_(value);
  return String(value).trim();
}

function asDate_(value, zone) {
  if (value instanceof Date) return Utilities.formatDate(value, zone, 'yyyy-MM-dd');
  return String(value == null ? '' : value).trim();
}

function asTime_(value, zone) {
  if (value instanceof Date) return Utilities.formatDate(value, zone, 'h:mm a');
  return String(value == null ? '' : value).trim();
}

function money_(value) {
  if (value === '' || value === null || value === undefined) return '';
  if (typeof value === 'number') {
    return '$' + (Math.round(value * 100) / 100).toFixed(value % 1 ? 2 : 0);
  }
  return String(value).trim();
}

/** Blank counts as yes — an event is shown unless somebody says not to. */
function truthy_(value) {
  if (typeof value === 'boolean') return value;
  var text = String(value == null ? '' : value).trim().toLowerCase();
  if (!text) return true;
  return ['no', 'false', 'n', 'hide', 'hidden', '0'].indexOf(text) < 0;
}

function readConfig_(book) {
  var sheet = book.getSheetByName(CONFIG_TAB);
  var config = {};
  if (!sheet) return config;
  var rows = sheet.getRange(1, 1, sheet.getLastRow(), 2).getValues();
  rows.forEach(function (row) {
    var key = String(row[0] || '').trim();
    if (key && key.charAt(0) !== '#') config[key] = row[1];
  });
  return config;
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/* ══ FIRST-TIME SETUP ═══════════════════════════════════════════════════ */

function setup() {
  var book = SpreadsheetApp.getActive();

  if (!book.getSheetByName(CONFIG_TAB)) {
    var sheet = book.insertSheet(CONFIG_TAB);
    sheet.getRange('A1:B6').setValues([
      ['# Read by trainer-hq. Key in A, value in B. Do not rename this tab.', ''],
      ['active_members', 922],
      ['member_goal', 1000],
      ['goal_label', 'By December 31'],
      ['updated', Utilities.formatDate(new Date(), book.getSpreadsheetTimeZone(), 'MMM d, yyyy')],
      ['sub_contact', 'Amanda']
    ]);
    sheet.getRange('A1:B1').merge();
    sheet.setColumnWidth(1, 220);
  }

  var template = book.getSheetByName('TEMPLATE');
  if (template) addRows_(template);
  book.getSheets().forEach(function (sheet) {
    if (EVENT_TAB.test(sheet.getName().trim())) addRows_(sheet);
  });

  if (!book.getSheetByName(NEWS_TAB)) {
    var news = book.insertSheet(NEWS_TAB);
    news.getRange(1, 1, 2, NEWS_COLUMNS.length).setValues([
      NEWS_COLUMNS,
      [Utilities.formatDate(new Date(), book.getSpreadsheetTimeZone(), 'yyyy-MM-dd'),
       'Trainer HQ is live', 'Everything you need before you step on the floor is now in one place.', '', 'Yes']
    ]);
    news.getRange(1, 1, 1, NEWS_COLUMNS.length)
      .setFontWeight('bold').setBackground('#0B0B0B').setFontColor('#F4EFE6');
    news.setFrozenRows(1);
    [110, 260, 560, 240, 110].forEach(function (width, index) {
      news.setColumnWidth(index + 1, width);
    });
    news.getRange(2, 3, 200, 1).setWrap(true);
  }
  if (!book.getSheetByName(ISSUES_TAB)) makeIssuesTab_(book);

  var count = buildFeedTab();
  installTrigger();

  SpreadsheetApp.getUi().alert(
    'Trainer HQ is set up.\n\n' +
      '· ' + CONFIG_TAB + ' tab added (the membership count lives there)\n' +
      '· ' + NEWS_TAB + ' and ' + ISSUES_TAB + ' tabs added\n' +
      '· Ticket Link, Call Time and Show On Site rows added to the event tabs\n' +
      '· ' + FEED_TAB + ' built with ' + count + ' event(s)\n' +
      '· Hourly refresh scheduled\n\n' +
      'Next: Deploy → New deployment → Web app.'
  );
}

/** Insert the optional rows under Event Description, if they are not there. */
function addRows_(sheet) {
  var column = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
  var have = {};
  var anchor = 0;
  column.forEach(function (row, index) {
    var label = String(row[0] || '').trim().toLowerCase();
    if (label) have[label] = true;
    if (label === 'event description') anchor = index + 1;
  });
  if (!anchor) return;

  ['Show On Site', 'Call Time', 'Ticket Link'].forEach(function (label) {
    if (have[label.toLowerCase()]) return;
    sheet.insertRowAfter(anchor);
    sheet.getRange(anchor + 1, 1).setValue(label);
    if (label === 'Show On Site') sheet.getRange(anchor + 1, 2).setValue('Yes');
  });
}

/** Hourly rebuild, so the website keeps up even if nobody uses the menu. */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'buildFeedTab') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('buildFeedTab').timeBased().everyHours(1).create();
}
