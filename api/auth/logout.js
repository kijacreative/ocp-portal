'use strict';
const { clear } = require('../_lib/session');

module.exports = function handler(req, res) {
  clear(res);
  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(302, { Location: '/trainer-hq' });
  res.end();
};
