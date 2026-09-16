'use strict';
/* Serves Trainer HQ.
 *
 * There is no sign-in: the page is public but unlisted, noindex and absent
 * from any sitemap. It is still served by a function rather than as a static
 * file so the page can be assembled from one source and the headers below are
 * guaranteed on every response. */
const page = require('../_page');

module.exports = function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.status(200).send(page.render());
};
