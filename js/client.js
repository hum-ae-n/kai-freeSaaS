/**
 * client.js: client mode per PRD section 7. A read-only deliverable.
 * Owns the .cli- and .tool-card classes. DOM contract in data-loader.js.
 * Client name and note come from the URL: they are ALWAYS inserted via
 * textContent (el()), never innerHTML, since both are attacker controlled.
 */
import { el, favicon, extLink, getDomain, money, shareUrl, themeToggleButton } from './data-loader.js';

const MAX_STAGGER = 8; // entrance stagger caps at 8 cards, per item 6a
const PROGRESS_PREFIX = 'freestack:v1:progress:';

export function renderClient(root, tools, selection, clientName, noteText, printMode = false) {
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

  // Cost-growth section (Batch D) only earns its place when at least one
  // selected, non-archived tool actually carries pricing data. paid_from can
  // legitimately be 0 (genuinely free forever), so presence is tested with
  // Number.isInteger, never a truthiness check.
  const hasPricingData = checklistable.some((t) => Number.isInteger(t.paid_from));
  const progressKey = progressStorageKey(selection, clientName);
  const doneIds = loadProgress(progressKey, checklistable.map((t) => t.id));

  /* --- header ------------------------------------------------------------ */
  const header = el('header', { class: 'panel cli-header' },
    el('img', { class: 'logo', src: 'design-system/assets/kaipability-logo-lockup.png', alt: 'Kaipability' }),
    el('h1', {}, 'Your Free Software Stack'),
    clientName ? el('p', { class: 'prepared-for eyebrow' }, `Prepared for ${clientName}`) : null,
    el('p', { class: 'curated-by' }, 'Curated by Kaipability'),
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

  const toolbar = el('div', { class: 'cli-toolbar no-print' }, shareBtn, printBtn, themeToggleButton('btn-ghost btn-lg'));

  /* --- summary ----------------------------------------------------------- */
  const valueFigure = el('span', { class: 'num' }, money(0));
  const summary = el('section', { class: 'cli-summary', 'aria-label': 'Summary' },
    el('div', {},
      el('span', { class: 'num' }, String(picked.length)),
      el('span', { class: 'lbl' }, picked.length === 1 ? 'tool selected' : 'tools selected'),
    ),
    el('div', {},
      valueFigure,
      el('span', { class: 'lbl' }, 'what you would otherwise pay for software, at zero cost'),
    ),
    hasPricingData
      ? el('p', { class: 'cli-summary-note' }, 'Scroll down for how costs could grow as you scale.')
      : null,
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

  /* --- how costs could grow, after the categories, before the footer ----- */
  if (hasPricingData) sections.push(costGrowthSection(checklistable));

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

  // Save as PDF (Batch E): the curator's export button opens this same URL
  // with &print=1 added. Fires once, after a short settle so fonts and the
  // count-up/entrance layout are stable before the print dialogue opens.
  if (printMode) setTimeout(() => window.print(), 400);
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

    tool.free_limit
      ? el('p', { class: 'card-free-tier' },
          el('span', { class: 'card-free-tier-label' }, 'Free tier'),
          ' ',
          tool.free_limit,
        )
      : null,
    pricingPill(tool),

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

/** Pricing honesty pill (Feature 1). paid_from is only rendered when it is
    actually present: Number.isInteger, since 0 is a real "free forever"
    value and must not be treated as absent. One neutral style either way,
    the wording carries the meaning, never colour alone. */
function pricingPill(tool) {
  if (!Number.isInteger(tool.paid_from)) return null;
  const label = tool.paid_from === 0
    ? 'Free forever'
    : `Paid plans from ${money(tool.paid_from)}/month`;
  return el('p', { class: 'card-pricing' }, el('span', { class: 'badge badge-pricing' }, label));
}

/* --- how costs could grow (Feature 2) --------------------------------------
   An honest indicative model, not a forecast. Stage 1 assumes every free
   tier still holds (so it is always £0, regardless of what the per-tool
   formula would otherwise say for a flat-fee tool at team size 1). From
   stage 2 on, each tool contributes per scales_with:
     'users'    -> paid_from x team size (per seat)
     'usage' or 'features' -> paid_from flat, whatever the headcount
     'none', or paid_from 0, or no pricing data at all -> nothing
   Archived tools are excluded from the whole model by the caller, since the
   caller passes the already-archived-filtered checklistable list. */
const COST_STAGES = [
  { label: 'Just you', team: 1 },
  { label: 'Team of 5', team: 5 },
  { label: 'Team of 10', team: 10 },
  { label: 'Team of 25', team: 25 },
];

function toolStageCost(tool, stageIndex, team) {
  if (stageIndex === 0) return 0; // stage 1: every free tier assumed to hold
  if (!Number.isInteger(tool.paid_from) || tool.paid_from === 0) return 0;
  if (tool.scales_with === 'users') return tool.paid_from * team;
  if (tool.scales_with === 'usage' || tool.scales_with === 'features') return tool.paid_from;
  return 0; // 'none', or scales_with absent/unrecognised
}

/** Returns one entry per stage: { label, total, drivers, stillFree }.
    drivers is every costed tool at that stage, sorted highest first, so the
    tooltip can take the top 5 without a second pass. stillFree counts every
    modelled tool that contributes nothing at that stage, including tools
    with no pricing data at all: this feature never claims to know a cost
    it can't source, it only ever names the ones it can. */
function computeCostStages(tools) {
  return COST_STAGES.map((stage, i) => {
    const drivers = [];
    for (const tool of tools) {
      const cost = toolStageCost(tool, i, stage.team);
      if (cost > 0) drivers.push({ name: tool.name, cost });
    }
    drivers.sort((a, b) => b.cost - a.cost);
    const total = drivers.reduce((sum, d) => sum + d.cost, 0);
    return { label: stage.label, total, drivers, stillFree: tools.length - drivers.length };
  });
}

/** Smallest "nice" (1/2/5/10 x 10^n) number at or above value, so the y axis
    never truncates the baseline and never lands on an odd top figure. */
function niceCeil(value) {
  if (value <= 0) return 100;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  const fraction = value / base;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * base;
}

/** Path for a bar with square corners at the baseline and rounded corners
    only at the data end (the top), per the dataviz rule: never round the
    end that touches zero. */
function roundedTopBarPath(x, y, w, h, radius) {
  const r = Math.max(0, Math.min(radius, h, w / 2));
  if (r === 0) return `M${x},${y + h} L${x},${y} L${x + w},${y} L${x + w},${y + h} Z`;
  return `M${x},${y + h} L${x},${y + r} A${r},${r} 0 0 1 ${x + r},${y} `
    + `L${x + w - r},${y} A${r},${r} 0 0 1 ${x + w},${y + r} L${x + w},${y + h} Z`;
}

function svgText(x, y, cls, text) {
  const node = svgNode('text', { x, y, class: cls, 'text-anchor': 'middle' });
  node.textContent = text;
  return node;
}

/* Base geometry chosen so the chart reads at true size at a 375px viewport
   (client-root and chart-wrap padding leaves roughly 310-320px of width
   there): the viewBox is that same width, so at the narrowest supported
   screen the scale factor is close to 1. CSS then caps the rendered width
   on wider screens, so text only ever scales up from this base, never down
   past legible. */
const CHART_W = 320, CHART_H = 210;
const CHART_TOP = 28, CHART_BASELINE = 155, CHART_LABEL_Y = 178;
const CHART_COLS = COST_STAGES.length;
const CHART_COL_W = CHART_W / CHART_COLS;
const CHART_BAR_W = Math.min(48, CHART_COL_W - 16);
const CHART_BAR_AREA_H = CHART_BASELINE - CHART_TOP;

function buildCostChart(stages) {
  const yMax = niceCeil(Math.max(...stages.map((s) => s.total), 1));

  const svg = svgNode('svg', {
    viewBox: `0 0 ${CHART_W} ${CHART_H}`,
    class: 'cli-cost-chart',
    role: 'group',
    'aria-label': 'Indicative monthly cost by team size',
  });

  // At most 3 recessive gridlines, no axis box, no gridline value labels:
  // the bars already carry their own direct £ labels.
  for (const frac of [0.25, 0.5, 0.75]) {
    const y = CHART_BASELINE - frac * CHART_BAR_AREA_H;
    svg.append(svgNode('line', { x1: 0, x2: CHART_W, y1: y, y2: y, class: 'cli-cost-grid' }));
  }
  svg.append(svgNode('line', {
    x1: 0, x2: CHART_W, y1: CHART_BASELINE, y2: CHART_BASELINE, class: 'cli-cost-baseline',
  }));

  const bars = [];
  stages.forEach((stage, i) => {
    const colX = i * CHART_COL_W;
    const barX = colX + (CHART_COL_W - CHART_BAR_W) / 2;
    const barH = (stage.total / yMax) * CHART_BAR_AREA_H;
    const barY = CHART_BASELINE - barH;

    const g = svgNode('g', {
      class: 'cli-cost-bar',
      tabindex: '0',
      role: 'img',
      'aria-label': `${stage.label}: about ${money(stage.total)} per month`,
    });

    // Hit target spans the full column, full chart height: at least the
    // full bar column width, easily hoverable and keyboard-focusable.
    g.append(svgNode('rect', { x: colX, y: 0, width: CHART_COL_W, height: CHART_H, class: 'cli-cost-hit' }));

    if (barH > 0) {
      g.append(svgNode('path', {
        d: roundedTopBarPath(barX, barY, CHART_BAR_W, barH, 4),
        class: 'cli-cost-bar-fill',
      }));
    }

    g.append(svgText(colX + CHART_COL_W / 2, Math.max(12, barY - 8), 'cli-cost-bar-value', money(stage.total)));
    g.append(svgText(colX + CHART_COL_W / 2, CHART_LABEL_Y, 'cli-cost-bar-stage', stage.label));

    svg.append(g);
    bars.push({ g, hit: g.firstChild, stage });
  });

  return { svg, bars };
}

function buildTooltip() {
  return el('div', { class: 'cli-cost-tooltip no-print', role: 'status', hidden: true });
}

function renderTooltipContent(tooltip, stage) {
  const top5 = stage.drivers.slice(0, 5);
  const driversLine = top5.length
    ? top5.flatMap((d, i) => (i > 0 ? [', ', `${d.name} ${money(d.cost)}`] : [`${d.name} ${money(d.cost)}`]))
    : ['No tools cost extra yet'];
  const freeLine = stage.stillFree === 1 ? '1 tool still free' : `${stage.stillFree} tools still free`;
  tooltip.replaceChildren(
    el('p', { class: 'cli-cost-tooltip-drivers' }, driversLine),
    el('p', { class: 'cli-cost-tooltip-free' }, freeLine),
  );
}

function positionTooltip(tooltip, hitEl, wrap) {
  const wrapRect = wrap.getBoundingClientRect();
  const hitRect = hitEl.getBoundingClientRect();
  const tipWidth = tooltip.offsetWidth;
  const rawLeft = (hitRect.left - wrapRect.left) + hitRect.width / 2 - tipWidth / 2;
  const left = Math.max(4, Math.min(rawLeft, wrap.clientWidth - tipWidth - 4));
  const top = (hitRect.top - wrapRect.top) - tooltip.offsetHeight - 8;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${Math.max(0, top)}px`;
}

function wireCostChartInteractivity(bars, tooltip, wrap) {
  const show = (bar) => {
    renderTooltipContent(tooltip, bar.stage);
    tooltip.hidden = false;
    positionTooltip(tooltip, bar.hit, wrap);
  };
  const hide = () => { tooltip.hidden = true; };
  for (const bar of bars) {
    bar.g.addEventListener('mouseenter', () => show(bar));
    bar.g.addEventListener('mouseleave', hide);
    bar.g.addEventListener('focus', () => show(bar));
    bar.g.addEventListener('blur', hide);
  }
}

/** Accessible table fallback, per §12: a proper <table>, always in the DOM
    (not built lazily), collapsed under a <details> on screen and forced
    open in print (see the CLIENT/PRINT block in styles.css). */
function buildCostTable(stages) {
  const rows = stages.map((stage) => el('tr', {},
    el('td', {}, stage.label),
    el('td', {}, money(stage.total)),
    el('td', {}, String(stage.drivers.length)),
  ));
  return el('table', { class: 'cli-cost-table' },
    el('thead', {},
      el('tr', {},
        el('th', {}, 'Stage'),
        el('th', {}, 'Indicative £ per month'),
        el('th', {}, 'Tools no longer free'),
      ),
    ),
    el('tbody', {}, rows),
  );
}

/** Chromium's newer <details> implementation collapses its content with
    content-visibility internally, which a CSS display override cannot see
    past. Toggling the real open attribute around the print event is the
    only reliable way to guarantee the table fallback prints expanded while
    still defaulting to collapsed on screen. */
function wirePrintExpand(details) {
  let wasOpen = false;
  window.addEventListener('beforeprint', () => {
    wasOpen = details.open;
    details.open = true;
  });
  window.addEventListener('afterprint', () => {
    details.open = wasOpen;
  });
}

function costGrowthSection(tools) {
  const stages = computeCostStages(tools);
  const { svg, bars } = buildCostChart(stages);
  const tooltip = buildTooltip();
  const wrap = el('div', { class: 'cli-cost-chart-wrap' }, svg, tooltip);
  wireCostChartInteractivity(bars, tooltip, wrap);

  const details = el('details', { class: 'cli-cost-table-details' },
    el('summary', {}, 'View as a table'),
    buildCostTable(stages),
  );
  wirePrintExpand(details);

  return el('section', { class: 'cli-cost-growth', 'aria-labelledby': 'cli-cost-heading' },
    el('h2', { class: 'cli-cost-heading', id: 'cli-cost-heading' }, 'How costs could grow'),
    el('p', { class: 'cli-cost-caption' },
      'Indicative monthly cost if you outgrew every free tier at once. Most businesses never do; many of these free tiers hold for years.'),
    el('p', { class: 'cli-cost-caption-note' },
      'Per-user tools are costed at their per-seat price times your team size. Tools that gate on usage or features are costed at their flat starting price, whatever your headcount.'),
    wrap,
    details,
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
