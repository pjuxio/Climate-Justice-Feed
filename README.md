# ClimateJustice.news

[![CI](https://github.com/pjuxio/Climate-Justice-News/actions/workflows/ci.yml/badge.svg)](https://github.com/pjuxio/Climate-Justice-News/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Contributions welcome](https://img.shields.io/badge/contributions-welcome-brightgreen.svg)](CONTRIBUTING.md)

A real-time climate justice news aggregator with a social media-style card feed. Articles are pulled from [NewsAPI](https://newsapi.org) using a broad set of justice-framing search terms and can be filtered by region, category, sort order, and date range.

**Live:** [climatejustice.news](https://climatejustice.news) · **Repo:** [github.com/pjuxio/Climate-Justice-News](https://github.com/pjuxio/Climate-Justice-News) · **Maintainer:** [@pjuxio](https://github.com/pjuxio)

---

## Stack

| Layer | Tech |
|---|---|
| Backend | Node.js · Express |
| News data | [NewsAPI](https://newsapi.org) (`/v2/everything`) |
| Frontend | Vanilla HTML · CSS · JS (no build step) |
| Hosting | Heroku |

---

## Project structure

```
.
├── server.js           # Express server — API proxy + static file serving
├── package.json
├── .env.example        # Environment variable template
├── .gitignore
└── public/
    ├── index.html      # App shell, filter/control markup, info modal
    ├── style.css       # Design tokens, dark/light theme, all component styles
    └── app.js          # State management, fetch logic, card rendering
```

---

## Getting started

### 1. Clone and install

```bash
git clone https://github.com/pjuxio/Climate-Justice-Feed.git
cd Climate-Justice-Feed
npm install
```

### 2. Add your NewsAPI key

Get a free key at [newsapi.org/register](https://newsapi.org/register), then:

```bash
cp .env.example .env
# open .env and set:
# NEWSAPI_KEY=your_key_here
```

### 3. Run locally

```bash
npm start
# → http://localhost:3000

# Or with auto-restart on file changes:
npm run dev
```

---

## How it works

### Search query

Every request to `/api/news` builds a query from two parts:

**Base terms** (always included, joined with `OR`):
```
"climate justice" OR "environmental justice" OR "climate equity"
OR "climate racism" OR "just transition"
```

**Regional focus** (optional, ANDed with the base query):
```
AND (Africa OR Nigeria OR Kenya OR Ghana OR "South Africa" ...)
```

This means a regional result must contain both the justice framing *and* the geographic terms — not just be published by a regional outlet.

### API endpoint

```
GET /api/news?sortBy=popularity&days=7&region=global
```

| Param | Values | Default |
|---|---|---|
| `sortBy` | `popularity` · `publishedAt` | `popularity` |
| `days` | `1` · `3` · `7` · `30` | `7` |
| `region` | `global` · `americas` · `africa` · `asia` · `europe` · `mena` | `global` |
| `force` | `1` | — |

Responses are cached in memory per `sortBy_days_region` combination with a **5-minute TTL**. Pass `force=1` to bypass the cache.

### Article categorisation

Each article is categorised server-side by scanning its headline and description against keyword patterns:

| Category | Keywords |
|---|---|
| Policy | legislation, law, government, bill, regulation, COP |
| Community | community, grassroots, activist, protest, movement, indigenous |
| Science | science, research, study, data, report, temperature, emission |
| Environment | environment, ecosystem, biodiversity, nature, ocean, forest, wildlife |
| General | everything else |

---

## Extending the search

To add new search terms, edit `BASE_QUERY` in [server.js](server.js):

```js
const BASE_QUERY =
  '"climate justice" OR "environmental justice" OR "climate equity"
   OR "climate racism" OR "just transition"';
```

To add or modify regional focus terms, edit the `REGION_TERMS` map in [server.js](server.js):

```js
const REGION_TERMS = {
  global:   null,
  americas: '"North America" OR "Latin America" OR ...',
  africa:   'Africa OR Nigeria OR Kenya OR ...',
  // add new regions here
};
```

Any new region key added here also needs a matching button in [public/index.html](public/index.html) (`data-region="your-key"`) and a label entry in `REGION_LABELS` in [public/app.js](public/app.js).

---

## Deployment

### Heroku

```bash
heroku git:remote -a your-app-name
heroku config:set NEWSAPI_KEY=your_key_here
git push heroku main
```

### Custom domain

1. In Heroku Dashboard → **Settings → Domains**, add `climatejustice.news` and `www.climatejustice.news`
2. Heroku will provide a DNS target (e.g. `your-app.herokudns.com`)
3. At your registrar, add:
   - `CNAME www → your-app.herokudns.com`
   - `ALIAS` / `ANAME` for the apex (`@`) → same target
     *(or use Cloudflare for CNAME flattening on the apex)*

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `NEWSAPI_KEY` | Yes | Your NewsAPI.org API key |
| `PORT` | No | Server port (default: `3000`) |
| `EDITOR_TOKEN` | No | Secret token enabling editor curation (pin/hide articles) |
| `DATABASE_URL` | No | PostgreSQL connection string for persistent curation |

---

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) to get started, and review the [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

- Bug reports → [open an issue](https://github.com/pjuxio/Climate-Justice-News/issues/new/choose)
- Feature requests → [open an issue](https://github.com/pjuxio/Climate-Justice-News/issues/new/choose)
- Code → fork, branch, PR against `main`

This project is led by [@pjuxio](https://github.com/pjuxio). All PRs are reviewed by the maintainer.

---

## License

[MIT](LICENSE) © pjuxio
