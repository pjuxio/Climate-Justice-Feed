require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const cron = require('node-cron');
const { saveArticles, queryArticles, getStats } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.NEWSAPI_KEY;

// Per-param cache: key = `${sortBy}_${days}_${region}`
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Evict stale entries so they don't linger in memory indefinitely
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now - entry.timestamp >= CACHE_TTL) cache.delete(key);
  }
}, CACHE_TTL);

// Core climate justice search terms (kept under ~230 chars so regional AND clauses stay within NewsAPI's 500-char query limit)
const BASE_QUERY =
  '"climate justice" OR "environmental justice" OR "climate equity" OR "climate racism" OR "just transition" ' +
  'OR "climate policy" OR "fossil fuels" OR "environmental law" OR "carbon tax" OR "COP29" OR "COP30" OR "COP31" OR "climate summit"';

// Geographic focus terms appended with AND to narrow results by region.
// null = no regional restriction (global).
const REGION_TERMS = {
  global:   null,
  americas: '"North America" OR "Latin America" OR "South America" OR "United States" OR Canada OR Mexico OR Brazil OR Colombia OR Caribbean OR "Indigenous peoples"',
  africa:   'Africa OR Nigeria OR Kenya OR Ghana OR "South Africa" OR Ethiopia OR Uganda OR Mozambique OR Senegal OR "Sub-Saharan" OR "African continent"',
  asia:     'Asia OR India OR Bangladesh OR Philippines OR Indonesia OR Pakistan OR "Pacific Islands" OR "Southeast Asia" OR China OR "Global South"',
  europe:   'Europe OR "European Union" OR EU OR Britain OR Germany OR France OR "United Kingdom" OR Poland OR "climate litigation"',
  mena:     '"Middle East" OR MENA OR "North Africa" OR Egypt OR Morocco OR Jordan OR Lebanon OR "Arab world" OR "Gulf states"',
};

// NewsAPI supports multiple comma-separated languages.
// For all regions we stay in English; going broader (es, fr, pt, ar) would
// require translation UI — add as a future enhancement.
const VALID_REGIONS = Object.keys(REGION_TERMS);

// Reject non-http(s) URLs to prevent javascript: / data: injection via API data
function isSafeUrl(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch { return false; }
}

function buildQuery(region) {
  const geo = REGION_TERMS[region];
  return geo ? `(${BASE_QUERY}) AND (${geo})` : BASE_QUERY;
}

function getDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

function estimateReadTime(text) {
  if (!text) return 1;
  const words = text.trim().split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 200));
}

function normalizeArticle(article, index) {
  return {
    id: index,
    title: article.title || 'Untitled',
    source: article.source?.name || 'Unknown Source',
    author: article.author || null,
    description: article.description || '',
    url: isSafeUrl(article.url) ? article.url : null,
    image: article.urlToImage && isSafeUrl(article.urlToImage) ? article.urlToImage : null,
    publishedAt: article.publishedAt,
    readTime: estimateReadTime((article.description || '') + ' ' + (article.content || '')),
  };
}

function categorize(article) {
  const text = (article.title + ' ' + article.description).toLowerCase();
  if (/policy|legislation|law|government|bill|act|regulation|cop\d/i.test(text)) return 'Policy';
  if (/communit|grassroot|activist|protest|movement|people|indigenous/i.test(text)) return 'Community';
  if (/science|research|study|data|report|scientist|temperature|emission/i.test(text)) return 'Science';
  if (/environment|ecosystem|biodiversity|nature|ocean|forest|wildlife/i.test(text)) return 'Environment';
  return 'General';
}

