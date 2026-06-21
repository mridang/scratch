// Feed fetching + article scraping — pure Node (fetch + regex), no deps.
import { allFeeds, replaceArticles } from './db.mjs';

const UA = 'Mozilla/5.0 (compatible; HackerTimesBot/1.0; +https://example.com)';
const MAX_PER_FEED = 14;
const ENRICH = 10; // how many article pages to fetch for og:image per feed

const get = async (url, ms = 15000) => {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*' }, signal: c.signal, redirect: 'follow' });
    return await r.text();
  } catch { return ''; } finally { clearTimeout(t); }
};

const decode = (s = '') => s
  .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&#x27;/gi, "'")
  .replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decode(m[1]) : '';
};
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const favicon = (u) => `https://www.google.com/s2/favicons?sz=64&domain=${hostOf(u)}`;

// Minimal RSS 2.0 + Atom parser
function parseFeed(xml, feedUrl) {
  const title = tag(xml, 'title') || hostOf(feedUrl);
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    let link = tag(b, 'link');
    if (!link) { // Atom: <link href="..."/>
      const m = b.match(/<link[^>]*href=["']([^"']+)["']/i); if (m) link = m[1];
    }
    if (!link) continue;
    const pub = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
    const date = pub ? new Date(pub) : null;
    items.push({
      title: tag(b, 'title') || link,
      url: link.trim(),
      summary: (tag(b, 'description') || tag(b, 'summary') || tag(b, 'content') || '').slice(0, 1200),
      published_at: date && !isNaN(date) ? date.toISOString() : '',
      source: hostOf(link),
      favicon: favicon(link),
    });
  }
  return { title, items: items.slice(0, MAX_PER_FEED) };
}

function ogImage(html, base) {
  for (const p of ['og:image', 'og:image:url', 'twitter:image']) {
    const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']+)["']`, 'i'))
           || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${p}["']`, 'i'));
    if (m) { try { return new URL(m[1], base).href; } catch { return m[1]; } }
  }
  return '';
}
function metaDesc(html) {
  const m = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  return m ? decode(m[1]) : '';
}

export async function refreshFeed(feed) {
  const xml = await get(feed.url);
  if (!xml) return { feed: feed.url, ok: false, n: 0 };
  const { title, items } = parseFeed(xml, feed.url);
  // enrich the newest few with og:image + better summary
  await Promise.all(items.slice(0, ENRICH).map(async (it) => {
    const page = await get(it.url, 12000);
    if (page) { it.image = ogImage(page, it.url); if (!it.summary) it.summary = metaDesc(page); }
  }));
  replaceArticles(feed.id, items);
  return { feed: title || feed.url, ok: true, n: items.length };
}

export async function refreshAll() {
  const feeds = allFeeds();
  const results = [];
  // modest concurrency
  const q = [...feeds];
  const worker = async () => { while (q.length) { const f = q.shift(); results.push(await refreshFeed(f)); } };
  await Promise.all(Array.from({ length: 6 }, worker));
  const ok = results.filter(r => r.ok).length;
  console.log(`[scrape] refreshed ${ok}/${feeds.length} feeds, ${results.reduce((s, r) => s + r.n, 0)} articles @ ${new Date().toISOString()}`);
  return results;
}

// Schedule a daily run at 06:00 server time, plus an immediate run if asked.
export function scheduleDaily() {
  const run = () => refreshAll().catch(e => console.error('[scrape] error', e));
  const now = new Date();
  const next = new Date(now); next.setHours(6, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  setTimeout(function tick() { run(); setInterval(run, 24 * 3600 * 1000); }, next - now);
  console.log(`[scrape] daily refresh scheduled for ${next.toISOString()}`);
}
