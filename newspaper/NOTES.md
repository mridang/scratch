# The Hacker Times — request log

Running notes of what was asked for, newest at the bottom.

1. Fetch the top 20 Hacker News posts today, with links.
2. Check which pages are Cloudflare-protected and whether content is scrapable.
3. Scrape each article's content and save it; auto-generate a single-page newspaper; deploy a static page to view.
4. Find a place to temporarily publish it → deployed to surge.sh (`hacker-times-hn-20260619.surge.sh`); tunnels (cloudflared, localtunnel) blocked by sandbox network policy.
5. Add images — switched to a masonry grid with bundled lead images per story.
6. Group stories into sections — News / Opinion & Columns / Show HN / Hiring (Classifieds), with editorial classification.
7. Use CSS Grid Level 3 "grid-lanes" masonry (WebKit demo), with multicolumn fallback.
8. Flat design — no card boxes/borders/shadows; hairline rules, flush images.
9. Fix horizontal scroll on mobile.
10. Add an FT / Economist theme switcher; update `<meta name="theme-color">` so Android Chrome's address bar recolors.
11. Fix FT theme not changing the address bar (was near-white `#FFF1E5` → switched to claret `#990F3D`); add no-flash theme script.
12. Use brand-evocative fonts per theme (FT → Source Serif 4, Economist → Lora).
13. Fix "can't switch to Economist" — verified working on desktop + emulated mobile; added no-cache headers (was stale cache).
14. Fetch more articles — expanded from 20 to top 50.
15. Show clean publisher/author names instead of raw domains (LLM-resolved).
16. Keep a running notes file of requests (this file).
17. Add a favicon per article.
18. Make it a PWA — manifest, icons, service worker (offline + installable).
19. Generative, content-driven layout: weight(score,image,length) -> tier (lead/feature/standard/brief) -> lane span + copyfit char budget + line-clamp; weak tail collapses into an In Brief rail. Layout recomputes per run.
