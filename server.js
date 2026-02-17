require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.NEWSAPI_KEY;

// Per-param cache: key = `${sortBy}_${days}_${region}`
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Core climate justice search terms
const BASE_QUERY =
  '"climate justice" OR "environmental justice" OR "climate equity" OR "climate racism" OR "just transition"';

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
    url: article.url,
    image: article.urlToImage || null,
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

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/news', async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({
      error: 'NEWSAPI_KEY is not set. Please create a .env file with your NewsAPI key.',
    });
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
    return res.json({ articles: cached.data, cached: true });
  }

  try {
    const q = buildQuery(region);
    const from = getDaysAgo(days);
    const url =
      `https://newsapi.org/v2/everything` +
      `?q=${encodeURIComponent(q)}` +
      `&language=en` +
      `&sortBy=${sortBy}` +
      `&from=${from}` +
      `&pageSize=40` +
      `&apiKey=${API_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'ok') {
      return res.status(502).json({ error: data.message || 'NewsAPI error' });
    }

    const articles = data.articles
      .filter(a => a.title && a.title !== '[Removed]' && a.url)
      .map(normalizeArticle)
      .map(a => ({ ...a, category: categorize(a) }));

    cache.set(cacheKey, { data: articles, timestamp: now });
    res.json({ articles, cached: false });
  } catch (err) {
    console.error('NewsAPI fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch news. Please try again.' });
  }
});

app.listen(PORT, () => {
  console.log(`\n  Climate Justice Newsfeed running at http://localhost:${PORT}\n`);
  if (!API_KEY) {
    console.warn('  WARNING: NEWSAPI_KEY not set. Create a .env file with your key.\n');
  }
});
