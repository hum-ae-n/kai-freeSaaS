/**
 * data-loader.js — entry module. Loads tools.json, parses the URL, routes to a mode.
 *
 * ==========================================================================
 * DOM CONTRACT (frozen, Phase 2.7) — curator.js and client.js may rely on:
 *   #curator-root   curator mode mount point, [hidden] until routed
 *   #client-root    client mode mount point, [hidden] until routed
 *   #loading        initial loading message, removed once routed
 *   #toast          shared toast element (use showToast(), not direct access)
 * CSS class names: components in styles.css COMPONENTS block (.btn, .badge,
 * .panel, .favicon, .toast, .input, .select) are shared API. Curator-only
 * classes are prefixed .cur- / table classes; client-only classes .cli- /
 * .tool-card / .card-*. Neither mode touches the other's prefix.
 *
 * SECURITY (PRD section 7): all text from the URL or tools.json reaches the
 * DOM via textContent or el(). URLs are only assigned to href/src attributes.
 *
 * DARK MODE (Batch E, additive, does not change the block above): the
 * `data-theme` attribute on <html> is "light" or "dark". The inline script
 * in index.html's <head> sets it before first paint; themeToggleButton()
 * here is the only thing that ever changes it afterwards. Both modes call
 * themeToggleButton() rather than building their own switch.
 * ==========================================================================
 */

const DUCK = (domain) => `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`;
const GOOGLE = (domain) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=16`;

/** Create an element with attributes and children. Strings become text nodes. */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

/** Extract a bare hostname for favicon lookup. */
export function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}

/** Favicon img with the PRD section 8 fallback chain (see delegated listener below). */
export function favicon(domain) {
  if (!domain) return null;
  return el('img', {
    class: 'favicon',
    src: DUCK(domain),
    width: '16',
    height: '16',
    alt: '',
    loading: 'lazy',
    dataset: { domain },
  });
}

/** External link: new tab, no opener. Text is set via textContent (el()). */
export function extLink(url, text, withIcon) {
  const domain = getDomain(url);
  return el('a', { href: url, target: '_blank', rel: 'noopener noreferrer' },
    withIcon ? favicon(domain) : null,
    text,
  );
}

export const money = (n) => `£${Number(n).toLocaleString('en-GB')}`;

let toastTimer;
export function showToast(message, kind = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast is-${kind}`;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
}

/** Cap a URL text param at maxLen and collapse whitespace-only input to
    absent. Reused for any text param read off the URL, not only ?client=. */
export function sanitizeParam(raw, maxLen = 80) {
  if (raw == null) return '';
  return raw.trim().slice(0, maxLen).trim();
}

/** Share a URL via the native share sheet where available, falling back to
    clipboard copy plus toast. AbortError (user dismissed the sheet) is a
    silent no-op; any other share failure also falls back to clipboard. */
export async function shareUrl(url, text) {
  if (navigator.share) {
    try {
      await navigator.share({ title: document.title, text, url });
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      await copyLink(url);
    }
    return;
  }
  await copyLink(url);
}

async function copyLink(url) {
  try {
    await navigator.clipboard.writeText(url);
    showToast('Link copied');
  } catch {
    showToast('Copy failed: your browser blocked clipboard access', 'error');
  }
}

/* Favicon fallback chain, one delegated listener for every icon on the page:
   DuckDuckGo fails → retry via Google → fails again → hide. */
document.addEventListener('error', (event) => {
  const img = event.target;
  if (!(img instanceof HTMLImageElement) || !img.classList.contains('favicon')) return;
  if (!img.dataset.fallback) {
    img.dataset.fallback = '1';
    img.src = GOOGLE(img.dataset.domain || '');
  } else {
    img.style.display = 'none';
  }
}, true);

/* --- dark mode ------------------------------------------------------------
   The inline head script (index.html) already set data-theme before first
   paint, from the stored choice or prefers-color-scheme. This module owns
   the toggle control itself, shared between curator and client mode, plus
   keeping any open toggle button in sync if the OS theme changes live and
   the reader has never made an explicit choice of their own. */
const THEME_KEY = 'freestack:v1:theme';
const SVG_NS = 'http://www.w3.org/2000/svg';

function readTheme() {
  try { return localStorage.getItem(THEME_KEY); } catch { return null; }
}
function writeTheme(value) {
  try { localStorage.setItem(THEME_KEY, value); } catch { /* private mode etc: no-op */ }
}
function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

