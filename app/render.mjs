// Renders the newspaper + feeds UI, reusing the static site's CSS.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS = fs.readFileSync(path.join(__dirname, '_style.css'), 'utf8');

const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const ago = (iso) => {
  if (!iso) return '';
  const d = (Date.now() - new Date(iso)) / 36e5;
  if (d < 1) return 'just now';
  if (d < 24) return `${Math.round(d)}h ago`;
  return `${Math.round(d / 24)}d ago`;
};
const excerpt = (s, n) => { s = (s || '').trim(); return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s; };

// weight from recency + image + length; tiers emerge from the feed's own set
const TIER = { lead: [3, 620], feature: [2, 340], standard: [1, 190], brief: [1, 0] };
function assignTiers(arts) {
  const n = arts.length;
  return arts.map((a, i) => {
    const hasImg = !!a.image, len = (a.summary || '').length;
    if (i === 0 && n >= 5) return 'lead';
    if (i <= Math.max(1, Math.floor(n / 6)) && hasImg && len > 200) return 'feature';
    if ((!len || len < 120) && i >= n * 0.5) return 'brief';
    return 'standard';
  });
}

function card(a, tier) {
  const [span, budget] = TIER[tier];
  const side = (a.id % 2) ? 'ph-l' : 'ph-r';
  const img = a.image ? `<figure class="ph ${side}"><img loading="lazy" src="${esc(a.image)}" alt=""></figure>` : '';
  const fav = a.favicon ? `<img class="fav" loading="lazy" src="${esc(a.favicon)}" alt="">` : '';
  const ex = budget ? excerpt(a.summary, budget) : '';
  const exHtml = ex ? `<p class="ex">${esc(ex)}</p>` : '';
  const cls = `card t-${tier} w${span}${a.image ? '' : ' noimg'}`;
  return `
    <article class="${cls}">
      <a class="hit" href="${esc(a.url)}" target="_blank" rel="noopener"></a>
      <div class="meat">
        <div class="kicker"><span class="num">•</span>${fav} ${esc(a.source || host(a.url))}<span class="score">${esc(ago(a.published_at))}</span></div>
        <h2 class="hl">${esc(a.title)}</h2>
        ${img}${exHtml}
        <span class="more">Read full story ↗</span>
      </div>
    </article>`;
}

function briefBlock(items) {
  const rows = items.map(a => `<a class="brief-item" href="${esc(a.url)}" target="_blank" rel="noopener">
    <span class="bt">${esc(a.title)}</span><span class="bs">${esc(a.source || host(a.url))}</span></a>`).join('');
  return `<article class="card w-all brief-block"><div class="meat"><div class="brief-h">In Brief</div>${rows}</div></article>`;
}

function section(feed, arts) {
  const head = `<div class="sechead"><h3>${esc(feed.title || host(feed.url))}</h3>
    <span class="secdesc">${esc(host(feed.url))}</span>
    <span class="seccount">${arts.length} ${arts.length === 1 ? 'item' : 'items'}</span></div>`;
  if (!arts.length) return `<section class="zone">${head}<p class="secdesc" style="padding:8px 0">No articles yet — they'll appear after the next refresh.</p></section>`;
  const tiers = assignTiers(arts);
  const main = arts.filter((_, i) => tiers[i] !== 'brief').map((a, i) => card(a, tiers[arts.indexOf(a)])).join('');
  const briefs = arts.filter((_, i) => tiers[i] === 'brief');
  const body = `<div class="grid">${main}${briefs.length ? briefBlock(briefs) : ''}</div>`;
  return `<section class="zone">${head}${body}</section>`;
}

