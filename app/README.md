# The Hacker Times — app

A personalised daily newspaper. Users **sign in with Google**, **add/remove RSS/Atom feeds**, and every day all feeds are **fetched and scraped** into a generative newspaper layout (the same tiered design as the static site).

**Zero dependencies** — runs on Node ≥ 22.5 using only built-ins (`node:http`, `node:sqlite`, global `fetch`, `node:crypto`).

## Run

```bash
cd app
cp .env.example .env        # fill in values (see below)
npm start                   # → http://localhost:3000
```

Without Google credentials it starts with **dev login** enabled (enter any email) so you can try it immediately. The first sign-in seeds a few default feeds (Hacker News, Simon Willison, Julia Evans).

## Go live with Google sign-in

1. Google Cloud Console → **APIs & Services → Credentials → Create OAuth client ID → Web application**.
2. Add an **Authorized redirect URI**: `https://YOUR_DOMAIN/auth/google/callback`.
3. Put the client id/secret, your public `BASE_URL`, and a random `SESSION_SECRET` in `.env`.
4. `npm start` (or run behind a process manager / container). Set `ALLOW_DEV_LOGIN=0`.

## How it works

| Piece | File |
|---|---|
| HTTP server, routing, signed-cookie sessions, OAuth wiring, daily scheduler | `server.mjs` |
| Google OAuth 2.0 / OIDC (auth-code flow) | `auth.mjs` |
| SQLite schema + queries (`users`, `feeds`, `articles`) | `db.mjs` |
| Feed fetch + RSS/Atom parse + article scrape (og:image, summary, favicon) | `scrape.mjs` |
| Newspaper + feeds UI + login (reuses the static site's CSS in `_style.css`) | `render.mjs` |

- **Daily refresh:** scheduled for 06:00 server time (`scheduleDaily`). Run on demand with `npm run scrape`, or the "Refresh now" button.
- **Layout:** articles are weighted (recency + image + length) into tiers (lead / feature / standard / brief) per feed-section, with floated images and an "In Brief" rail.

## Routes

`GET /` paper · `GET /feeds` manage · `GET /login` · `GET /auth/google` + `/auth/google/callback` · `POST /auth/dev` · `POST /api/feeds` · `POST /api/feeds/:id/delete` · `POST /api/refresh` · `GET /logout` · `GET /healthz`
