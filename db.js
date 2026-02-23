/**
 * db.js – SQLite persistence layer for the Climate Justice article dataset.
 *
 * Uses better-sqlite3 (synchronous API) so all calls are simple function
 * calls with no async ceremony.  The database file is created automatically
 * on first run (default: ./articles.db, overridable via DB_PATH env var).
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'articles.db');

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS articles (
    url           TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    source_name   TEXT,
    author        TEXT,
    description   TEXT,
    image_url     TEXT,
    published_at  TEXT,
    category      TEXT,
    read_time     INTEGER,
    region        TEXT,
    first_seen_at TEXT NOT NULL,
    last_seen_at  TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles (published_at DESC);
  CREATE INDEX IF NOT EXISTS idx_articles_category     ON articles (category);
  CREATE INDEX IF NOT EXISTS idx_articles_region       ON articles (region);
  CREATE INDEX IF NOT EXISTS idx_articles_first_seen   ON articles (first_seen_at DESC);
`);

// ---------------------------------------------------------------------------
// Prepared statements
// ---------------------------------------------------------------------------
const stmtUpsert = db.prepare(`
  INSERT INTO articles
    (url, title, source_name, author, description, image_url,
     published_at, category, read_time, region, first_seen_at, last_seen_at)
  VALUES
    (@url, @title, @source_name, @author, @description, @image_url,
     @published_at, @category, @read_time, @region, @now, @now)
  ON CONFLICT(url) DO UPDATE SET
    last_seen_at = @now,
    -- update mutable fields in case they were enriched since first seen
    title        = COALESCE(NULLIF(@title, ''), title),
    description  = COALESCE(NULLIF(@description, ''), description),
    image_url    = COALESCE(@image_url, image_url),
    category     = COALESCE(@category, category),
    read_time    = COALESCE(@read_time, read_time)
`);

const upsertMany = db.transaction((articles, region) => {
  const now = new Date().toISOString();
  let inserted = 0;
  let updated = 0;

  for (const a of articles) {
    if (!a.url) continue;
    const info = stmtUpsert.run({
      url:         a.url,
      title:       a.title || '',
      source_name: a.source || null,
      author:      a.author || null,
      description: a.description || null,
      image_url:   a.image || null,
      published_at: a.publishedAt || null,
      category:    a.category || null,
      read_time:   a.readTime || null,
      region:      region || 'global',
      now,
    });
    // changes === 1 means a row was inserted (new); 0 means update (existing)
    if (info.changes === 1) inserted++;
    else updated++;
  }

  return { inserted, updated };
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Persist an array of normalised article objects to the database.
 * Duplicate URLs are upserted: new fields update the existing row.
 *
 * @param {object[]} articles   – normalised article objects from server.js
 * @param {string}   region     – the region filter used when fetching
 * @returns {{ inserted: number, updated: number }}
 */
function saveArticles(articles, region) {
  return upsertMany(articles, region);
}

/**
 * Query stored articles with optional filters and pagination.
 *
 * @param {object} opts
 * @param {string}  [opts.category]   – filter by category (exact match)
 * @param {string}  [opts.region]     – filter by region
 * @param {string}  [opts.source]     – filter by source name (LIKE %value%)
 * @param {string}  [opts.from]       – ISO date string lower bound on published_at
 * @param {string}  [opts.to]         – ISO date string upper bound on published_at
 * @param {string}  [opts.search]     – full-text LIKE filter on title+description
 * @param {string}  [opts.sort]       – 'published' (default) | 'first_seen'
 * @param {number}  [opts.limit=50]   – max rows to return (capped at 200)
 * @param {number}  [opts.offset=0]   – pagination offset
 * @returns {{ articles: object[], total: number }}
 */
function queryArticles(opts = {}) {
  const {
    category, region, source, from, to, search,
    sort = 'published',
    limit = 50,
    offset = 0,
  } = opts;

  const safeLimit = Math.min(Math.max(1, Number(limit) || 50), 200);
  const safeOffset = Math.max(0, Number(offset) || 0);

  const conditions = [];
  const params = {};

  if (category) {
    conditions.push('category = @category');
    params.category = category;
  }
  if (region) {
    conditions.push('region = @region');
    params.region = region;
  }
  if (source) {
    conditions.push('source_name LIKE @source');
    params.source = `%${source}%`;
  }
  if (from) {
    conditions.push('published_at >= @from');
    params.from = from;
  }
  if (to) {
    conditions.push('published_at <= @to');
    params.to = to;
  }
  if (search) {
    conditions.push('(title LIKE @search OR description LIKE @search)');
    params.search = `%${search}%`;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const orderBy = sort === 'first_seen'
    ? 'first_seen_at DESC'
    : 'published_at DESC';

  const countRow = db.prepare(`SELECT COUNT(*) as n FROM articles ${where}`).get(params);
  const articles = db.prepare(
    `SELECT * FROM articles ${where} ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`
  ).all({ ...params, limit: safeLimit, offset: safeOffset });

  return { articles, total: countRow.n };
}

/**
 * Return aggregate statistics about the stored dataset.
 *
 * @returns {object}
 */
function getStats() {
  const total     = db.prepare('SELECT COUNT(*) as n FROM articles').get().n;
  const earliest  = db.prepare('SELECT MIN(published_at) as d FROM articles').get().d;
  const latest    = db.prepare('SELECT MAX(published_at) as d FROM articles').get().d;
  const firstSeen = db.prepare('SELECT MIN(first_seen_at) as d FROM articles').get().d;

  const byCategory = db.prepare(
    'SELECT category, COUNT(*) as count FROM articles GROUP BY category ORDER BY count DESC'
  ).all();

  const byRegion = db.prepare(
    'SELECT region, COUNT(*) as count FROM articles GROUP BY region ORDER BY count DESC'
  ).all();

  const bySource = db.prepare(
    'SELECT source_name, COUNT(*) as count FROM articles GROUP BY source_name ORDER BY count DESC LIMIT 20'
  ).all();

  return { total, earliest, latest, firstSeen, byCategory, byRegion, bySource };
}

module.exports = { saveArticles, queryArticles, getStats };
