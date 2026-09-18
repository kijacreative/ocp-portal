'use strict';
/* A CSV reader for one specific job: a Google Sheet published to the web.
 *
 * Published sheets are plain CSV over HTTPS with no credential, which is why
 * they are worth supporting — announcements can reach the page without a Slack
 * app, an Apps Script deployment, or a token anywhere.
 *
 * Handles what a person typing into Sheets will actually produce: quoted
 * fields, commas and newlines inside quotes, doubled quotes, and CRLF. */

function parse(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  const body = String(text || '').replace(/^﻿/, '');

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];

    if (quoted) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));
}

/* Rows as objects keyed by the header row, lowercased and trimmed so
 * "Show On Site", "show on site" and " Show on Site " all land in one place. */
function toObjects(text) {
  const rows = parse(text);
  if (!rows.length) return [];
  const headers = rows[0].map((h) => String(h).trim().toLowerCase());
  return rows.slice(1).map(function (row) {
    const out = {};
    headers.forEach(function (name, index) {
      if (name) out[name] = String(row[index] == null ? '' : row[index]).trim();
    });
    return out;
  });
}

module.exports = { parse, toObjects };
