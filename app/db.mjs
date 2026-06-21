// SQLite data layer (uses Node's built-in node:sqlite — no native deps)
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(process.env.DB_PATH || path.join(__dirname, 'data.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sub TEXT UNIQUE, email TEXT, name TEXT, picture TEXT,
    created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS feeds(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, url TEXT NOT NULL, title TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, url));
  CREATE TABLE IF NOT EXISTS articles(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feed_id INTEGER NOT NULL, url TEXT NOT NULL, title TEXT,
    source TEXT, image TEXT, favicon TEXT, summary TEXT,
    published_at TEXT, fetched_at TEXT DEFAULT (datetime('now')),
    UNIQUE(feed_id, url));
`);

export const upsertUser = (p) => {
  db.prepare(`INSERT INTO users(sub,email,name,picture) VALUES(?,?,?,?)
    ON CONFLICT(sub) DO UPDATE SET email=excluded.email,name=excluded.name,picture=excluded.picture`)
    .run(p.sub, p.email, p.name, p.picture || '');
  return db.prepare('SELECT * FROM users WHERE sub=?').get(p.sub);
};
export const getUser = (id) => db.prepare('SELECT * FROM users WHERE id=?').get(id);

export const listFeeds = (userId) =>
  db.prepare('SELECT * FROM feeds WHERE user_id=? ORDER BY created_at').all(userId);
export const addFeed = (userId, url, title) => {
  db.prepare('INSERT OR IGNORE INTO feeds(user_id,url,title) VALUES(?,?,?)').run(userId, url, title || url);
  return db.prepare('SELECT * FROM feeds WHERE user_id=? AND url=?').get(userId, url);
};
export const removeFeed = (userId, id) =>
  db.prepare('DELETE FROM feeds WHERE id=? AND user_id=?').run(id, userId);
export const allFeeds = () => db.prepare('SELECT * FROM feeds').all();

export const replaceArticles = (feedId, items) => {
  const del = db.prepare('DELETE FROM articles WHERE feed_id=?');
  const ins = db.prepare(`INSERT OR IGNORE INTO articles
    (feed_id,url,title,source,image,favicon,summary,published_at) VALUES(?,?,?,?,?,?,?,?)`);
  del.run(feedId);
  for (const a of items)
    ins.run(feedId, a.url, a.title, a.source || '', a.image || '', a.favicon || '', a.summary || '', a.published_at || '');
};
export const feedArticles = (feedId) =>
  db.prepare('SELECT * FROM articles WHERE feed_id=? ORDER BY published_at DESC, id DESC').all(feedId);

export default db;
