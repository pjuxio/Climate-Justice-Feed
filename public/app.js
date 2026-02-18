/* ===== State ===== */
let allArticles = [];
let activeFilter = 'All';
let activeSortBy  = 'popularity';
let activeDays    = 7;
let activeRegion  = 'global';
let bookmarks = new Set(JSON.parse(localStorage.getItem('cj_bookmarks') || '[]'));

/* ===== DOM refs ===== */
const feed        = document.getElementById('feed');
const errorState  = document.getElementById('error-state');
const errorMsg    = document.getElementById('error-msg');
const emptyState  = document.getElementById('empty-state');
const refreshBtn  = document.getElementById('refresh-btn');
const themeBtn    = document.getElementById('theme-btn');
const retryBtn    = document.getElementById('retry-btn');
const clearFilter = document.getElementById('clear-filter-btn');
const articleCount= document.getElementById('article-count');
const toast       = document.getElementById('toast');
const filterChips = document.querySelectorAll('.filter-chip');
const sortBtns    = document.querySelectorAll('[data-sort]');
const rangeBtns   = document.querySelectorAll('[data-days]');
const regionBtns  = document.querySelectorAll('[data-region]');
const brandSub    = document.getElementById('brand-sub');
const themeIconDark  = document.getElementById('theme-icon-dark');
const themeIconLight = document.getElementById('theme-icon-light');
const infoBtn        = document.getElementById('info-btn');
const modalOverlay   = document.getElementById('modal-overlay');
const modalClose     = document.getElementById('modal-close');

/* ===== Helpers ===== */
function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  const d = Math.floor(diff / 86_400_000);
  if (h < 1)  return 'Just now';
  if (h < 24) return `${h}h ago`;
  if (d < 7)  return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function initials(name) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase();
}

function getFaviconUrl(articleUrl) {
  try {
    const origin = new URL(articleUrl).origin;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(origin)}&sz=64`;
  } catch { return null; }
}

function showToast(msg, duration = 2400) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), duration);
}

/* ===== Theme ===== */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('cj_theme', theme);
  if (theme === 'dark') {
    themeIconDark.style.display  = '';
    themeIconLight.style.display = 'none';
  } else {
    themeIconDark.style.display  = 'none';
    themeIconLight.style.display = '';
  }
}

(function initTheme() {
  const saved = localStorage.getItem('cj_theme') || 'dark';
  applyTheme(saved);
})();

themeBtn.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

/* ===== Render a single card ===== */
function createCard(article) {
  const a = document.createElement('a');
  a.className = 'card';
  a.href = article.url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.dataset.id = article.id;
  a.dataset.category = article.category;

  const faviconUrl = getFaviconUrl(article.url);
  const isBookmarked = bookmarks.has(String(article.id));

  a.innerHTML = `
    <div class="card-body">
      <div class="card-meta">
        <div class="source-avatar">
          ${faviconUrl
            ? `<img src="${faviconUrl}" alt="" onerror="this.style.display='none'">`
            : ''}
          <span>${initials(article.source)}</span>
        </div>
        <div class="source-info">
          <div class="source-name">${escHtml(article.source)}</div>
          <div class="source-time">${timeAgo(article.publishedAt)}</div>
        </div>
        <span class="category-badge">${escHtml(article.category)}</span>
      </div>
      <h2 class="card-title">${escHtml(article.title)}</h2>
    </div>
    ${article.image ? `<img class="card-image" src="${escHtml(article.image)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
    ${article.description ? `<p class="card-desc">${escHtml(article.description)}</p>` : ''}
    <div class="card-footer">
      <span class="read-time">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        ${article.readTime} min read
      </span>
      <button class="card-action bookmark-btn ${isBookmarked ? 'bookmarked' : ''}" data-id="${article.id}" title="Bookmark">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="${isBookmarked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
        ${isBookmarked ? 'Saved' : 'Save'}
      </button>
      <button class="card-action share-btn" data-url="${escHtml(article.url)}" data-title="${escHtml(article.title)}" title="Share">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        Share
      </button>
      <button class="card-open-btn" title="Open article">
        Read
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
      </button>
    </div>
  `;

  /* Bookmark button */
  a.querySelector('.bookmark-btn').addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    const id = String(article.id);
    const btn = e.currentTarget;
    const svg = btn.querySelector('svg');
    if (bookmarks.has(id)) {
      bookmarks.delete(id);
      btn.classList.remove('bookmarked');
      svg.setAttribute('fill', 'none');
      btn.innerHTML = btn.innerHTML.replace('Saved', 'Save');
      showToast('Removed from saved');
    } else {
      bookmarks.add(id);
      btn.classList.add('bookmarked');
      svg.setAttribute('fill', 'currentColor');
      btn.innerHTML = btn.innerHTML.replace('Save', 'Saved');
      showToast('Saved to bookmarks');
    }
    localStorage.setItem('cj_bookmarks', JSON.stringify([...bookmarks]));
  });

  /* Share button */
  a.querySelector('.share-btn').addEventListener('click', async e => {
    e.preventDefault();
    e.stopPropagation();
    const url   = e.currentTarget.dataset.url;
    const title = e.currentTarget.dataset.title;
    if (navigator.share) {
      try { await navigator.share({ title, url }); } catch {}
    } else {
      await navigator.clipboard.writeText(url);
      showToast('Link copied to clipboard');
    }
  });

  /* Open btn — card is already an <a>, button just signals intent visually */
  a.querySelector('.card-open-btn').addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    window.open(article.url, '_blank', 'noopener,noreferrer');
  });

  return a;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ===== Render filtered feed ===== */
