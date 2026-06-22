# The Hacker Times → "Scenery" — Handover Specification

A complete brief of everything requested across the project, so another agent can implement it
properly on Cloudflare. The current Node reference implementation lives in `app/` and the static
generator output in `newspaper/` of the `mridang/scratch` repo (branch
`claude/new-session-y9u2vv`) — treat those as the **source of truth for layout, CSS and logic**,
and port them to Cloudflare.

---

## 1. Product vision

**A personalised daily newspaper** called **"The Hacker Times"**. It turns web feeds into a
print-style newspaper that is **generated fresh every day**. It started as a one-off scrape of the
Hacker News front page and grew into a multi-user product:

- **Logged-out visitors** see a public **Hacker News edition** (a normal, populated paper).
- **Logged-in users** (Google sign-in) get a **personalised paper** built from feeds they add/remove.
- **Every feed is fetched & scraped once per day**, and the paper is rebuilt from that content.
- Target deployment is **Cloudflare** (project name **"scenery"**: there is already a `scenery`
  Worker and a `scenery-db` D1 database in the account — use them).

The single most important and most-often-missed theme: **this is a real newspaper, not a card grid.**
Layout is **content-driven and generative**, and **text is fit to space** — see §4.

---

## 2. Content & data pipeline

- **Sources are "feeds."** Originally the Hacker News API (Firebase: `topstories.json` →
  `item/<id>.json`), now generalised to **RSS/Atom feeds** (e.g. `hnrss.org/frontpage`,
  `hnrss.org/best`, personal blogs). A user "adds a feed" by URL.
- **Daily job** fetches every feed, parses items, and **scrapes each article page** for:
  - `og:image` (lead image), a text summary (RSS `description`/`content`, fallback to
    `<meta name=description>`), the **favicon** (use `https://www.google.com/s2/favicons?sz=64&domain=<host>`),
    and a clean **source name** (see §6).
- **Per feed, keep the latest ~14 items**; enrich the newest ~10 with a page fetch for `og:image`.
- Store users, feeds, and articles in a database. On Cloudflare this must be **D1** (the existing
  `scenery-db`). Schema (from the reference app):
  - `users(id, sub, email, name, picture, created_at)`
  - `feeds(id, user_id, url, title, created_at, UNIQUE(user_id,url))`
  - `articles(id, feed_id, url, title, source, image, favicon, summary, published_at, fetched_at, UNIQUE(feed_id,url))`
- A hidden **public system user** (`sub='__public__'`) owns the HN feeds shown to logged-out
  visitors; it is seeded on first run and refreshed by the same daily job.

**Cloudflare specifics:** the daily job must be a **Cron Trigger** (`scheduled` handler), not a
Node timer. Use the Workers `fetch` handler for HTTP. There is no `node:sqlite`/`node:http`/Node
filesystem — use D1 bindings and Web Crypto.

---

## 3. Accounts & feeds (auth + feed management UI)

- **Sign in with Google** (OAuth 2.0 / OpenID Connect, authorization-code flow). Flow: redirect to
  Google with `scope=openid email profile` + a CSRF `state` (stored in a short-lived signed cookie)
  → callback exchanges `code` at `oauth2.googleapis.com/token` → decode the `id_token` claims
  (`sub`, `email`, `name`, `picture`) → upsert user → set session cookie. Redirect URI must be
  `https://<domain>/auth/google/callback`.
- **Sessions:** signed, HTTP-only cookies (HMAC over the user id; on Workers use Web Crypto
  `crypto.subtle` HMAC). `SameSite=Lax`, `Secure` in production.
- **Feed management UI** (`/feeds`, requires login): list the user's feeds, an **Add** form
  (RSS/Atom URL), a **Remove** button per feed, and a **"Refresh now"** action. New users are seeded
  with a few default feeds (HN front page + a couple of blogs) so their paper isn't empty.
- **Routes** (reference): `GET /` (paper) · `GET /feeds` · `GET /login` · `GET /auth/google` +
  `/auth/google/callback` · `POST /auth/dev` (passwordless dev login fallback — keep for staging,
  disable in prod) · `POST /api/feeds` · `POST /api/feeds/:id/delete` · `POST /api/refresh` ·
  `GET /logout` · `GET /healthz`.
