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
    const { renderClient } = await import('./client.js');
    const root = document.getElementById('client-root');
    root.hidden = false;
    renderClient(root, tools, selection, params.get('client') || '');
  }
}

boot();