function renderFeed() {
  const filtered = activeFilter === 'All'
    ? allArticles
    : allArticles.filter(a => a.category === activeFilter);

  feed.innerHTML = '';
  errorState.style.display  = 'none';
  emptyState.style.display  = 'none';

  if (filtered.length === 0) {
    emptyState.style.display = 'flex';
    articleCount.textContent = '0 articles';
    return;
  }

  const frag = document.createDocumentFragment();
  filtered.forEach(a => frag.appendChild(createCard(a)));
  feed.appendChild(frag);
  articleCount.textContent = `${filtered.length} article${filtered.length !== 1 ? 's' : ''}`;
}

/* ===== Subtitle helper ===== */
const REGION_LABELS = {
  global:   'Global',
  americas: 'Americas',
  africa:   'Africa',
  asia:     'Asia Pacific',
  europe:   'Europe',
  mena:     'MENA',
};

function updateSubtitle() {
  const sortLabel  = activeSortBy === 'popularity' ? 'Top' : 'Latest';
  const rangeLabel = activeDays === 1 ? '24h'
    : activeDays === 3 ? '3 days'
    : activeDays === 7 ? '7 days'
    : '30 days';
  const regionLabel = REGION_LABELS[activeRegion] || 'Global';
  brandSub.textContent = `${sortLabel} · ${rangeLabel} · ${regionLabel}`;
}

/* ===== Fetch news ===== */
async function fetchNews(force = false) {
  refreshBtn.classList.add('spinning');
  errorState.style.display = 'none';
  emptyState.style.display = 'none';

  /* Show skeletons only on first load */
  if (allArticles.length === 0) {
    feed.innerHTML = [1,2,3].map(() => `
      <div class="skeleton-card">
        <div class="sk sk-header"></div>
        <div class="sk sk-title"></div>
        <div class="sk sk-title short"></div>
        <div class="sk sk-img"></div>
        <div class="sk sk-text"></div>
        <div class="sk sk-text short"></div>
        <div class="sk sk-footer"></div>
      </div>`).join('');
  }

  updateSubtitle();

  try {
    const params = new URLSearchParams({ sortBy: activeSortBy, days: activeDays, region: activeRegion });
    if (force) params.set('force', '1');
    const res  = await fetch(`/api/news?${params}`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    allArticles = data.articles;
    renderFeed();

    if (force) showToast(data.cached ? 'Feed is up to date' : 'Feed refreshed');
  } catch (err) {
    feed.innerHTML = '';
    errorState.style.display = 'flex';
    errorMsg.textContent = err.message || 'Unable to connect to the server.';
  } finally {
    refreshBtn.classList.remove('spinning');
  }
}

/* ===== Filter chips ===== */
filterChips.forEach(chip => {
  chip.addEventListener('click', () => {
    filterChips.forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    activeFilter = chip.dataset.filter;
    renderFeed();
  });
});

clearFilter.addEventListener('click', () => {
  filterChips.forEach(c => c.classList.remove('active'));
  document.querySelector('[data-filter="All"]').classList.add('active');
  activeFilter = 'All';
  renderFeed();
});

/* ===== Sort buttons ===== */
sortBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.sort === activeSortBy) return;
    sortBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeSortBy = btn.dataset.sort;
    allArticles = [];
    fetchNews(true);
  });
});

/* ===== Range buttons ===== */
rangeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const d = Number(btn.dataset.days);
    if (d === activeDays) return;
    rangeBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeDays = d;
    allArticles = [];
    fetchNews(true);
  });
});

/* ===== Region buttons ===== */
regionBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.region === activeRegion) return;
    regionBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeRegion = btn.dataset.region;
    allArticles = [];
    fetchNews(true);
  });
});

/* ===== Refresh button ===== */
refreshBtn.addEventListener('click', () => fetchNews(true));
retryBtn.addEventListener('click', () => fetchNews(true));

/* ===== Info modal ===== */
function openModal() {
  modalOverlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  modalClose.focus();
}

function closeModal() {
  modalOverlay.style.display = 'none';
  document.body.style.overflow = '';
}

infoBtn.addEventListener('click', openModal);
modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });

/* ===== Keyboard shortcut ===== */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && modalOverlay.style.display !== 'none') {
    closeModal();
    return;
  }
  if (e.key === 'r' || e.key === 'R') {
    if (document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      fetchNews(true);
    }
  }
});

/* ===== Sync main padding-top to sticky stack height ===== */
const stickyStack = document.getElementById('sticky-stack');
const mainEl = document.querySelector('.main');

function syncPadding() {
  mainEl.style.paddingTop = stickyStack.offsetHeight + 'px';
}

const resizeObserver = new ResizeObserver(syncPadding);
resizeObserver.observe(stickyStack);
syncPadding();

/* ===== Init ===== */
fetchNews();