- **Secrets** needed: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `BASE_URL`
  (Workers: `wrangler secret put …`).

---

## 4. THE LAYOUT — generative, content-driven newspaper (read this twice)

This is the heart of the project and the part most likely to be under-built. Requirements, in the
user's words and intent:

1. **Not a fixed template.** The layout must **change every day based on the content** — it is a
   *function of the data*, not a static skeleton. Different stories/scores/images tomorrow ⇒ a
   different page, with no code change. (Conceptually: weighted space allocation, like a squarified
   treemap / guillotine layout — but implemented pragmatically; see below.)
2. **Popularity drives prominence.** Each story gets a **weight** computed from its own properties:
   `weight = log(score or recency) + (has_image ? +0.6) ; ×0.6 if text is thin (<~300 chars)`.
   For RSS use recency in place of HN score (newest ≈ highest).
3. **Weight → tier**, computed **relative to each section's own distribution that day**:
   - **Lead** (top item, if the section has ≥5): spans ~3 lanes, big headline, image, ~620-char body.
   - **Feature** (next few, capped ~n/6): spans 2 lanes, image, ~340 chars.
   - **Standard** (the bulk): 1 lane, ~190 chars.
   - **Brief** (weak/thin tail): collapses into an **"In Brief"** rail (headline + source only).
4. **Text must FIT the box (copyfitting).** Space is decided first (from weight), then the excerpt
   is **trimmed to that cell's character budget at build time**, AND `-webkit-line-clamp` is applied
   as a hard CSS guarantee it can never overflow. (Headlines also clamp.)
5. **Images wrap with text, newspaper-style.** In lead/feature stories the photo is a **floated
   `<figure>` inside the text flow** so the body copy **wraps around it**; the float **alternates
   left/right** story-to-story. Standard cards show the image as a block. (Critical detail the other
   agent likely missed.)
6. **Grid engine:** CSS **Grid Level 3 "grid-lanes"** (`display:grid-lanes`, WebKit) with the
   standard `masonry` syntax for Firefox and a **multicolumn (`columns`) fallback** for Chrome —
   progressive enhancement via `@supports`. Lead/brief use `column-span:all` (multicol) / `grid-column:1/-1`
   (grid). The user views in Chrome, which uses the **multicolumn fallback**, so it must look right there.
7. **Mobile = TWO columns.** Shrink the lane width on phones (`--lane:150px`, `@media(max-width:600px)`)
   so two columns fit; lead/feature become **full-width bands** (so their wrapped image has room),
   standards sit 2-up, In Brief full-width. **No horizontal scroll** on mobile (guard with
   `overflow-wrap:anywhere`, `min-width:0`, `max-width:100%`, wrap the masthead meta row).

The reference implementation of all of this is `app/render.mjs` + `app/_style.css` (ported from the
static generator `build_lanes.py`). **Port the CSS verbatim** and re-implement the
weight→tier→copyfit logic; do not invent a new layout.

---

## 5. Sections & classification

- The paper is grouped into **sections (desks)**. Current agreed set is **four**:
  **The Front Page (News)**, **Opinion & Columns**, **Show & Tell (Show HN/Launch HN)**,
  **The Classifieds (Hiring)**.
- We explored richer desks (Technology / Science / Business / Culture, etc.) and **decided to keep
  the 4** for now — but build classification so it's easy to change later.
- **Classification rules:** title-based and deterministic for **Show HN** (`title startswith "show hn"`)
  and **Hiring** (`"is hiring"` / `(YC …) hiring`); domain-based for **News vs Opinion** (personal/
  single-author blogs → Opinion; institutions/companies/orgs → News). Keep a small editable
  bloggers/news allowlist.
- For the **per-user feeds** product, the natural sectioning is **one section per feed** (feed title =
  desk). Either model is acceptable; keep it configurable. **Sport, Weather, Obituaries etc. do not
  exist on these sources** — don't add empty desks.

---

## 6. Source names & favicons

- **Never show raw domains.** Each article shows a **clean publisher/author name**, e.g.
  `cs.cornell.edu → Cornell University`, `blog.ui.com → Ubiquiti`, `news.mit.edu → MIT News`,
  personal blogs → the **author's name** (`mnot.net → Mark Nottingham`, `tim.blog → Tim Ferriss`).
