// The Hacker Times — dynamic app. Pure Node (node:http, node:sqlite, fetch). No deps.
import http from 'node:http';
import crypto from 'node:crypto';
import * as db from './db.mjs';
import * as auth from './auth.mjs';
import { refreshAll, refreshFeed, scheduleDaily } from './scrape.mjs';
import { renderPaper, renderFeeds, renderLogin } from './render.mjs';

const PORT = process.env.PORT || 3000;
const SECRET = process.env.SESSION_SECRET || 'dev-insecure-secret-change-me';
const DEV_LOGIN = process.env.ALLOW_DEV_LOGIN === '1' || !auth.oauthConfigured();
const baseUrl = (req) => process.env.BASE_URL || `http://${req.headers.host}`;

const DEFAULT_FEEDS = [
  ['https://hnrss.org/frontpage', 'Hacker News'],
  ['https://simonwillison.net/atom/everything/', 'Simon Willison'],
  ['https://jvns.ca/atom.xml', 'Julia Evans'],
];
// Feeds shown to logged-out visitors — a normal Hacker News paper
const PUBLIC_FEEDS = [
  ['https://hnrss.org/frontpage', 'Hacker News'],
  ['https://hnrss.org/best', 'HN — Best of the Week'],
];
function seedDefaults(userId) {
  if (db.listFeeds(userId).length) return;
  for (const [url, title] of DEFAULT_FEEDS) {
    const f = db.addFeed(userId, url, title);
    refreshFeed(f).catch(() => {});   // warm it in the background
  }
}

// The public (logged-out) edition is backed by a hidden system user.
let PUBLIC_ID = null;
function ensurePublic() {
  const u = db.upsertUser({ sub: '__public__', email: 'public', name: 'Hacker News', picture: '' });
  PUBLIC_ID = u.id;
  if (!db.listFeeds(PUBLIC_ID).length)
    for (const [url, title] of PUBLIC_FEEDS) { const f = db.addFeed(PUBLIC_ID, url, title); refreshFeed(f).catch(() => {}); }
}

