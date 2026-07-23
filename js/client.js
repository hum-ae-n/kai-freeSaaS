/**
 * client.js — client mode per PRD section 7. A read-only deliverable.
 * Owns the .cli- and .tool-card classes. DOM contract in data-loader.js.
 * Client name and note come from the URL: they are ALWAYS inserted via
 * textContent (el()), never innerHTML, since both are attacker controlled.
 */
import { el, favicon, extLink, getDomain, money, shareUrl } from './data-loader.js';

const MAX_STAGGER = 8; // entrance stagger caps at 8 cards, per item 6a
const PROGRESS_PREFIX = 'freestack:v1:progress:';

export function renderClient(root, tools, selection, clientName, noteText) {
  const byId = new Map(tools.map((t) => [t.id, t]));
  const picked = selection.map((id) => byId.get(id)).filter((t) => t !== undefined);

  if (!picked.length) {
    root.replaceChildren(
      el('div', { class: 'app-message' },
        'This link contains no tools. Ask whoever sent it for a fresh one, or ',
        el('a', { href: location.pathname }, 'open the full directory'),
        '.',
      ),
    );
    return;
  }

  // Archived tools carry no value claim (§4, item 12c): the card points at
  // alternatives instead of standing behind a figure for a retired product.
  const totalValue = picked.reduce((sum, t) => sum + (t.archived ? 0 : t.value), 0);
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  // Archived tools get no adoption toggle and are excluded from the total.
  const checklistable = picked.filter((t) => !t.archived);
  const progressKey = progressStorageKey(selection, clientName);
  const doneIds = loadProgress(progressKey, checklistable.map((t) => t.id));

  /* --- header ------------------------------------------------------------ */
  const header = el('header', { class: 'panel cli-header' },
    el('img', { class: 'logo', src: 'design-system/assets/kaipability-logo-lockup.png', alt: 'Kaipability' }),
    el('h1', {}, 'Your Free Software Stack'),
    clientName ? el('p', { class: 'prepared-for eyebrow' }, `Prepared for ${clientName}`) : null,
    el('p', { class: 'curated-by' },
      clientName ? `Curated for ${clientName} by Kaipability` : 'Curated by Kaipability'),
    el('p', { class: 'cli-date' }, today),
    el('p', { class: 'cli-context' },
      'Free tools selected for your business. Every tool includes alternatives and training resources to get started.'),
    noteText ? el('div', { class: 'cli-note' },
      el('p', { class: 'cli-note-label eyebrow' }, 'A note from Kaipability'),
      el('p', { class: 'cli-note-text' }, noteText),
    ) : null,
  );

  /* --- share + print, screen-only chrome ---------------------------------- */
  const shareBtn = el('button', { class: 'btn btn-ghost btn-lg', type: 'button' }, 'Share this page');
  shareBtn.addEventListener('click', () => shareUrl(location.href, 'Your free software stack from Kaipability'));

  const printBtn = el('button', { class: 'btn btn-secondary btn-lg', type: 'button' }, 'Print or save as PDF');
  printBtn.addEventListener('click', () => window.print());

  const toolbar = el('div', { class: 'cli-toolbar no-print' }, shareBtn, printBtn);

  /* --- summary ----------------------------------------------------------- */
  const valueFigure = el('span', { class: 'num' }, money(0));
  const summary = el('section', { class: 'cli-summary', 'aria-label': 'Summary' },
    el('div', {},
      el('span', { class: 'num' }, String(picked.length)),
      el('span', { class: 'lbl' }, picked.length === 1 ? 'tool selected' : 'tools selected'),
    ),
    el('div', {},
      valueFigure,
      el('span', { class: 'lbl' }, `replaces roughly ${money(totalValue)}/yr of software, at zero cost`),
    ),
  );

  /* --- adoption checklist progress line ----------------------------------- */
  const progressCount = el('span', {}, progressText(doneIds.size, checklistable.length));
  const progress = el('div', { class: 'cli-progress no-print' },
    el('p', { 'aria-live': 'polite' }, progressCount),
    el('p', { class: 'cli-progress-note' }, 'Progress is saved on this device only.'),
  );

  function handleToggle(tool, article, btn) {
    if (doneIds.has(tool.id)) doneIds.delete(tool.id); else doneIds.add(tool.id);
    const done = doneIds.has(tool.id);
    article.classList.toggle('is-done', done);
    btn.setAttribute('aria-pressed', String(done));
    btn.textContent = done ? '✓ Set up' : 'Mark as set up';
    progressCount.textContent = progressText(doneIds.size, checklistable.length);
    saveProgress(progressKey, doneIds);
  }

  /* --- cards grouped by category (data order preserved) ------------------ */
  const groups = new Map();
  for (const tool of picked) {
    if (!groups.has(tool.category)) groups.set(tool.category, []);
    groups.get(tool.category).push(tool);
  }

  let cardIndex = 0;
  const sections = [];
  for (const [category, groupTools] of groups) {
    sections.push(el('h2', { class: 'cli-category' }, categoryIcon(category), category));
    const items = groupTools.map((tool) => el('li', {}, card(tool, cardIndex++, doneIds, handleToggle)));
    if (items.length === 1) items[0].classList.add('card-solo');
    sections.push(el('ul', { class: 'card-grid' }, items));
  }

  /* --- footer ------------------------------------------------------------ */
  const footer = el('footer', { class: 'cli-footer' },
    el('img', { class: 'logo', src: 'design-system/assets/kaipability-logo-lockup.png', alt: '' }),
    el('span', {},
      'Curated by ',
      el('a', { href: 'https://kaipability.com', target: '_blank', rel: 'noopener noreferrer' }, 'Kaipability Ltd'),
      '. No affiliate links, no sponsored placements.',
    ),
  );

  root.replaceChildren(header, toolbar, summary, progress, ...sections, footer);
  document.title = clientName ? `Free Software Stack · ${clientName}` : 'Your Free Software Stack';

  countUp(valueFigure, totalValue, (n) => `~${money(n)}/yr`);
}

