# Contributing to ClimateJustice.news

Thank you for your interest in contributing! This project is led and maintained by [@pjuxio](https://github.com/pjuxio). Contributions of all kinds are welcome — bug reports, feature ideas, code, documentation, and more.

---

## Table of contents

- [Code of Conduct](#code-of-conduct)
- [Ways to contribute](#ways-to-contribute)
- [Getting started](#getting-started)
- [Development workflow](#development-workflow)
- [Pull request guidelines](#pull-request-guidelines)
- [Commit message style](#commit-message-style)
- [Project areas](#project-areas)
- [Questions?](#questions)

---

## Code of Conduct

By participating, you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md). Please read it before contributing.

---

## Ways to contribute

- **Report a bug** — open an issue using the Bug Report template
- **Request a feature** — open an issue using the Feature Request template
- **Fix a bug** — look for issues tagged `bug` or `good first issue`
- **Build a feature** — look for issues tagged `enhancement`
- **Improve documentation** — typos, clarifications, examples
- **Add regions or search terms** — expand the geographic or topical coverage

---

## Getting started

### 1. Fork and clone

```bash
git clone https://github.com/pjuxio/Climate-Justice-News.git
cd Climate-Justice-News
npm install
```

### 2. Set up environment

```bash
cp .env.example .env
# Add your NewsAPI key — free at https://newsapi.org/register
```

### 3. Run locally

```bash
npm run dev   # auto-restarts on file changes
# → http://localhost:3000
```

---

## Development workflow

1. **Create a branch** from `main`:
   ```bash
   git checkout -b fix/short-description
   # or
   git checkout -b feat/short-description
   ```

2. **Make your changes** — keep them focused and minimal

3. **Test manually** — verify your change works and doesn't break anything

4. **Commit** with a clear message (see style below)

5. **Push** your branch and **open a pull request** against `main`

---

## Pull request guidelines

- Keep PRs small and focused — one change per PR
- Reference any related issue: `Closes #123`
- Describe *what* you changed and *why* in the PR description
- The lead maintainer (@pjuxio) reviews all PRs; please be patient
- PRs that break existing functionality or add unnecessary complexity will be declined

---

## Commit message style

Use the conventional format:

```
<type>: <short summary>
```

| Type | When to use |
|------|-------------|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, no logic change |
| `refactor` | Code restructure, no behavior change |
| `chore` | Tooling, dependencies, config |

Examples:
```
feat: add oceania region filter
fix: correct cache TTL reset on force reload
docs: clarify EDITOR_TOKEN setup in README
```

---

## Project areas

| Area | Files | Good for |
|------|-------|----------|
| API & search | `server.js` | Adding regions, search terms, new endpoints |
| Frontend UI | `public/app.js`, `public/index.html` | New filters, card layout, interactions |
| Styles | `public/style.css` | Theming, responsiveness, component styles |
| Documentation | `README.md`, `CONTRIBUTING.md` | Clarification, examples |

### Adding a new region

1. Add an entry to `REGION_TERMS` in `server.js`
2. Add a matching `<button data-region="your-key">` in `public/index.html`
3. Add a label entry to `REGION_LABELS` in `public/app.js`

### Adding search terms

Edit `BASE_QUERY` in `server.js`. Use NewsAPI's boolean syntax (`AND`, `OR`, `"quoted phrases"`).

---

## Questions?

Open an issue with the `question` label or reach out to [@pjuxio](https://github.com/pjuxio) directly.
