/**
 * client.js: client mode per PRD section 7. A read-only deliverable.
 * Owns the .cli- and .tool-card classes. DOM contract in data-loader.js.
 * Client name and note come from the URL: they are ALWAYS inserted via
 * textContent (el()), never innerHTML, since both are attacker controlled.
 */
import { el, favicon, extLink, getDomain, money, shareUrl, themeToggleButton, writePlainMode, isStaffDevice } from './data-loader.js';
import { qrSvg } from './qr.js';

const MAX_STAGGER = 8; // entrance stagger caps at 8 cards, per item 6a
const PROGRESS_PREFIX = 'freestack:v1:progress:';

/** Plain English mode (Batch H, Feature 1): normal/plain string pairs for
    every label this feature swaps, kept in one place rather than scattered
    conditionals through the render functions below. */
const LABELS = {
  alternatives: ['Alternatives', 'Other options like this'],
  getStarted: ['Get started', 'Learn how, free'],
  buildYourOwn: ['Or build your own', 'Or have a simple one made just for you'],
  freeTier: ['Free tier', 'What you get free'],
  costHeading: ['How costs could grow', "How 'free' can turn into paying"],
};
function pickLabel(key, plainMode) {
  return LABELS[key][plainMode ? 1 : 0];
}

/** singleMode (Feature 3): a ?tool= permalink. Selection is at most one id
    by construction (data-loader's parseSingleTool), and renders through the
    same "no tools" empty state below when that id was absent or invalid, so
    an unrecognised id degrades exactly like an empty ?t= link rather than
    a bespoke error page. */