- Resolution order: **curated overrides → `og:site_name` (then `application-name`, JSON-LD
  `publisher.name`) → cleaned registrable domain** (strip `www/blog/news` subdomains and the TLD,
  handle multi-part TLDs like `.co.uk`, and blog platforms like `*.blogspot.com` → use the subdomain).
- This is explicitly a good place to **use an LLM** (a single batched classification call:
  domain+title → canonical name). The user wants this done via an LLM where practical.
- **Every article shows a favicon** next to the source name (Google s2 favicon service, ~14px).

---

## 7. Themes & theming (FT and Economist)

- A **theme switcher** in the masthead toggling two newspaper identities, persisted to `localStorage`:
  - **FT**: paper **`#FFF1E5`** (FT pink), **claret `#990F3D`** masthead/accents, body font
    **Source Serif 4** (closest free match to Financier).
  - **Economist**: white page, **Economist red `#E3120B`** masthead banner, body font **Lora**
    (evokes Milo/EcoType).
- **Dynamic `<meta name="theme-color">`** so **Android Chrome's address bar recolors** with the theme
  (this was an explicit requirement — see the Chrome 39 theme-color feature). FT → claret `#990F3D`,
  Economist → red `#E3120B`. **Do not use a near-white value** (an early FT `#FFF1E5` looked like no
  change). Add a no-flash inline `<head>` script that applies the saved theme + bar colour before paint.

---

## 8. PWA & mobile

- The static version was made an **installable PWA** (manifest, icons incl. maskable + apple-touch,
  service worker for offline, an **Install button** wired to `beforeinstallprompt` because Chrome no
  longer auto-prompts).
- **Hard-won lesson:** the service worker **caused a serious outage** — it cached error responses
  from a flaky host and then served a blank page ("the grid is gone"). It was removed and replaced
  with a self-unregistering kill-switch. **If you add a SW on Cloudflare, only ever cache `res.ok`
  responses, use network-first for HTML, and version the cache.** Cloudflare hosting is reliable, so
  a careful SW is fine — but treat it as optional and get the core app solid first.

---

## 9. Deployment target: Cloudflare ("scenery")

- Use the existing **`scenery` Worker** and **`scenery-db` D1 database** in the account.
- **Worker** serves all routes (`fetch` handler) and runs the **daily scrape via a Cron Trigger**
  (`scheduled` handler, e.g. `0 6 * * *`). Bind D1 in `wrangler.toml`
  (`[[d1_databases]] binding="DB" database_name="scenery-db" database_id="f9cdf278-d8df-4222-a2d6-9d5b45809d4d"`).
- **Port from the Node reference:** replace `node:sqlite` with D1 (`env.DB.prepare().bind().run()/all()`),
  `node:http` with the Workers `fetch` handler, `node:crypto` HMAC with `crypto.subtle`, the Node
  timer scheduler with the Cron Trigger. OAuth and feed-fetch use `fetch` (already portable).