/** rAF count-up on the summary value, triggered once on scroll into view.
    Instant when the reader has asked for reduced motion, since CSS media
    queries don't govern requestAnimationFrame. */
function countUp(target, endValue, format) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) { target.textContent = format(endValue); return; }

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      const duration = 700;
      const start = performance.now();
      const step = (now) => {
        const t = Math.min((now - start) / duration, 1);
        const eased = 1 - (1 - t) ** 3;
        target.textContent = format(Math.round(endValue * eased));
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  }, { threshold: 0.5 });
  observer.observe(target);
}

function formatVerified(dateStr) {
  if (!dateStr) return null;
  const parsed = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function card(tool, i, doneIds, onToggle) {
  const style = `--i: ${Math.min(i, MAX_STAGGER)}`;
  if (tool.archived) return archivedCard(tool, style);

  const verified = formatVerified(tool.last_verified);
  const done = doneIds.has(tool.id);

  const toggleBtn = el('button', {
    class: 'card-toggle no-print', type: 'button', 'aria-pressed': String(done),
  }, done ? '✓ Set up' : 'Mark as set up');

  const article = el('article', { class: `panel tool-card${done ? ' is-done' : ''}`, style },
    el('div', { class: 'card-top' },
      el('h3', {}, favicon(tool.urls[0]?.domain), tool.name),
      el('span', { class: 'card-value' }, `~${money(tool.value)}/yr`),
    ),
    el('div', { class: 'card-domains' },
      tool.urls.map((u) => el('a', {
        href: `https://${u.domain}`, target: '_blank', rel: 'noopener noreferrer',
      }, u.label)),
    ),
    el('p', { class: 'card-desc' }, tool.description),

    el('p', { class: 'card-section-label' }, 'Alternatives'),
    el('div', { class: 'card-links' },
      tool.alternatives.map((a) => extLink(a.url, a.name, true)),
    ),

    el('p', { class: 'card-section-label' }, 'Get started'),
    el('div', { class: 'card-links' },
      tool.training.map((t) => extLink(t.url, t.name, true)),
    ),

    tool.notes?.length
      ? el('div', { class: 'card-notes' }, tool.notes.map((n) => el('p', {}, n)))
      : null,

    verified ? el('p', { class: 'card-verified' }, `Verified ${verified}`) : null,

    toggleBtn,
  );

  toggleBtn.addEventListener('click', () => onToggle(tool, article, toggleBtn));

  return article;
}

/** Archived tools never silently disappear (§4 ID permanence). An old link
    still resolves, but the card is compact and points only at alternatives:
    no training block, no value claim for a product no longer recommended. */
function archivedCard(tool, style) {
  return el('article', { class: 'panel tool-card tool-card-archived', style },
    el('div', { class: 'card-top' },
      el('h3', {}, tool.name),
    ),
    el('p', { class: 'card-archived-note' }, 'No longer recommended. Consider the alternatives below.'),
    el('p', { class: 'card-section-label' }, 'Alternatives'),
    el('div', { class: 'card-links' },
      tool.alternatives.map((a) => extLink(a.url, a.name, true)),
    ),
  );
}

/* --- adoption checklist persistence ---------------------------------------
   Progress is per device, per link: the storage key is a stable string built
   from the sorted id list plus the client name, not a hash function, so the
   same t= selection always resolves to the same key and different t= links
   never share one. Every access is wrapped so a throwing localStorage
   (private browsing, some webviews) degrades to "nothing persists" rather
   than a broken page. */
function progressText(done, total) {
  return `${done} of ${total} set up`;
}

function progressStorageKey(selection, clientName) {
  const ids = [...selection].sort((a, b) => a - b).join(',');
  return `${PROGRESS_PREFIX}${ids}|${clientName}`;
}

function readStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable: no-op */ }
}