function themeIcon(isDark) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [key, value] of Object.entries({
    viewBox: '0 0 24 24', width: '16', height: '16', fill: 'none',
    stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round',
    'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'theme-toggle-icon',
  })) svg.setAttribute(key, value);
  // Lucide sun / moon (ISC licence), hand copied at 24x24, same approach as
  // the client-mode category icons: no icon font, no extra request.
  const shapes = isDark
    ? [['path', { d: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z' }]]
    : [
        ['circle', { cx: '12', cy: '12', r: '4' }],
        ['path', { d: 'M12 2v2' }], ['path', { d: 'M12 20v2' }],
        ['path', { d: 'M2 12h2' }], ['path', { d: 'M20 12h2' }],
        ['path', { d: 'm4.93 4.93 1.41 1.41' }], ['path', { d: 'm17.66 17.66 1.41 1.41' }],
        ['path', { d: 'm6.34 17.66-1.41 1.41' }], ['path', { d: 'm19.07 4.93-1.41 1.41' }],
      ];
  for (const [tag, attrs] of shapes) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    svg.append(node);
  }
  return svg;
}

const themeToggleListeners = new Set();

/** A dark/light toggle button. The label always names the state a click
    would switch TO (so a light page reads "Dark mode"), never the current
    state, kept consistent in both modes. */
export function themeToggleButton(extraClass = 'btn-ghost btn-sm') {
  const btn = el('button', { class: `btn ${extraClass} theme-toggle`, type: 'button' });
  const sync = () => {
    const isDark = currentTheme() === 'dark';
    btn.setAttribute('aria-pressed', String(isDark));
    btn.replaceChildren(themeIcon(isDark), el('span', {}, isDark ? 'Light mode' : 'Dark mode'));
  };
  btn.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    writeTheme(next);
    for (const listener of themeToggleListeners) listener();
  });
  themeToggleListeners.add(sync);
  sync();
  return btn;
}

// A reader who has never made an explicit choice follows the OS live, not
// just at load: readTheme() is null until the toggle is clicked once.
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
  if (readTheme()) return; // an explicit choice always wins over the OS
  applyTheme(event.matches ? 'dark' : 'light');
  for (const listener of themeToggleListeners) listener();
});

/** Parse ?t= into valid, deduplicated tool ids. Invalid entries are skipped
    silently (PRD section 5). Number.isInteger keeps id 0 — do not filter(Boolean). */
function parseSelection(raw, tools) {
  if (raw == null) return null; // no t param at all → curator mode
  const known = new Set(tools.map((t) => t.id));
  const ids = [];
  const seen = new Set();
  for (const part of raw.split(',')) {
    const id = Number.parseInt(part.trim(), 10);
    if (Number.isInteger(id) && known.has(id) && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids; // possibly empty → client mode renders an explicit empty state
}

async function boot() {
  const loading = document.getElementById('loading');
  let tools;
  try {
    const res = await fetch('data/tools.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    tools = await res.json();
  } catch (cause) {
    loading.textContent = 'Could not load the tool directory. If you opened this file directly, serve it over HTTP instead (file:// blocks fetch). Otherwise, try reloading.';
    loading.classList.add('is-error');
    console.error('tools.json fetch failed:', cause);
    return;
  }

  const params = new URLSearchParams(location.search);
  const selection = parseSelection(params.get('t'), tools);
  loading.remove();

  if (selection === null) {
    const { renderCurator } = await import('./curator.js');
    const root = document.getElementById('curator-root');
    root.hidden = false;
    renderCurator(root, tools);
  } else {
    // JS-added noindex only, per item 2: Google honours it, and a static tag
    // in the shared <head> would deindex curator mode too.
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex';
    document.head.appendChild(robots);

    // ?print=1 is added only by the curator's "Save as PDF" export button
    // (Batch E), never by Generate link / Share / Copy. A plain '1' check,
    // not a truthiness check on the param itself, since a present-but-empty
    // ?print= should not trigger a browser print dialogue unasked.
    const printMode = params.get('print') === '1';

    const { renderClient } = await import('./client.js');
    const root = document.getElementById('client-root');
    root.hidden = false;
    renderClient(root, tools, selection, sanitizeParam(params.get('client')), sanitizeParam(params.get('note'), 280), printMode);
  }
}

boot();