export function renderClient(root, tools, selection, clientName, noteText, printMode = false, singleMode = false, plainMode = false) {
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

  if (singleMode) {
    renderSingleTool(root, picked[0], printMode, plainMode);
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
  // Reassigned on every draw() (Feature 1): progress lives in storage, not
  // just in memory, so a plain-mode re-render re-reads it rather than
  // trusting a stale reference from the first render.
  let doneIds = loadProgress(progressKey, checklistable.map((t) => t.id));

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

  // Open in curator (Feature 2, gated per Batch I's public/staff split):
  // reopens this exact stack, pre-ticked, so a consultant can adjust and
  // re-share rather than rebuilding it by hand. Renders only on a device
  // that has visited /x before (isStaffDevice()): a client who only ever
  // opens a shared stack link must never see, or be tempted to click, a
  // path back into the hidden staff page. Only the params that actually
  // exist are added, values already sanitised by data-loader before
  // reaching this function.
  const editBtn = isStaffDevice() ? el('a', {
    class: 'btn btn-ghost btn-lg no-print', href: buildEditUrl(selection, clientName, noteText),
  }, 'Open in curator') : null;

  // "Set up your workspace" / "Open your workspace" (Phase 11 Wave B,
  // PRD-REGISTER section 2): the client-page entry point into the /my
  // account register. hasWorkspace() below is a read-only existence probe
  // only, so it does not need store.js's mutation discipline (PRD-REGISTER
  // section 6 names load/save/exportBlob/importBlob/lock/unlock/status as
  // the whole interface, on purpose, with no seventh method for a boolean);
  // importing store.js here would also pull its WebCrypto and IndexedDB
  // machinery into client mode for a single yes/no check. This mirrors
  // store.js's own localStorage mirror key by name only, never its shape,
  // and never writes to it.
  const workspaceBtn = el('a', {
    class: 'btn btn-ghost btn-lg no-print', href: workspaceHref(selection),
  }, hasWorkspace() ? 'Open your workspace' : 'Set up your workspace');

  // Plain English toggle (Batch H, Feature 1): flips the local plainMode
  // binding, persists the choice, and redraws the plain-mode-dependent
  // parts of the page in place. Text stays constant; aria-pressed plus the
  // toggled state carry the meaning, same convention as the theme toggle.
  const plainBtn = el('button', {
    class: 'btn btn-ghost btn-lg plain-toggle no-print', type: 'button', 'aria-pressed': String(plainMode),
  }, 'Plain English');
  plainBtn.addEventListener('click', () => {
    plainMode = !plainMode;
    writePlainMode(plainMode);
    plainBtn.setAttribute('aria-pressed', String(plainMode));
    draw();
  });

  const toolbar = el('div', { class: 'cli-toolbar no-print' },
    shareBtn, printBtn, editBtn, workspaceBtn, plainBtn, themeToggleButton('btn-ghost btn-lg'));

  // Awareness page link (Phase 11 Wave D, PRD-REGISTER section 12: "linked
  // from ... the client page near the workspace CTA"). A quiet text line,
  // not a button, so it reads as a footnote to workspaceBtn rather than
  // competing with it for attention.
  const workspaceAwarenessNote = el('p', { class: 't-meta my-awareness-link-line no-print' },
    'Curious why the workspace exists? ',
    el('a', { href: '/why-register.html' }, 'Why we built this'),
    '. ',
    el('a', { href: '/privacy.html' }, 'Privacy'), ' · ',
    el('a', { href: '/contact.html' }, 'Contact'), '.');

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

  /* --- adoption checklist progress line, plus share-back (Feature 2) ----- */
  const progressCount = el('span', {}, progressText(doneIds.size, checklistable.length));
  // Only rendered when there is a checklist to report on: a picked set
  // that is entirely archived tools has nothing to set up or share.
  const shareProgressBtn = checklistable.length
    ? el('button', { class: 'btn btn-ghost btn-lg no-print', type: 'button' }, 'Share progress with Kaipability')
    : null;
  if (shareProgressBtn) {
    shareProgressBtn.addEventListener('click', () => {
      // Reads doneIds at click time, per the feature spec: whatever is
      // ticked right now, not a snapshot from first render.
      location.href = buildShareProgressMailto(checklistable, doneIds, location.href);
    });
  }
  const progress = el('div', { class: 'cli-progress no-print' },
    el('p', { 'aria-live': 'polite' }, progressCount),
    el('p', { class: 'cli-progress-note' }, 'Progress is saved on this device only.'),
    shareProgressBtn,
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

  /* --- footer ------------------------------------------------------------ */
  const footer = el('footer', { class: 'cli-footer' },
    el('img', { class: 'logo', src: 'design-system/assets/kaipability-logo-lockup.png', alt: '' }),
    el('span', {},
      'Curated by ',
      el('a', { href: 'https://kaipability.com', target: '_blank', rel: 'noopener noreferrer' }, 'Kaipability Ltd'),
      '. No affiliate links, no sponsored placements.',
    ),
  );

  /* --- draw: everything that depends on plainMode, rebuilt on toggle -----
     Cards, the cost-growth section and the printed QR's target URL all
     change with plainMode; header/toolbar/summary/progress/footer do not,
     so they are built once above and simply re-attached here. */
  function draw() {
    doneIds = loadProgress(progressKey, checklistable.map((t) => t.id));
    progressCount.textContent = progressText(doneIds.size, checklistable.length);

    const sections = buildCardSections(picked, { plainMode, doneIds, onToggle: handleToggle });
    if (hasPricingData) sections.push(costGrowthSection(checklistable, plainMode));

    const printBlock = buildPrintQrBlock(selection, clientName, noteText, plainMode);

    root.replaceChildren(header, toolbar, workspaceAwarenessNote, summary, progress, ...sections, footer, ...(printBlock ? [printBlock] : []));
  }

  draw();
  document.title = clientName ? `Free Software Stack · ${clientName}` : 'Your Free Software Stack';

  countUp(valueFigure, totalValue, (n) => `~${money(n)}/yr`);

  // Save as PDF (Batch E): the curator's export button opens this same URL
  // with &print=1 added. Fires once, after a short settle so fonts and the
  // count-up/entrance layout are stable before the print dialogue opens.
  if (printMode) setTimeout(() => window.print(), 400);
}

/** Minimal chrome for a single-tool permalink (Feature 3): logo, tool name
    as the heading, the standard full-width card, the standard footer.
    Deliberately no summary bar, no prepared-for/date/context, no cost
    section and no checklist toggle: there is nothing to track for a single
    reference link, and client/note are never shown here even if present on
    the URL, since the caller already omits them from this call. Print and
    share stay available, and the caller has already injected noindex, same
    as any other client-mode view. */
function renderSingleTool(root, tool, printMode, plainMode = false) {
  const header = el('header', { class: 'panel cli-header cli-header-single' },
    el('img', { class: 'logo', src: 'design-system/assets/kaipability-logo-lockup.png', alt: 'Kaipability' }),
    el('h1', {}, tool.name),
  );

  const shareBtn = el('button', { class: 'btn btn-ghost btn-lg', type: 'button' }, 'Share this page');
  shareBtn.addEventListener('click', () => shareUrl(location.href, `${tool.name}, a free tool from Kaipability`));
  const printBtn = el('button', { class: 'btn btn-secondary btn-lg', type: 'button' }, 'Print or save as PDF');
  printBtn.addEventListener('click', () => window.print());
  const toolbar = el('div', { class: 'cli-toolbar no-print' }, shareBtn, printBtn, themeToggleButton('btn-ghost btn-lg'));

  // No progress to persist for a permalink (no adoption checklist), so the
  // card is built with an empty doneIds set and its toggle suppressed
  // entirely rather than wired to a no-op handler.
  const cardEl = card(tool, 0, new Set(), null, { showToggle: false, plainMode });
  const list = el('ul', { class: 'card-grid' }, el('li', { class: 'card-solo' }, cardEl));

  // Per-tool Q&A (PRD section 18 per-tool surfacing, wave 14.3b): hidden
  // until loadToolFaq's fetch resolves, same tolerance-for-absence pattern
  // as js/public.js's homepage FAQ slot and changelog strip.
  const faqSection = el('section', { class: 'cli-tool-faq', hidden: true });

  const footer = el('footer', { class: 'cli-footer' },
    el('img', { class: 'logo', src: 'design-system/assets/kaipability-logo-lockup.png', alt: '' }),
    el('span', {},
      'Curated by ',
      el('a', { href: 'https://kaipability.com', target: '_blank', rel: 'noopener noreferrer' }, 'Kaipability Ltd'),
      '. No affiliate links, no sponsored placements.',
    ),
  );

  root.replaceChildren(header, toolbar, list, faqSection, footer);
  document.title = `${tool.name} · Free Stack`;
  loadToolFaq(faqSection, tool.id);

  if (printMode) setTimeout(() => window.print(), 400);
}

/** ?tool= permalink Q&A (PRD section 18: "rendered visibly to humans in the
    same words" as the static crawler block). Fetched from data/faq.json,
    generated by scripts/build-seo.mjs from the same deriveQuestion/
    deriveAnswer pair that feeds that static block, so this is never a
    second, independent derivation: one source of truth, fetched here rather
    than recomputed. Non-blocking and silently tolerant of absence, matching
    every other data/*.json fetch on this site (loadChangelog,
    loadPersonaPacks, loadFaqSection in js/public.js): a missing or broken
    file, or a tool with no matching entry, simply leaves the section
    hidden. String(toolId) keys the lookup, never a truthiness test on the
    id itself, so tool 0 ("0" is a real key, PRD section 4's id law)
    resolves exactly like every other id. */
async function loadToolFaq(section, toolId) {
  let data;
  try {
    const res = await fetch('data/faq.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (cause) {
    console.warn('Tool FAQ unavailable, continuing without it:', cause);
    return;
  }
  const entry = data?.tools?.[String(toolId)];
  if (!entry || typeof entry.q !== 'string' || typeof entry.a !== 'string') return;
  section.hidden = false;
  section.replaceChildren(el('h2', {}, entry.q), el('p', {}, entry.a));
}

/** Category-grouped card sections (an h2 plus a ul.card-grid per category,
    data order preserved), shared by the full client render above, the
    public directory (Feature 1, Batch I) and embed mode (Feature 2, Batch
    I): the grouping and single-card-spans-full-row treatment live in one
    place rather than three. onToggle/doneIds only matter when showToggle is
    true; callers that suppress the toggle (public, embed) can omit both. */
export function buildCardSections(pickedTools, opts = {}) {
  const { plainMode = false, showToggle = true, doneIds = new Set(), onToggle = null } = opts;
  const groups = new Map();
  for (const tool of pickedTools) {
    if (!groups.has(tool.category)) groups.set(tool.category, []);
    groups.get(tool.category).push(tool);
  }
  let cardIndex = 0;
  const sections = [];
  for (const [category, groupTools] of groups) {
    sections.push(el('h2', { class: 'cli-category' }, categoryIcon(category), category));
    // data-id: added for judgement parity, wave 12.3 fix round. public.js
    // pairs a rendered <li> with its tool by this attribute alone (never by
    // replaying this function's own grouping order); String(tool.id) keeps
    // the id-string discipline id 0 depends on elsewhere in the app.
    const items = groupTools.map((tool) => el('li', { dataset: { id: String(tool.id) } }, card(tool, cardIndex++, doneIds, onToggle, { showToggle, plainMode })));
    if (items.length === 1) items[0].classList.add('card-solo');
    sections.push(el('ul', { class: 'card-grid' }, items));
  }
  return sections;
}

/** Embed mode (Feature 2, Batch I): bare category headings and cards (or,
    for a ?tool= permalink, one bare card with no heading, matching
    renderSingleTool's chrome-free treatment above) and nothing else. No
    checklist toggle: an embedded snippet has no per-device progress to
    track. embed.html's thin entry is the only caller. */
export function renderEmbed(root, tools, selection, singleMode, plainMode = false) {
  const byId = new Map(tools.map((t) => [t.id, t]));
  const picked = selection.map((id) => byId.get(id)).filter((t) => t !== undefined);

  if (!picked.length) {
    root.replaceChildren(el('div', { class: 'app-message' }, 'This link contains no tools.'));
    return;
  }

  const sections = singleMode
    ? [el('ul', { class: 'card-grid' }, el('li', { class: 'card-solo' }, card(picked[0], 0, new Set(), null, { showToggle: false, plainMode })))]
    : buildCardSections(picked, { plainMode, showToggle: false });

  root.replaceChildren(...sections);
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

/** Builds the "Open in curator" URL (Feature 2). Reuses the already
    sanitised clientName/noteText this module received rather than reading
    location.search again, so the values sent stay identical to whatever is
    already showing on the page. Commas kept readable in the id list, same
    convention as the curator's own buildUrl. Points at /x (Batch I): the
    button that generates this link only ever renders for a staff device in
    the first place, so sending it anywhere else would be pointless. */
function buildEditUrl(selection, clientName, noteText) {
  const params = new URLSearchParams();
  params.set('edit', selection.join(','));
  if (clientName) params.set('client', clientName);
  if (noteText) params.set('note', noteText);
  return `${location.origin}/x?${params.toString().replace(/%2C/g, ',')}`;
}

/** Workspace CTA link (Phase 11 Wave B, PRD-REGISTER section 2). A
    workspace that already exists on this device just gets reopened; one
    that does not yet gets the current stack's ids so /my's setup can offer
    "Start from your stack" (id 0 included, same list this whole page was
    built from, so the id-0 trap is exactly as safe here as everywhere
    else). */
function workspaceHref(selection) {
  return hasWorkspace() ? '/my' : `/my?from=${selection.join(',')}`;
}
function hasWorkspace() {
  try { return localStorage.getItem('freestack:v1:my') !== null; } catch { return false; }
}

/** Canonical share URL for this exact stack (Batch H, Feature 3: the print
    QR points at this, never at the current location.href, so print=1 never
    leaks into a scanned link even when this render came from the "Save as
    PDF" flow). plain=1 is included only when the reader currently has Plain
    English on, since that is a deliberate register choice worth carrying
    into whatever they scan next. */
function buildCanonicalShareUrl(selection, clientName, noteText, plainMode) {
  const params = new URLSearchParams();
  params.set('t', selection.join(','));
  if (clientName) params.set('client', clientName);
  if (noteText) params.set('note', noteText);
  if (plainMode) params.set('plain', '1');
  return `${location.origin}${location.pathname}?${params.toString().replace(/%2C/g, ',')}`;
}

/** mailto: draft for the "Share progress with Kaipability" button (Batch H,
    Feature 2). Fixed recipient, per Rocky's mid-build correction: no "who
    to send this to" line is needed once the To: field is already filled
    in. The 1800 budget is checked against the FINAL mailto: URI, not the
    raw body: encodeURIComponent triples the size of every space, colon,
    slash and newline, and the encoded subject and recipient count too, so
    measuring the raw string before encoding let a full-catalogue selection
    sail hundreds of characters past the 1900 spec ceiling even after
    truncation. Drops one tool line at a time and rebuilds the whole URI
    until it fits, or until only the "...and N more" line is left. */
function buildShareProgressMailto(checklistable, doneIds, pageUrl) {
  const subject = 'Progress on my free software stack';
  const buildUri = (list, omitted) => {
    const lines = [];
    for (const t of list) lines.push(`${doneIds.has(t.id) ? 'Set up' : 'Not yet'}: ${t.name}`);
    if (omitted > 0) lines.push(`...and ${omitted} more`);
    lines.push('', pageUrl);
    const body = lines.join('\n');
    return `mailto:info@kaipability.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };
  let list = checklistable;
  let omitted = 0;
  let uri = buildUri(list, omitted);
  while (uri.length > 1800 && list.length > 0) {
    list = list.slice(0, -1);
    omitted = checklistable.length - list.length;
    uri = buildUri(list, omitted);
  }
  return uri;
}

/** Print-only QR bridge (Batch H, Feature 3): a self generated SVG QR code
    of the canonical share URL, wired up so a printed or PDF'd page still
    carries a live link back to this stack. Encoding can throw for an
    unusually long selection plus a long name and note (qr.js supports
    versions 1-10, roughly 270 characters at its most tolerant level): the
    block is simply omitted rather than breaking the rest of the page. */
function buildPrintQrBlock(selection, clientName, noteText, plainMode) {
  const url = buildCanonicalShareUrl(selection, clientName, noteText, plainMode);
  let svg;
  try {
    svg = qrSvg(url, { size: 120, quietZone: 4, className: 'cli-print-qr-svg' });
  } catch (err) {
    // Expected for very large selections: the URL outgrows QR version 10.
    // The page simply prints without a QR, so this is a warn, not an error.
    console.warn('QR omitted from the print block:', err.message);
    return null;
  }
  return el('div', { class: 'print-only cli-print-qr' },
    el('p', { class: 'cli-print-qr-label' }, 'Scan to open this stack live'),
    svg,
  );
}

function formatVerified(dateStr) {
  if (!dateStr) return null;
  const parsed = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

/** Exported (Batch I) so public.js and embed mode can render the same card
    markup without duplicating it; both pass showToggle: false. */
export function card(tool, i, doneIds, onToggle, opts = {}) {
  const { showToggle = true, plainMode = false } = opts;
  const style = `--i: ${Math.min(i, MAX_STAGGER)}`;
  if (tool.archived) return archivedCard(tool, style, plainMode);

  const verified = formatVerified(tool.last_verified);
  const done = doneIds.has(tool.id);
  // Falls back to the normal description whenever a tool has no `plain`
  // entry yet, even with the toggle on: never render a blank card.
  const descriptionText = plainMode && tool.plain ? tool.plain : tool.description;
  const valueText = plainMode ? `worth about ${money(tool.value)} a year` : `~${money(tool.value)}/yr`;

  const toggleBtn = showToggle ? el('button', {
    class: 'card-toggle no-print', type: 'button', 'aria-pressed': String(done),
  }, done ? '✓ Set up' : 'Mark as set up') : null;

  const article = el('article', { class: `panel tool-card${done ? ' is-done' : ''}`, style },
    el('div', { class: 'card-top' },
      el('h3', {}, favicon(tool.urls[0]?.domain), tool.name),
      el('span', { class: 'card-value' }, valueText),
    ),
    el('div', { class: 'card-domains' },
      tool.urls.map((u) => el('a', {
        href: `https://${u.domain}`, target: '_blank', rel: 'noopener noreferrer',
      }, u.label)),
    ),
    el('p', { class: 'card-desc' }, descriptionText),

    tool.free_limit
      ? el('p', { class: 'card-free-tier' },
          el('span', { class: 'card-free-tier-label' }, pickLabel('freeTier', plainMode)),
          ' ',
          tool.free_limit,
        )
      : null,
    pricingPill(tool, plainMode),

    el('p', { class: 'card-section-label' }, pickLabel('alternatives', plainMode)),
    el('div', { class: 'card-links' },
      tool.alternatives.map((a) => extLink(a.url, a.name, true)),
    ),

    tool.byo
      ? el('div', { class: 'card-byo' },
          el('p', { class: 'card-byo-label' }, pickLabel('buildYourOwn', plainMode)),
          el('p', { class: 'card-byo-text' }, tool.byo),
        )
      : null,

    el('p', { class: 'card-section-label' }, pickLabel('getStarted', plainMode)),
    el('div', { class: 'card-links' },
      tool.training.map((t) => extLink(t.url, t.name, true)),
    ),

    tool.notes?.length
      ? el('div', { class: 'card-notes' }, tool.notes.map((n) => el('p', {}, n)))
      : null,

    verified ? el('p', { class: 'card-verified' }, `Verified ${verified}`) : null,

    toggleBtn,
  );

  if (showToggle) toggleBtn.addEventListener('click', () => onToggle(tool, article, toggleBtn));

  return article;
}

