require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.NEWSAPI_KEY;
const EDITOR_TOKEN = process.env.EDITOR_TOKEN;

// ─── Curation: editor-managed hidden/pinned articles ──────────────────────────
const CURATION_FILE = path.join(__dirname, 'curation.json');

function loadCuration() {
  try {
    const data = JSON.parse(fs.readFileSync(CURATION_FILE, 'utf8'));
    return {
      hidden: Array.isArray(data.hidden) ? data.hidden : [],
      pinned: Array.isArray(data.pinned) ? data.pinned : [],
    };
  } catch {
    return { hidden: [], pinned: [] };
  }
}

function saveCuration(data) {
  fs.writeFileSync(CURATION_FILE, JSON.stringify(data, null, 2), 'utf8');
}

let curation = loadCuration();

// Apply hidden + pinned curation to a raw article list.
// Hidden articles are removed; pinned articles are moved to the front.
// Called at serve-time so curation changes take effect without bypassing cache.
function applyCuration(articles) {
  const hiddenSet = new Set(curation.hidden);
  const pinnedUrls = new Set(curation.pinned.map(p => p.url));
  const live = articles.filter(a => !hiddenSet.has(a.url) && !pinnedUrls.has(a.url));
  const pinned = curation.pinned.map((p, i) => ({ ...p, id: `pinned-${i}`, pinned: true }));
  return [...pinned, ...live];
}

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

// Gzip / deflate all responses
app.use(compression());

// Parse JSON bodies (needed for curation POST/DELETE endpoints)
app.use(express.json());

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

// Editor auth: validates X-Editor-Token header against EDITOR_TOKEN env var
function editorAuth(req, res, next) {
  if (!EDITOR_TOKEN) {
    return res.status(503).json({ error: 'Editor mode is not configured. Set EDITOR_TOKEN in .env.' });
  }
  const token = req.headers['x-editor-token'];
  if (!token || token !== EDITOR_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

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

// ─── Curation API ─────────────────────────────────────────────────────────────

// Public: read current curation state (frontend loads this to show badges/counts)
app.get('/api/curation', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ hidden: curation.hidden, pinned: curation.pinned });
});

// Hide an article by URL — removes it from the public feed
app.post('/api/curation/hide', editorAuth, (req, res) => {
  const { url } = req.body;
  if (!url || !isSafeUrl(url)) return res.status(400).json({ error: 'Invalid URL' });
  if (!curation.hidden.includes(url)) {
    curation.hidden.push(url);
    saveCuration(curation);
  }
  res.json({ ok: true });
});

// Unhide a previously hidden article
app.delete('/api/curation/hide', editorAuth, (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });
  curation.hidden = curation.hidden.filter(u => u !== url);
  saveCuration(curation);
  res.json({ ok: true });
});

// Pin an article — stores full article data so it always appears at the top
app.post('/api/curation/pin', editorAuth, (req, res) => {
  const { url, title, source, author, description, image, publishedAt, readTime, category, note } = req.body;
  if (!url || !isSafeUrl(url)) return res.status(400).json({ error: 'Invalid URL' });
  if (!curation.pinned.find(p => p.url === url)) {
    curation.pinned.unshift({
      url,
      title: String(title || '').slice(0, 500),
      source: String(source || '').slice(0, 200),
      author: author ? String(author).slice(0, 200) : null,
      description: String(description || '').slice(0, 2000),
      image: image && isSafeUrl(image) ? image : null,
      publishedAt: publishedAt || new Date().toISOString(),
      readTime: Math.min(Math.max(Number(readTime) || 1, 1), 60),
      category: ['Policy', 'Community', 'Science', 'Environment', 'General'].includes(category)
        ? category : 'General',
      note: String(note || '').slice(0, 500),
      pinnedAt: new Date().toISOString(),
    });
    saveCuration(curation);
  }
  res.json({ ok: true });
});

// Unpin an article
app.delete('/api/curation/pin', editorAuth, (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });
  curation.pinned = curation.pinned.filter(p => p.url !== url);
  saveCuration(curation);
  res.json({ ok: true });
});

// ─── News API ─────────────────────────────────────────────────────────────────

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
    return res.json({ articles: applyCuration(cached.data), cached: true });
  }

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

    // Send API key in header instead of query string to keep it out of logs
    const response = await fetch(url, {
      headers: { 'X-Api-Key': API_KEY },
      signal: controller.signal,
    });
    clearTimeout(fetchTimeout);
    const data = await response.json();

    if (data.status !== 'ok') {
      // Log full upstream message internally; return a generic error to the client
      console.error('NewsAPI error:', data.message);
      return res.status(502).json({ error: 'Unable to fetch news at this time. Please try again.' });
    }

    const articles = data.articles
      .filter(a => a.title && a.title !== '[Removed]' && a.url)
      .map(normalizeArticle)
      .filter(a => a.url) // discard any articles whose URL failed isSafeUrl
      .map(a => ({ ...a, category: categorize(a) }));

    cache.set(cacheKey, { data: articles, timestamp: now });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ articles: applyCuration(articles), cached: false });
  } catch (err) {
    clearTimeout(fetchTimeout);
    if (err.name === 'AbortError') {
      console.error('NewsAPI fetch timed out');
      return res.status(504).json({ error: 'News service request timed out. Please try again.' });
    }
    console.error('NewsAPI fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch news. Please try again.' });
  }
});

app.listen(PORT, () => {
  console.log(`\n  Climate Justice Newsfeed running at http://localhost:${PORT}\n`);
  if (!API_KEY) {
    console.warn('  WARNING: NEWSAPI_KEY not set. Create a .env file with your key.\n');
  }
  if (!EDITOR_TOKEN) {
    console.warn('  NOTE: EDITOR_TOKEN not set. Editor curation mode is disabled.\n');
  }
});