// ---------------------------------------------------------------------------
// NewsAPI fetch helper (shared by the live endpoint and the background collector)
// ---------------------------------------------------------------------------
async function fetchFromNewsAPI({ sortBy = 'popularity', days = 7, region = 'global' } = {}) {
  if (!API_KEY) throw new Error('NEWSAPI_KEY not configured');

  const controller = new AbortController();
  const fetchTimeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const q = buildQuery(region);
    const from = getDaysAgo(days);
    const url =
      `https://newsapi.org/v2/everything` +
      `?q=${encodeURIComponent(q)}` +
      `&language=en` +
      `&sortBy=${sortBy}` +
      `&from=${from}` +
      `&pageSize=100`;

    const response = await fetch(url, {
      headers: { 'X-Api-Key': API_KEY },
      signal: controller.signal,
    });
    clearTimeout(fetchTimeout);
    const data = await response.json();

    if (data.status !== 'ok') {
      throw new Error(`NewsAPI error: ${data.message}`);
    }

    const articles = data.articles
      .filter(a => a.title && a.title !== '[Removed]' && a.url)
      .map(normalizeArticle)
      .filter(a => a.url)
      .map(a => ({ ...a, category: categorize(a) }));

    return articles;
  } catch (err) {
    clearTimeout(fetchTimeout);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Background dataset collector
// Runs once per hour, cycling through all regions with a 30-day window.
// This builds the historical dataset over time without hammering the API.
// ---------------------------------------------------------------------------
let collectorRunning = false;

async function runCollector() {
  if (!API_KEY) return;
  if (collectorRunning) {
    console.log('[collector] Previous run still in progress, skipping.');
    return;
  }
  collectorRunning = true;
  console.log('[collector] Starting scheduled collection run…');

  let totalInserted = 0;
  let totalUpdated = 0;

  for (const region of VALID_REGIONS) {
    try {
      const articles = await fetchFromNewsAPI({ sortBy: 'publishedAt', days: 30, region });
      const { inserted, updated } = saveArticles(articles, region);
      totalInserted += inserted;
      totalUpdated += updated;
      console.log(`[collector] ${region}: +${inserted} new, ${updated} updated`);

      // Small pause between API calls to be a good citizen
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      console.error(`[collector] Error fetching region "${region}":`, err.message);
    }
  }

  console.log(`[collector] Done. Total: +${totalInserted} new, ${totalUpdated} updated.`);
  collectorRunning = false;
}

// Run once at startup (after a short delay to let the server start), then every hour.
setTimeout(runCollector, 5_000);
cron.schedule('0 * * * *', runCollector); // top of every hour

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// Gzip / deflate all responses
app.use(compression());

// Security headers
app.use((req, res, next) => {
  res.removeHeader('X-Powered-By');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' https://www.googletagmanager.com",
      "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'",
      "font-src 'self' https://fonts.gstatic.com",
      // Article images can originate from any publisher domain; Google S2 serves favicons
      "img-src 'self' https://www.google.com data: blob: *",
      "connect-src 'self' https://www.google-analytics.com https://analytics.google.com",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
  );
  next();
});

// Rate limiting: max 30 requests per IP per minute on the API
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait before refreshing again.' },
});
app.use('/api/', apiLimiter);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// index.html must not be cached so users always receive the latest deploy
app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve other static assets (JS, CSS, images) with a 24-hour cache
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag: true,
  index: false, // handled explicitly above
}));

// Live news feed (unchanged behaviour, but now also persists to the DB)
app.get('/api/news', async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({ error: 'News service is not configured.' });
  }

  const sortBy = ['popularity', 'publishedAt'].includes(req.query.sortBy)
    ? req.query.sortBy : 'popularity';
  const days = [1, 3, 7, 30].includes(Number(req.query.days))
    ? Number(req.query.days) : 7;
  const region = VALID_REGIONS.includes(req.query.region)
    ? req.query.region : 'global';
  const force = req.query.force === '1';

  const cacheKey = `${sortBy}_${days}_${region}`;
  const now = Date.now();
  const cached = cache.get(cacheKey);

  if (!force && cached && now - cached.timestamp < CACHE_TTL) {
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ articles: cached.data, cached: true });
  }

  try {
    const articles = await fetchFromNewsAPI({ sortBy, days, region });

    // Persist to the dataset database (fire-and-don't-block-response)
    try {
      const { inserted, updated } = saveArticles(articles, region);
      if (inserted > 0) console.log(`[db] Saved from live feed (${region}): +${inserted} new, ${updated} updated`);
    } catch (dbErr) {
      console.error('[db] Failed to save articles:', dbErr.message);
    }

    cache.set(cacheKey, { data: articles, timestamp: now });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ articles, cached: false });
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error('NewsAPI fetch timed out');
      return res.status(504).json({ error: 'News service request timed out. Please try again.' });
    }
    console.error('NewsAPI fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch news. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// Dataset API – query the collected article database
// ---------------------------------------------------------------------------

/**
 * GET /api/dataset/articles
 * Query parameters (all optional):
 *   category  – exact match (Policy | Community | Science | Environment | General)
 *   region    – exact match (global | americas | africa | asia | europe | mena)
 *   source    – partial match on source name
 *   from      – ISO date string lower bound on published_at  (e.g. 2024-01-01)
 *   to        – ISO date string upper bound on published_at
 *   search    – keyword search on title + description
 *   sort      – "published" (default) | "first_seen"
 *   limit     – rows per page (default 50, max 200)
 *   offset    – pagination offset (default 0)
 */
app.get('/api/dataset/articles', (req, res) => {
  try {
    const { category, region, source, from, to, search, sort, limit, offset } = req.query;
    const result = queryArticles({ category, region, source, from, to, search, sort, limit, offset });
    res.setHeader('Cache-Control', 'no-store');
    res.json(result);
  } catch (err) {
    console.error('[dataset] Query error:', err);
    res.status(500).json({ error: 'Failed to query dataset.' });
  }
});

/**
 * GET /api/dataset/stats
 * Returns aggregate statistics about the collected dataset.
 */
app.get('/api/dataset/stats', (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(getStats());
  } catch (err) {
    console.error('[dataset] Stats error:', err);
    res.status(500).json({ error: 'Failed to retrieve dataset statistics.' });
  }
});

// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`\n  Climate Justice Newsfeed running at http://localhost:${PORT}\n`);
  if (!API_KEY) {
    console.warn('  WARNING: NEWSAPI_KEY not set. Create a .env file with your key.\n');
  }
});