/** Returns a Set of done ids, filtered to ids that are actually on this
    link's checklist. Any malformed stored value is treated as no progress
    rather than thrown, per the "start fresh" rule for bad JSON. */
function loadProgress(key, validIds) {
  const known = new Set(validIds);
  const done = new Set();
  const raw = readStorage(key);
  if (!raw) return done;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.v === 1 && Array.isArray(parsed.done)) {
      for (const id of parsed.done) {
        if (Number.isInteger(id) && known.has(id)) done.add(id);
      }
    }
  } catch { /* malformed JSON: start fresh */ }
  return done;
}

function saveProgress(key, doneIds) {
  const payload = JSON.stringify({ v: 1, done: [...doneIds], updated: new Date().toISOString() });
  writeStorage(key, payload);
}

/* --- category icons --------------------------------------------------------
   Lucide icon set (https://lucide.dev), ISC licence, no attribution required.
   Paths hand copied at 24x24 and rendered at 18px with the app's own stroke
   width, so no npm dependency is added for a handful of glyphs. */
const SVG_NS = 'http://www.w3.org/2000/svg';

function svgNode(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

const CATEGORY_ICONS = {
  'AI Assistants': [
    ['path', { d: 'M12 8V4H8' }],
    ['rect', { width: '16', height: '12', x: '4', y: '8', rx: '2' }],
    ['path', { d: 'M2 14h2' }],
    ['path', { d: 'M20 14h2' }],
    ['path', { d: 'M15 13v2' }],
    ['path', { d: 'M9 13v2' }],
  ],
  'Business Operations': [
    ['path', { d: 'M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16' }],
    ['rect', { width: '20', height: '14', x: '2', y: '6', rx: '2' }],
  ],
  'Cloud & Docs': [
    ['path', { d: 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z' }],
  ],
  Communication: [
    ['path', { d: 'M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719' }],
  ],
  'Design & Images': [
    ['path', { d: 'M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z' }],
    ['circle', { cx: '13.5', cy: '6.5', r: '.5', fill: 'currentColor' }],
    ['circle', { cx: '17.5', cy: '10.5', r: '.5', fill: 'currentColor' }],
    ['circle', { cx: '6.5', cy: '12.5', r: '.5', fill: 'currentColor' }],
    ['circle', { cx: '8.5', cy: '7.5', r: '.5', fill: 'currentColor' }],
  ],
  'E-commerce': [
    ['circle', { cx: '8', cy: '21', r: '1' }],
    ['circle', { cx: '19', cy: '21', r: '1' }],
    ['path', { d: 'M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12' }],
  ],
  Finance: [
    ['path', { d: 'M13.744 17.736a6 6 0 1 1-7.48-7.48' }],
    ['path', { d: 'M15 6h1v4' }],
    ['path', { d: 'm6.134 14.768.866-.5 2 3.464' }],
    ['circle', { cx: '16', cy: '8', r: '6' }],
  ],
  'Grants & Business Support': [
    ['path', { d: 'M10 18v-7' }],
    ['path', { d: 'M11.119 2.205a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949z' }],
    ['path', { d: 'M14 18v-7' }],
    ['path', { d: 'M18 18v-7' }],
    ['path', { d: 'M3 22h18' }],
    ['path', { d: 'M6 18v-7' }],
  ],
  Learning: [
    ['path', { d: 'M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z' }],
    ['path', { d: 'M22 10v6' }],
    ['path', { d: 'M6 12.5V16a6 3 0 0 0 12 0v-3.5' }],
  ],
  'Market Research': [
    ['rect', { width: '8', height: '4', x: '8', y: '2', rx: '1', ry: '1' }],
    ['path', { d: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2' }],
    ['path', { d: 'M12 11h4' }],
    ['path', { d: 'M12 16h4' }],
    ['path', { d: 'M8 11h.01' }],
    ['path', { d: 'M8 16h.01' }],
  ],
  'Marketing & CRM': [
    ['path', { d: 'M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z' }],
    ['path', { d: 'M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14' }],
    ['path', { d: 'M8 6v8' }],
  ],
  'SEO & Analytics': [
    ['path', { d: 'M5 21v-6' }],
    ['path', { d: 'M12 21V3' }],
    ['path', { d: 'M19 21V9' }],
  ],
  'Sector Specific': [
    ['path', { d: 'M10 12h4' }],
    ['path', { d: 'M10 8h4' }],
    ['path', { d: 'M14 21v-3a2 2 0 0 0-4 0v3' }],
    ['path', { d: 'M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2' }],
    ['path', { d: 'M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16' }],
  ],
  'Security & Compliance': [
    ['path', { d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z' }],
    ['path', { d: 'm9 12 2 2 4-4' }],
  ],
  'Video & Audio': [
    ['path', { d: 'm16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5' }],
    ['rect', { x: '2', y: '6', width: '14', height: '12', rx: '2' }],
  ],
};

// Fallback for a category not in the map above: a plain tag glyph.
const DEFAULT_ICON = [
  ['path', { d: 'M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z' }],
  ['circle', { cx: '7.5', cy: '7.5', r: '.5', fill: 'currentColor' }],
];

function categoryIcon(category) {
  const shapes = CATEGORY_ICONS[category] ?? DEFAULT_ICON;
  const svg = svgNode('svg', {
    viewBox: '0 0 24 24', width: '18', height: '18', fill: 'none',
    stroke: 'currentColor', 'stroke-width': '1.75',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    'aria-hidden': 'true', class: 'cli-category-icon',
  });
  for (const [tag, attrs] of shapes) svg.append(svgNode(tag, attrs));
  return svg;
}
