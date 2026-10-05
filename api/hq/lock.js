'use strict';
/* Sign out of a shared device. */
const { serialize } = require('../_lib/session');

module.exports = function handler(req, res) {
  res.setHeader('Set-Cookie', serialize('', 0));
  res.setHeader('Cache-Control', 'private, no-store');
  res.writeHead(302, { Location: '/' });
  res.end();
};
