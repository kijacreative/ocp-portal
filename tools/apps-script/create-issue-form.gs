/**
 * Creates the Trainer HQ studio-issues form — and tells you how to wire it up.
 * =========================================================================
 *
 * Why this exists: the portal posts a studio issue to a Google Form exactly as
 * a browser would, which needs the form's `entry.NNN` field ids. Those are not
 * in the Forms UI anywhere — the usual advice is to View Source on the live
 * form and read them out by hand. This script builds the form and reads the
 * ids out itself, by generating a prefilled link and parsing it.
 *
 * HOW TO RUN — about a minute, no setup.
 *
 *   1. script.google.com -> New project.
 *   2. Paste this whole file in, replacing what is there. Save.
 *   3. Run -> createStudioIssuesForm. Approve the permission prompt.
 *   4. View -> Logs (or the Execution log pane). Everything you need is
 *      printed there: the form link to share, the edit link, and the two
 *      values to give Claude or to paste into Vercel.
 *
 * Re-running it makes a second form. Run it once.
 */

var FORM_TITLE = 'Oak Cliff Pilates — Studio Issues';

var STUDIOS = ['Bishop Arts', 'Uptown', 'Lower Greenville'];
var AREAS = [
  'Lobby & front desk',
  'Reformer studio',
  'Bathrooms',
  'Equipment',
  'Building & access',
  'Something else'
];

function createStudioIssuesForm() {
  var form = FormApp.create(FORM_TITLE);
  form.setDescription(
    'Anything in the studio that needs attention. This also comes in from the ' +
      'Report a studio issue form on Trainer HQ.'
  );
  form.setCollectEmail(false);
  form.setAllowResponseEdits(false);

  // The order and the titles here must stay in step with the portal's form.
  var reporter = form.addTextItem().setTitle('Your name').setRequired(true);
  var studio = form
    .addMultipleChoiceItem()
    .setTitle('Studio')
    .setChoiceValues(STUDIOS)
    .setRequired(true);
  var area = form
    .addMultipleChoiceItem()
    .setTitle('What it relates to')
    .setChoiceValues(AREAS)
    .setRequired(true);
  var detail = form
    .addParagraphTextItem()
    .setTitle('What needs attention')
    .setHelpText('One or two sentences. Reformer number, what it does, anything you already did about it.')
    .setRequired(true);
  var urgent = form
    .addMultipleChoiceItem()
    .setTitle('Urgent')
    .setChoiceValues(['Urgent'])
    .setRequired(false);

  // Somewhere for the answers to land, so the tab can be published or watched.
  var sheet = SpreadsheetApp.create(FORM_TITLE + ' — responses');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, sheet.getId());

  var ids = entryIds_(form, {
    reporter: [reporter, 'NAME'],
    location: [studio, STUDIOS[0]],
    area: [area, AREAS[0]],
    detail: [detail, 'DETAIL'],
    urgent: [urgent, 'Urgent']
  });

  var action = form.getPublishedUrl().replace(/\/viewform.*$/, '/formResponse');

  Logger.log('');
  Logger.log('=== Trainer HQ — studio issues form ===');
  Logger.log('');
  Logger.log('Share this with the team:  ' + form.getPublishedUrl());
  Logger.log('Edit it here:              ' + form.getEditUrl());
  Logger.log('Responses land in:         ' + sheet.getUrl());
  Logger.log('');
  Logger.log('--- give these two to Claude, or paste into Vercel ---');
  Logger.log('ISSUE_FORM_URL=' + action);
  Logger.log('ISSUE_FORM_FIELDS=' + JSON.stringify(ids));
  Logger.log('');
  Logger.log('To email info@oakcliffpilates.com on every report: open the responses');
  Logger.log('sheet -> Tools -> Notification settings -> notify me immediately. That');
  Logger.log('emails whoever owns the sheet, so share it to info@ and have them set it,');
  Logger.log('or move the sheet into a drive info@ owns.');
  Logger.log('');

  return { url: action, fields: ids };
}

/**
 * The entry.NNN id for each question.
 *
 * Forms will not tell you directly, but it will build a prefilled URL — and
 * that URL carries entry.NNN=value for every answer. So: fill each question
 * with a sentinel, generate the link, and read the ids back out of it.
 */
function entryIds_(form, questions) {
  var response = form.createResponse();
  var sentinels = {};

  Object.keys(questions).forEach(function (key) {
    var item = questions[key][0];
    var value = questions[key][1];
    sentinels[key] = String(value);
    var type = item.getType();
    if (type === FormApp.ItemType.TEXT) {
      response.withItemResponse(item.asTextItem().createResponse(value));
    } else if (type === FormApp.ItemType.PARAGRAPH_TEXT) {
      response.withItemResponse(item.asParagraphTextItem().createResponse(value));
    } else if (type === FormApp.ItemType.MULTIPLE_CHOICE) {
      response.withItemResponse(item.asMultipleChoiceItem().createResponse(value));
    }
  });

  var prefilled = response.toPrefilledUrl();
  var found = {};
  prefilled.split(/[?&]/).forEach(function (pair) {
    var bits = pair.split('=');
    if (bits.length !== 2 || bits[0].indexOf('entry.') !== 0) return;
    var value = decodeURIComponent(bits[1].replace(/\+/g, ' '));
    Object.keys(sentinels).forEach(function (key) {
      if (sentinels[key] === value && !found[key]) found[key] = bits[0];
    });
  });

  var missing = Object.keys(questions).filter(function (k) { return !found[k]; });
  if (missing.length) {
    throw new Error(
      'Could not read the entry id for: ' + missing.join(', ') +
        '. Open the live form, View Source, search "entry." and fill these in by hand.'
    );
  }
  return found;
}
