'use strict';
/* Local dev server for Trainer HQ.
 *
 *   node tools/dev.js            # sign-in screen, then the real Slack flow
 *   node tools/dev.js --as "Kiel Jared"   # skip Slack, pretend to be signed in
 *
 * Serves the repo statically, routes /trainer-hq and /api/* through the same
 * handlers Vercel runs, and applies the rewrite from vercel.json. Reads .env
 * if there is one, so the live Slack and events feeds work locally too.
 *
 * `--as` exists so the page can be worked on without a Slack app configured.
 * It only ever runs from this script, never on Vercel.
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
if (!process.env.HQ_SESSION_SECRET) process.env.HQ_SESSION_SECRET = 'dev-only-not-a-real-secret';

const asIndex = process.argv.indexOf('--as');
const AS = asIndex > -1 ? process.argv[asIndex + 1] || 'Dev Trainer' : null;

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

  if (AS) {
    const { sign, MAX_AGE, COOKIE } = load('api/_lib/session.js');
    const token = sign({ uid: 'U-DEV', name: AS, pic: '', exp: Math.floor(Date.now() / 1000) + MAX_AGE });
    req.headers.cookie = `${COOKIE}=${encodeURIComponent(token)}; ${req.headers.cookie || ''}`;
  }

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
  console.log(AS ? `Signed in as "${AS}" (--as)` : 'Not signed in — the sign-in screen will show.');
});
