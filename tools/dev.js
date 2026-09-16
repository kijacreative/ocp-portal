'use strict';
/* Local dev server for Trainer HQ.
 *
 *   node tools/dev.js
 *
 * Serves the repo statically and routes / and /api/* through the same handlers
 * Vercel runs, applying the rewrites from vercel.json. Reads .env if there is
 * one, so the live events feed works locally too.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 4333;

const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(function (line) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^"|"$/g, '');
  });
}


const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm',
};

function load(relative) {
  const full = path.join(ROOT, relative);
  delete require.cache[require.resolve(full)];
  return require(full);
}

/* Vercel gives handlers res.status() and res.send(); Node does not. */
function decorate(res) {
  res.status = function (code) { res.statusCode = code; return res; };
  res.send = function (body) { res.end(body); return res; };
  return res;
}

function readBody(req) {
  return new Promise(function (resolve) {
    let raw = '';
    req.on('data', function (chunk) { raw += chunk; });
    req.on('end', function () {
      try { resolve(JSON.parse(raw || '{}')); } catch (err) { resolve({}); }
    });
  });
}

const server = http.createServer(async function (req, res) {
  decorate(res);
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let route = url.pathname;

  if (route === '/' || route === '/trainer-hq') route = '/api/hq/page';

  if (route.startsWith('/api/')) {
    const file = path.join(ROOT, `${route}.js`);
    if (!fs.existsSync(file)) { res.status(404).send('No such function'); return; }
    if (req.method === 'POST') req.body = await readBody(req);
    try {
      await load(`${route}.js`)(req, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.status(500).send(String(err && err.stack));
    }
    return;
  }

  let file = path.join(ROOT, decodeURIComponent(route));
  if (route.endsWith('/')) file = path.join(file, 'index.html');
  if (!fs.existsSync(file) && fs.existsSync(`${file}.html`)) file = `${file}.html`; // cleanUrls
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.status(404).send('Not found'); return; }

  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, function () {
  console.log(`Trainer HQ dev  →  http://localhost:${PORT}/`);
});