// ---- signed-cookie sessions ----
const sign = (v) => v + '.' + crypto.createHmac('sha256', SECRET).update(v).digest('base64url');
const unsign = (s) => {
  const i = s.lastIndexOf('.'); if (i < 0) return null;
  const v = s.slice(0, i), good = crypto.createHmac('sha256', SECRET).update(v).digest('base64url');
  const a = Buffer.from(s.slice(i + 1)), b = Buffer.from(good);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? v : null;
};
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=').map(decodeURIComponent)).filter(p => p[0]));
const setCookie = (res, name, val, opts = {}) => {
  const parts = [`${name}=${encodeURIComponent(val)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', ...(opts.maxAge ? [`Max-Age=${opts.maxAge}`] : []), ...(process.env.BASE_URL?.startsWith('https') ? ['Secure'] : [])];
  const prev = res.getHeader('Set-Cookie') || [];
  res.setHeader('Set-Cookie', [...(Array.isArray(prev) ? prev : [prev]).filter(Boolean), parts.join('; ')]);
};
const login = (res, userId) => setCookie(res, 'ht_sess', sign(String(userId)), { maxAge: 30 * 86400 });
const currentUser = (req) => { const c = cookies(req).ht_sess; const id = c && unsign(c); return id ? db.getUser(Number(id)) : null; };

const send = (res, code, body, type = 'text/html; charset=utf-8') => { res.writeHead(code, { 'content-type': type }); res.end(body); };
const redirect = (res, to) => { res.writeHead(302, { Location: to }); res.end(); };
async function body(req) {
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  const ct = req.headers['content-type'] || '';
  if (ct.includes('application/json')) { try { return JSON.parse(raw || '{}'); } catch { return {}; } }
  return Object.fromEntries(new URLSearchParams(raw));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, baseUrl(req));
    const p = url.pathname, m = req.method;
    const user = currentUser(req);

    // --- pages ---
    if (m === 'GET' && p === '/') {
      const feeds = db.listFeeds(user ? user.id : PUBLIC_ID);   // logged-out → public HN edition
      const sections = feeds.map(feed => ({ feed, articles: db.feedArticles(feed.id) }));
      return send(res, 200, renderPaper(user, sections));
    }
    if (m === 'GET' && p === '/login') return send(res, 200, renderLogin(user, { configured: auth.oauthConfigured() }));
    if (m === 'GET' && p === '/feeds') {
      if (!user) return redirect(res, '/login');
      return send(res, 200, renderFeeds(user, db.listFeeds(user.id)));
    }
    if (m === 'GET' && p === '/logout') { setCookie(res, 'ht_sess', '', { maxAge: 0 }); return redirect(res, '/'); }
    if (m === 'GET' && p === '/healthz') return send(res, 200, 'ok', 'text/plain');

    // --- Google OAuth ---
    if (m === 'GET' && p === '/auth/google') {
      if (!auth.oauthConfigured()) return redirect(res, '/login');
      const state = crypto.randomBytes(16).toString('hex');
      setCookie(res, 'ht_oauth', sign(state), { maxAge: 600 });
      return redirect(res, auth.authUrl(baseUrl(req) + '/auth/google/callback', state));
    }
    if (m === 'GET' && p === '/auth/google/callback') {
      const want = unsign(cookies(req).ht_oauth || '');
      if (!want || url.searchParams.get('state') !== want) return send(res, 400, 'bad state');
      const profile = await auth.exchange(url.searchParams.get('code'), baseUrl(req) + '/auth/google/callback');
      const u = db.upsertUser(profile); seedDefaults(u.id); login(res, u.id);
      setCookie(res, 'ht_oauth', '', { maxAge: 0 });
      return redirect(res, '/feeds');
    }
    if (m === 'POST' && p === '/auth/dev') {
      if (!DEV_LOGIN) return send(res, 403, 'dev login disabled');
      const { email } = await body(req);
      if (!email) return redirect(res, '/login');
      const u = db.upsertUser({ sub: 'dev:' + email, email, name: email.split('@')[0], picture: '' });
      seedDefaults(u.id); login(res, u.id);
      return redirect(res, '/feeds');
    }

    // --- feed API (form-posts; redirect back) ---
    if (m === 'POST' && p === '/api/feeds') {
      if (!user) return redirect(res, '/login');
      const { url: feedUrl } = await body(req);
      if (feedUrl) { const f = db.addFeed(user.id, feedUrl.trim()); refreshFeed(f).catch(() => {}); }
      return redirect(res, '/feeds');
    }
    let mm;
    if (m === 'POST' && (mm = p.match(/^\/api\/feeds\/(\d+)\/delete$/))) {
      if (!user) return redirect(res, '/login');
      db.removeFeed(user.id, Number(mm[1]));
      return redirect(res, '/feeds');
    }
    if (m === 'POST' && p === '/api/refresh') {
      if (!user) return redirect(res, '/login');
      await Promise.all(db.listFeeds(user.id).map(f => refreshFeed(f).catch(() => {})));
      return redirect(res, '/feeds');
    }

    send(res, 404, 'Not found', 'text/plain');
  } catch (e) {
    console.error(e); send(res, 500, 'Server error', 'text/plain');
  }
});

// CLI: `node server.mjs scrape` runs a one-off refresh and exits
if (process.argv[2] === 'scrape') {
  refreshAll().then(() => process.exit(0));
} else {
  server.listen(PORT, () => {
    console.log(`The Hacker Times → http://localhost:${PORT}  (Google OAuth: ${auth.oauthConfigured() ? 'on' : 'OFF — dev login enabled'})`);
    ensurePublic();   // seed + warm the public Hacker News edition
    scheduleDaily();
  });
}