- Set secrets via `wrangler secret put` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`),
  and `BASE_URL` to the deployed domain; register that domain's `/auth/google/callback` in Google.
- **Note:** the other agent has apparently already deployed *a* worker — reconcile it with these
  requirements rather than assuming it's complete.

---

## 10. Known pitfalls / lessons learned (save the other agent time)

1. **Layout is generative & copyfit, not a fixed grid** (§4) — the most-missed requirement.
2. **Images must wrap with text** in big stories (floated figures) — not just images-on-top.
3. **Two columns on mobile**, no horizontal scroll.
4. **Chrome uses the multicolumn fallback** (no grid-lanes/masonry support) — verify it there.
5. **Clean source names, not domains**; favicon per article.
6. **theme-color must be a visibly non-white colour** and updated dynamically.
7. **Service workers can cache failures** — guard with `res.ok`, network-first HTML, versioned cache.
8. **Daily scrape** must be a real scheduled job (Cron Trigger on Cloudflare).
9. **Logged-out users must see a populated public HN paper**, never an empty state.

---

## 11. Reference implementation (use as the spec-by-example)

In `mridang/scratch`, branch `claude/new-session-y9u2vv`:

- `app/` — zero-dependency Node app (Google login, per-user feeds, daily scrape, public edition).
  - `render.mjs` + `_style.css` — **the authoritative layout & CSS to port.**
  - `scrape.mjs` — RSS/Atom parse + article scrape (og:image, summary, favicon).
  - `db.mjs` — schema & queries (mirror in D1).
  - `auth.mjs` — Google OAuth flow. `server.mjs` — routing/sessions/scheduler/public edition.
- `newspaper/` — the static generator's output (same look) + `NOTES.md` (chronological request log).

---

## 12. Acceptance checklist

- [ ] Deployed on Cloudflare (`scenery` Worker + `scenery-db` D1 + Cron Trigger for daily scrape).
- [ ] Google sign-in works; sessions persist; sign-out works.
- [ ] Logged-out → populated public Hacker News paper.
- [ ] Logged-in → add/remove feeds; paper rebuilt from them.
- [ ] Feeds fetched + scraped daily (image, summary, favicon, clean source name).
- [ ] Generative layout: weight→tier (lead/feature/standard/brief), copyfit + line-clamp, In Brief rail.
- [ ] Images **wrap with text** (floated, alternating) in lead/feature.
- [ ] **Two columns on mobile**, no horizontal scroll; works in Chrome (multicol fallback).
- [ ] FT/Economist theme switcher with correct fonts/palettes and **dynamic theme-color**.
- [ ] (Optional) PWA with a **safe** service worker.

---

## Appendix A — Scraping & summarisation pipeline (exact behaviour)

This is the "how" behind §2 and §6. Replicate it on Cloudflare (all of it is `fetch` + string work,
so it ports directly; only storage/scheduling change).

### A.1 Fetching mechanics
- HTTP GET with a **browser User-Agent**, `redirect: follow`, and an **AbortController timeout**
  (~15 s for feeds, ~12 s for article pages). Network failures return empty string, never throw.
- **Concurrency:** refresh ~6 feeds in parallel; within a feed, enrich the newest ~10 article pages
  in parallel.
- **Caps:** keep **MAX_PER_FEED = 14** items per feed; fetch og:image for the newest **ENRICH = 10**.
- On each refresh, **replace** that feed's article rows (delete + insert) so the paper reflects the
  feed's current state.

### A.2 Two source shapes
- **HN API (the original mode):** `GET topstories.json` → take the first N ids → `GET item/<id>.json`
  for each → `{title, url, score, by, time}`. For Ask/Show/self posts with no `url`, fall back to the
  HN permalink `news.ycombinator.com/item?id=<id>`. `score` feeds `weight()` directly.
- **RSS/Atom (the current mode):** fetch the feed XML and parse (A.3).

### A.3 RSS/Atom parsing (dependency-free, regex-based)
- Feed `title` = first `<title>`.
- Items = matches of `<item>…</item>` (RSS 2.0) **or** `<entry>…</entry>` (Atom).
- Per item:
  - `link` = `<link>` text, else Atom `<link href="…">`.
  - `title` = `<title>`.
  - `published` = first of `pubDate | published | updated | dc:date` → parse to ISO (blank if invalid).
  - `summary` = first of `description | summary | content`, capped ~1200 chars.
  - `source` = hostname of the link (see A.6); `favicon` = Google s2 (A.7).
- A `decode()` helper: unwrap `<![CDATA[…]]>`, unescape HTML entities (`&amp; &lt; &gt; &quot; &#39;
  &nbsp;`), strip tags, collapse whitespace.

### A.4 Article-page scraping (enrichment of the newest items)
- Fetch the article URL's HTML, then extract:
  - **og:image:** first `<meta property|name>` in `[og:image, og:image:url, twitter:image]`; resolve
    relative URLs against the article URL. (The static build also had an inline-`<img>` fallback that
    skipped `logo|icon|avatar|sprite|pixel|blank|spacer|1x1`.)
  - **summary fallback:** `<meta name="description">` when the feed gave none.
  - **(static newspaper full-text):** BeautifulSoup — drop `script/style/nav/footer/header/aside/
    form/svg/button`; prefer `<article>`→`<main>`→`<body>`; collect `h1–h4/p/li/blockquote/pre` text;
    **if < 400 chars, fall back to whole-`<body>` extraction**. The resulting `text_len` is stored and
    used by `weight()` (the "thin content" penalty) and copyfitting.

### A.5 "Summaries" — what they actually are (important clarification)
- **They are extractive, not AI-generated.** The excerpt under each headline is the **scraped text**
  (RSS `description`/`content`, or page paragraphs) **trimmed to the tier's character budget at a word
  boundary** ("copyfitting"), then `-webkit-line-clamp`'d as a hard overflow guard. **There is no LLM
  summarisation in the current build.**
- Budgets: **lead 620, feature 340, standard 190, brief 0** (headline only). Trim = cut to N chars,
  drop the trailing partial word, append "…".
- **Option (recommended if real summaries are wanted):** add **one batched LLM call per refresh** to
  write tight, tier-length summaries (Claude — `claude-opus-4-8`, or Haiku for cost). Keep the
  extractive excerpt as the fallback when the LLM is unavailable. (We already use an LLM for source
  names, so this is the same pattern.)

### A.6 Source-name resolution algorithm (§6 in detail)
Priority: **curated override map → `og:site_name` (then `application-name`, JSON-LD `publisher.name`)
→ `domain_clean(host)`**.
`domain_clean`:
1. If the registrable domain is a **blog platform** (`blogspot.com, substack.com, medium.com,
   wordpress.com, github.io, pages.dev, netlify.app, vercel.app, tumblr.com`) → use the **subdomain
   label** (e.g. `paulbuchheit.blogspot.com → Paul Buchheit`).
2. Else strip leading `www/blog/news/m/en/docs/about/status/...` subdomains.
3. If the second-to-last label is a **multi-part-TLD token** (`co, ac, org, gov, com, net, edu, …`)
   use the **third-from-last** label (so `independent.co.uk → Independent`).
4. Title-case, tidy whitespace, cap length.
For the 50 HN items this was done **by an LLM** (Claude reading `domain + title` → canonical name,
e.g. `cs.cornell.edu → Cornell University`). Replicate with a **single batched LLM call**; the
algorithm above is the deterministic fallback.

### A.7 Favicons & images — storage choice
- **Favicon:** `https://www.google.com/s2/favicons?sz=64&domain=<host>`, rendered ~14 px beside the
  source name.