function shell(inner, user, extraHead = '') {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const nav = user
    ? `<a class="navlink" href="/feeds">Manage feeds</a> <span class="navuser">${esc(user.name || user.email)}</span> <a class="navlink" href="/logout">Sign out</a>`
    : `<a class="navlink" href="/login">Sign in</a>`;
  return `<!DOCTYPE html><html lang="en" data-theme="ft"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#990F3D"><title>The Hacker Times</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;0,700;1,400&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700;8..60,900&display=swap" rel="stylesheet">
<style>${CSS}
.appnav{display:flex;gap:14px;justify-content:center;align-items:center;flex-wrap:wrap;font-size:12px;letter-spacing:.5px;text-transform:uppercase;margin:10px 0 2px;}
.navlink{color:var(--masttext);font-weight:700;text-decoration:none;border:1px solid var(--mastrule);border-radius:999px;padding:5px 14px;}
.navuser{color:var(--masttext);opacity:.85;font-style:italic;text-transform:none;}
.panel{max-width:680px;margin:30px auto;background:var(--card,#fffdf7);padding:0 18px;}
.panel h2{font-family:Georgia,serif;font-size:26px;}
.feedrow{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:12px 0;border-top:1px solid var(--rule);}
.feedrow .u{font-size:12px;color:var(--muted);word-break:break-all;}
.btn{font-family:var(--serif);font-weight:700;border:1px solid var(--ink);background:var(--ink);color:var(--paper);border-radius:6px;padding:9px 16px;cursor:pointer;text-decoration:none;display:inline-block;}
.btn.ghost{background:transparent;color:var(--ink);}
.btn.danger{background:transparent;color:var(--accent);border-color:var(--accent);padding:5px 10px;font-size:12px;}
.addform{display:flex;gap:8px;margin:14px 0 6px;}
.addform input{flex:1;padding:10px 12px;border:1px solid var(--rule);border-radius:6px;font-size:14px;font-family:var(--serif);}
.gsi{display:inline-flex;align-items:center;gap:10px;background:#fff;color:#3c4043;border:1px solid #dadce0;border-radius:6px;padding:11px 18px;font:600 15px system-ui;text-decoration:none;}
.muted{color:var(--muted);font-size:13px;}
</style>${extraHead}</head>
<body>
<header class="mast">
  <div class="row"><span>Vol. I · No. 1</span><span>Your Front Page</span><span>Price: One Upvote</span></div>
  <h1>The Hacker Times</h1>
  <div class="tag">“All the News That’s Fit to Upvote”</div>
  <div class="date"><span>${today}</span><span>Personalised Edition</span></div>
  <div class="switcher" role="group" aria-label="Theme"><button data-theme="ft" aria-pressed="true">FT</button><button data-theme="economist" aria-pressed="false">Economist</button></div>
  <nav class="appnav">${nav}</nav>
</header>
<div class="wrap">${inner}</div>
<script>(function(){var h=document.documentElement,b=document.querySelectorAll('.switcher button');
function a(t){h.setAttribute('data-theme',t);var m=document.querySelector('meta[name=theme-color]');
var c=getComputedStyle(h).getPropertyValue('--themecolor').trim();if(m&&c)m.setAttribute('content',c);
b.forEach(function(x){x.setAttribute('aria-pressed',x.dataset.theme===t);});try{localStorage.setItem('ht-theme',t)}catch(e){}}
b.forEach(function(x){x.addEventListener('click',function(){a(x.dataset.theme)})});
try{a(localStorage.getItem('ht-theme')||'ft')}catch(e){}})();</script>
</body></html>`;
}

export function renderPaper(user, feedSections) {
  if (!feedSections.length)
    return shell(`<div class="panel"><h2>No feeds yet</h2>
      <p class="muted">Sign in and add some feeds to build your paper.</p>
      <p><a class="btn" href="/feeds">Manage feeds →</a></p></div>`, user);
  return shell(feedSections.map(({ feed, articles }) => section(feed, articles)).join(''), user);
}

export function renderFeeds(user, feeds) {
  const rows = feeds.length ? feeds.map(f => `<div class="feedrow">
      <div><strong>${esc(f.title || host(f.url))}</strong><div class="u">${esc(f.url)}</div></div>
      <form method="post" action="/api/feeds/${f.id}/delete"><button class="btn danger">Remove</button></form>
    </div>`).join('') : '<p class="muted">No feeds yet. Add an RSS/Atom feed URL below.</p>';
  return shell(`<div class="panel">
    <h2>Your feeds</h2>
    <form class="addform" method="post" action="/api/feeds">
      <input name="url" type="url" placeholder="https://example.com/feed.xml" required>
      <button class="btn" type="submit">Add</button>
    </form>
    <p class="muted">Feeds are fetched &amp; scraped automatically every day. <form style="display:inline" method="post" action="/api/refresh"><button class="btn ghost" style="padding:4px 10px;font-size:12px">Refresh now</button></form></p>
    ${rows}
    <p style="margin-top:24px"><a class="btn ghost" href="/">← Back to the paper</a></p>
  </div>`, user);
}

export function renderLogin(user, { configured }) {
  const btn = configured
    ? `<a class="gsi" href="/auth/google"><svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.7 30.1 0 24 0 14.6 0 6.4 5.4 2.5 13.3l7.8 6c1.9-5.6 7.1-9.8 13.7-9.8z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.1 5.3-4.6 6.9l7.1 5.5c4.1-3.8 6.5-9.4 6.5-16.9z"/><path fill="#FBBC05" d="M10.3 28.3c-.5-1.4-.8-2.9-.8-4.3s.3-3 .8-4.3l-7.8-6C.9 16.9 0 20.3 0 24s.9 7.1 2.5 10.3l7.8-6z"/><path fill="#34A853" d="M24 48c6.1 0 11.3-2 15-5.5l-7.1-5.5c-2 1.4-4.6 2.2-7.9 2.2-6.6 0-12.2-4.5-14.2-10.5l-7.8 6C6.4 42.6 14.6 48 24 48z"/></svg>Sign in with Google</a>`
    : `<p class="muted">Google sign-in isn't configured yet (set <code>GOOGLE_CLIENT_ID</code> / <code>GOOGLE_CLIENT_SECRET</code>). For local testing, dev login is enabled:</p>
       <form class="addform" method="post" action="/auth/dev"><input name="email" type="email" placeholder="you@example.com" required><button class="btn">Dev sign in</button></form>`;
  return shell(`<div class="panel" style="text-align:center">
    <h2>Sign in</h2>
    <p class="muted">Sign in to add your own feeds and get a personalised daily paper.</p>
    <div style="margin:22px 0">${btn}</div>
  </div>`, user);
}