/** Archived tools never silently disappear (§4 ID permanence). An old link
    still resolves, but the card is compact and points only at alternatives:
    no training block, no value claim for a product no longer recommended. */
function archivedCard(tool, style, plainMode = false) {
  return el('article', { class: 'panel tool-card tool-card-archived', style },
    el('div', { class: 'card-top' },
      el('h3', {}, tool.name),
    ),
    el('p', { class: 'card-archived-note' }, 'No longer recommended. Consider the alternatives below.'),
    el('p', { class: 'card-section-label' }, pickLabel('alternatives', plainMode)),
    el('div', { class: 'card-links' },
      tool.alternatives.map((a) => extLink(a.url, a.name, true)),
    ),
  );
}

/** Pricing honesty pill (Feature 1, plain variant added Batch H). paid_from
    is only rendered when it is actually present: Number.isInteger, since 0
    is a real "free forever" value and must not be treated as absent. One
    neutral style either way, the wording carries the meaning, never colour
    alone. */
function pricingPill(tool, plainMode = false) {
  if (!Number.isInteger(tool.paid_from)) return null;
  const text = tool.paid_from === 0
    ? 'Free forever'
    : plainMode
      ? `Costs from ${money(tool.paid_from)} a month if you outgrow the free version`
      : `Paid plans from ${money(tool.paid_from)}/month`;
  return el('p', { class: 'card-pricing' }, el('span', { class: 'badge badge-pricing' }, text));
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

function costGrowthSection(tools, plainMode = false) {
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

  // Plain English takeaway (Batch H, Feature 1): one sentence above the
  // chart, reusing the same stage totals the chart itself draws from.
  // COST_STAGES[1] is "Team of 5", the stage this sentence names.
  const takeaway = plainMode
    ? el('p', { class: 'cli-cost-takeaway' },
        `Free while it is just you. Around ${money(stages[1].total)} a month if five people used everything.`)
    : null;

  return el('section', { class: 'cli-cost-growth', 'aria-labelledby': 'cli-cost-heading' },
    el('h2', { class: 'cli-cost-heading', id: 'cli-cost-heading' }, pickLabel('costHeading', plainMode)),
    el('p', { class: 'cli-cost-caption' },
      'Indicative monthly cost if you outgrew every free tier at once. Most businesses never do; many of these free tiers hold for years.'),
    el('p', { class: 'cli-cost-caption-note' },
      'Per-user tools are costed at their per-seat price times your team size. Tools that gate on usage or features are costed at their flat starting price, whatever your headcount.'),
    takeaway,
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

/** Exported (Batch I) alongside card() for the same reuse reason. */
export function categoryIcon(category) {
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