- **Static site** *downloaded and bundled* og:images (`newspaper/img/`) and favicons
  (`newspaper/favicons/`) so the page works offline.
- **Dynamic app** *hotlinks* the og:image and favicon (no storage).
- **On Cloudflare:** hotlinking is fine; if you want resilience/perf, cache images to **R2** and serve
  from there (optional).

### A.8 Weight → tier → copyfit (exact formulas)
- `weight(a) = ln(score+1)` `+0.6 if a.image` `×0.6 if text_len < 300`. **For RSS use recency**
  (sort newest-first; newest ≈ highest weight) in place of `score`.
- `assignTiers(items sorted by weight/recency desc; n = count)`:
  - `i==0 && n>=5` → **lead**
  - `r = weight/lead_weight`; `r>=0.66 && features<max(1, floor(n/6)) && text>=300` → **feature**
  - `(r<=0.42 || text<150) && i >= n*0.5` → **brief**
  - else → **standard**
- `tier → (laneSpan, charBudget)`: `lead(3,620) feature(2,340) standard(1,190) brief(1,0)`.
- `excerpt(text, budget)`: concatenate paragraphs until ≥ budget, cut to budget at a word boundary,
  add "…". CSS clamp guarantees fit: lead = budgeted (no clamp, may be 2-col on wide screens),
  feature `-webkit-line-clamp:7`, standard `:6`, standard headline `:4`.

### A.9 Daily refresh
- **Static:** a Python pipeline (`build_lanes.py` + scrapers in the repo history) regenerates
  `newspaper/` on demand.
- **Dynamic Node:** `scheduleDaily()` fires at **06:00** server time + manual `POST /api/refresh` +
  CLI `node server.mjs scrape`.
- **Cloudflare (target):** a **Cron Trigger** `scheduled` handler iterates all feeds in D1 and runs
  the A.1–A.4 refresh for each. Keep `POST /api/refresh` for manual/testing.
