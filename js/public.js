/**
 * public.js: the public directory, per BUILD-PLAN item 10.12 (Rocky's 24 Jul
 * public/staff split) and, since Phase 12 wave 12.1, the redesigned homepage
 * of PRD section 16. Mounted at #public-root by data-loader's boot() for
 * every path that is not client mode, curator mode or the /x staff entry.
 * Read-only, indexable (no robots meta), no summary bar and no cost chart:
 * those belong to a curated selection, not the open catalogue. Cards reuse
 * client.js's card()/categoryIcon()/buildCardSections() rather than
 * duplicating the markup, with the checklist toggle suppressed throughout.
 *
 * PHASE 12.2: the "Discover" entry path (data-discover-entry) opens the deck
 * engine from js/discover.js, imported dynamically so a blocked or missing
 * module never stops the rest of the directory rendering (PRD section 16,
 * "Platform and security"): the click handler falls back to the original
 * scroll-to-browse-list behaviour on import failure. Mount and open/close
 * wiring only lives here; the deck itself, its persistence and its DOM are
 * entirely owned by discover.js. A currently active persona-pack chip seeds
 * the deck with that pack's ids (PRD section 17, "Deck composition"),
 * otherwise the deck falls back to its own default mix.
 */
import { el, themeToggleButton, readPlainMode, writePlainMode } from './data-loader.js';
import { buildCardSections } from './client.js';

/** Live search across name, category and description (whichever text is
    currently on screen: plain when Plain English is on and the tool has a
    plain entry, the normal description otherwise), case-insensitive. */
function matchesSearch(tool, term, plainMode) {
  if (!term) return true;
  const descriptionText = plainMode && tool.plain ? tool.plain : tool.description;
  const haystacks = [tool.name, tool.category, descriptionText, tool.plain]
    .filter((s) => typeof s === 'string')
    .map((s) => s.toLowerCase());
  return haystacks.some((h) => h.includes(term));
}

/* --- motion (PRD section 16, motion inventory items 1 and 2) ---------------
   matchMedia is read before any animation class is ever applied, per the
   phase brief: a reduced-motion visitor never receives the transform-based
   class at all, only the opacity-only one, and the CSS behind the same
   query is a second, belt-and-braces guard on top of that JS choice. Both
   reveal classes are used purely for entrance: once .is-in lands, the CSS
   transition owns the change, there is no requestAnimationFrame loop and no
   scroll-linked effect, only a one-shot IntersectionObserver per element
   that disconnects itself the moment it has fired. */
function prefersReducedMotion() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const STAGGER_MS = 70; // within the PRD's 60-80ms band
const FIRST_SCREEN_CAP = 6; // "capped at the first screenful" (PRD section 16)

/** First-paint reveal: fires once, immediately, with a per-item delay. Used
    for the hero, the three entry paths and the first category's cards, all
    of which are meant to be visible without scrolling. */
function revealFirstPaint(node, index, reduced) {
  if (!node) return;
  if (reduced) {
    node.classList.add('pub-reveal-reduced');
    requestAnimationFrame(() => node.classList.add('is-in'));
    return;
  }
  node.classList.add('pub-reveal');
  const delayMs = Math.min(index, FIRST_SCREEN_CAP) * STAGGER_MS;
  node.style.transitionDelay = `${delayMs}ms`;
  // Two frames, not one: the browser needs to paint the opacity:0 starting
  // state before the is-in class flips the transition's end state, or the
  // two can collapse into a single frame with no visible transition at all.
  requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add('is-in')));
  // transition-delay is a single CSS property, not scoped to the reveal
  // transition alone: leaving the inline value set would also delay any
  // later transition on this same element, including the hover-lift
  // transition the PUBLIC block puts on this same node for first-screen
  // cards (.card-grid > li). Clearing it once the entrance transition ends
  // (with a timeout fallback in case transitionend never fires, e.g. a
  // backgrounded tab) keeps the stagger scoped to the entrance only, so a
  // hovered first-screen card lifts with no residual delay.
  const clearDelay = () => { node.style.transitionDelay = ''; };
  node.addEventListener('transitionend', clearDelay, { once: true });
  setTimeout(clearDelay, delayMs + 500);
}

/** Once-only scroll reveal for a list section below the first screenful.
    The observer disconnects itself the instant it fires, per the PRD's
    "no scroll-linked effects" rule: this is a one-time entrance, never a
    parallax or repeating effect. */
function revealOnIntersect(node, reduced) {
  if (!node) return;
  if (reduced) {
    node.classList.add('pub-reveal-reduced', 'is-in');
    return;
  }
  node.classList.add('pub-reveal');
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-in');
      observer.unobserve(entry.target);
      observer.disconnect();
    }
  }, { threshold: 0.12 });
  observer.observe(node);
}

export function renderPublic(root, tools) {
  // Archived tools are retired: the public directory shows only what a
  // reader could actually adopt today, same rule the curator table follows.
  const active = tools.filter((t) => !t.archived);
  const activeIds = new Set(active.map((t) => t.id));
  let plainMode = readPlainMode();
  let searchTerm = '';
  // Persona-pack filter (PRD section 16, entry path 2). null means "no pack
  // chosen", never an empty array: an empty array would read as "show
  // nothing", which is not what deselecting a pack means. A Set, not an
  // array, so membership checks below never need a truthiness test against
  // an id (id 0 is a real tool and must survive this filter untouched).
  let activePersonaIds = null;
  let activePersonaChip = null;
  let hasRevealedList = false;
  // Discover deck open/close wiring (PRD section 17): discoverOpen tracks
  // whether the panel is currently mounted so a second click on the button
  // refocuses it rather than mounting a duplicate; discoverLoading guards a
  // rapid double click against a duplicate in-flight dynamic import.
  let discoverOpen = false;
  let discoverLoading = false;

  /* --- hero (PRD section 16, "Hero") ---------------------------------------
     Title and strapline as before, plus the three verifiable trust signals:
     the live count (derived from the same active-tools filter the card
     grid itself uses, never a separate hard-coded figure), the no-affiliates
     line verbatim, and the curator identity with its existing link. */
  const heroTrust = el('div', { class: 'pub-hero-trust' },
    el('p', { class: 'pub-hero-trust-item pub-hero-count' },
      el('strong', {}, String(active.length)),
      active.length === 1 ? ' free tool in the directory.' : ' free tools in the directory.'),
    el('p', { class: 'pub-hero-trust-item trust-line' }, 'No affiliates, no sponsors, no paid placement.'),
    el('p', { class: 'pub-hero-trust-item pub-hero-curator' },
      'Curated by ',
      el('a', { href: 'https://kaipability.com', target: '_blank', rel: 'noopener noreferrer' }, 'Kaipability Ltd'),
      '.',
    ),
  );
  const header = el('header', { class: 'panel pub-header' },
    el('img', { class: 'logo', src: 'design-system/assets/kaipability-logo-lockup.png', alt: 'Kaipability' }),
    el('h1', {}, 'Free Stack'),
    el('p', { class: 'subtitle' }, 'Curated free software for small business'),
    heroTrust,
  );

  /* --- entry paths (PRD section 16, "Entry paths") -------------------------
     Three equal-weight ways in: Discover (a stub this wave, see the module
     comment above), persona packs (data/presets.json, fetched the same
     non-blocking way the changelog strip already is) and Browse all. All
     three sit in one shared grid; mobile vs desktop ordering is handled by
     CSS layout alone (see the PUBLIC block of styles.css), never by
     rendering the markup twice. */
  const discoverBtn = el('button', {
    class: 'btn btn-primary btn-lg pub-discover-btn', type: 'button',
    dataset: { discoverEntry: '1' },
  }, 'Start Discover');
  const discoverItem = el('div', { class: 'pub-entry-item pub-entry-discover' },
    el('h2', {}, 'Discover'),
    el('p', { class: 't-small' }, 'A short deck of tools, one at a time. Say what you already use and what you want to try.'),
    discoverBtn,
  );

  const personaChipRow = el('div', { class: 'pub-persona-chip-row' });
  const personaItem = el('div', { class: 'pub-entry-item pub-entry-personas' },
    el('h2', {}, 'Persona packs'),
    el('p', { class: 't-small' }, 'Ready-made shortlists for common situations. Choose one to filter the list below.'),
    personaChipRow,
  );

  const browseBtn = el('button', {
    class: 'btn btn-ghost btn-lg pub-browse-btn', type: 'button',
    dataset: { browseEntry: '1' },
  }, 'Browse all tools');
  const browseItem = el('div', { class: 'pub-entry-item pub-entry-browse' },
    el('h2', {}, 'Browse all'),
    el('p', { class: 't-small' }, `Every one of the ${active.length} tools, grouped by category.`),
    browseBtn,
  );

  const entryPaths = el('section', { class: 'pub-entry', 'aria-label': 'Ways to find a tool' },
    el('div', { class: 'pub-entry-grid' }, discoverItem, personaItem, browseItem),
  );

  // Deck mount point (PRD section 16: "an inline panel above the list,
  // never a modal"). Sits right after the entry paths and before the
  // changelog/toolbar/list, so it reads as inline above the list on every
  // viewport, and below 768px it is already ahead of the browse list simply
  // by DOM order, same as the entry paths themselves. discover.js owns
  // everything rendered inside it once opened.
  const discoverMount = el('div', { class: 'discover-mount', hidden: true });

  /* --- toolbar: search, Plain English, theme ------------------------------- */
  const searchInput = el('input', {
    class: 'input pub-search', type: 'search',
    placeholder: 'Search tools, categories, descriptions…',
    'aria-label': 'Search the directory',
  });
  searchInput.addEventListener('input', () => {
    searchTerm = searchInput.value.trim().toLowerCase();
    draw();
  });

  const plainBtn = el('button', {
    class: 'btn btn-ghost btn-lg plain-toggle', type: 'button', 'aria-pressed': String(plainMode),
  }, 'Plain English');
  plainBtn.addEventListener('click', () => {
    plainMode = !plainMode;
    writePlainMode(plainMode);
    plainBtn.setAttribute('aria-pressed', String(plainMode));
    draw();
  });

  // id is the scroll target for both the Discover stub and Browse all: the
  // start of the browse list itself, so either entry path lands a reader in
  // the same place rather than two subtly different ones.
  const toolbar = el('div', { class: 'pub-toolbar', id: 'pub-browse-list' }, searchInput, plainBtn, themeToggleButton('btn-ghost btn-lg'));

  function scrollToBrowse() {
    toolbar.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }
  browseBtn.addEventListener('click', scrollToBrowse);

  discoverBtn.addEventListener('click', async () => {
    if (discoverOpen) {
      // Already open: bring it back into focus rather than mounting a
      // second panel over the first.
      discoverMount.querySelector('.discover-panel')?.focus();
      return;
    }
    if (discoverLoading) return;
    discoverLoading = true;
    try {
      const { openDiscoverDeck } = await import('./discover.js');
      discoverOpen = true;
      openDiscoverDeck({
        tools,
        container: discoverMount,
        opener: discoverBtn,
        // A currently active persona chip seeds the deck with that pack's
        // ids (PRD section 17); otherwise the deck falls back to its own
        // default mix. activePersonaIds is a Set, never an array filtered
        // with .filter(Boolean), so tool id 0 survives untouched.
        seed: activePersonaIds ? { type: 'persona', ids: [...activePersonaIds] } : { type: 'default' },
        onClose: () => { discoverOpen = false; },
        onBrowseAll: () => { discoverOpen = false; scrollToBrowse(); },
      });
      discoverMount.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    } catch (cause) {
      // js/discover.js failing to load must never dead-end the directory:
      // fall back to the original stub behaviour (PRD section 16,
      // "the browse list must render even if js/discover.js never arrives").
      console.warn('Discover deck unavailable, falling back to the browse list:', cause);
      scrollToBrowse();
    } finally {
      discoverLoading = false;
    }
  });

  /* --- recently updated strip (Feature 3, Batch I) -------------------------
     Fetched separately from tools.json, non-blocking: a missing or broken
     data/changelog.json must never stop the rest of the directory rendering,
     it simply renders nothing (with a console.warn) instead. */
  const changelogSection = el('section', { class: 'panel pub-changelog', hidden: true, 'aria-label': 'Recently updated' });
  loadChangelog(changelogSection);

  /* --- tool list, grouped by category, rebuilt on search/plain change ------ */
  const listWrap = el('div', { class: 'pub-list' });

  /* --- footer ---------------------------------------------------------------
     The one CTA line points a visitor who wants a curated selection at
     Kaipability directly, since the public directory itself never picks a
     stack for them (that stays the curator's job). */
  const footer = el('footer', { class: 'cli-footer pub-footer' },
    el('img', { class: 'logo', src: 'design-system/assets/kaipability-logo-lockup.png', alt: '' }),
    el('div', {},
      el('p', {},
        'Curated by ',
        el('a', { href: 'https://kaipability.com', target: '_blank', rel: 'noopener noreferrer' }, 'Kaipability Ltd'),
        '.',
      ),
      el('p', { class: 'pub-cta' },
        'Want a stack chosen for your business? ',
        el('a', { href: 'https://kaipability.com', target: '_blank', rel: 'noopener noreferrer' }, 'Talk to Kaipability'),
        '.',
      ),
      // Workspace entry point (PRD-REGISTER section 2, "a quiet link on the
      // public directory") plus the Wave D awareness page link (section 12,
      // "linked from the public directory footer"): both quiet text, same
      // treatment as the two paragraphs above.
      el('p', { class: 't-meta my-awareness-link-line' },
        'Also free: ', el('a', { href: '/my' }, 'My Stack'),
        ', a register for tracking who holds which account. ',
        el('a', { href: '/why-register.html' }, 'Why we built this'),
        '.',
      ),
    ),
  );

  /** Applies the two first-paint/scroll reveal treatments (motion items 1
      and 2) to a freshly built set of category sections, but only on the
      very first draw of this page visit: search, Plain English and
      persona-pack changes rebuild the section DOM on every keystroke and
      click, and PRD section 16's motion budget is once per visit, not once
      per rebuilt node. Without this early return, every later draw would
      hand fresh, still-below-fold headings to a brand new
      IntersectionObserver, which would fire immediately for anything
      already in view and fade it from opacity 1 to 0 and back, exactly the
      re-fade-on-keystroke defect this guards against. A later draw's
      sections are simply left with no reveal class at all, so they render
      fully visible from the moment they are attached, no opacity or
      transform change at all. */
  function revealSections(sections, animateFirstScreen) {
    if (!animateFirstScreen) return;
    const reduced = prefersReducedMotion();
    for (let i = 0; i < sections.length; i += 2) {
      const heading = sections[i];
      const grid = sections[i + 1];
      const isFirstCategory = i === 0;
      if (isFirstCategory) {
        revealFirstPaint(heading, 0, reduced);
        const cards = grid ? [...grid.children] : [];
        cards.forEach((li, idx) => revealFirstPaint(li, idx + 1, reduced));
      } else {
        revealOnIntersect(heading, reduced);
        if (grid) revealOnIntersect(grid, reduced);
      }
    }
  }

  function draw() {
    const filtered = active.filter((t) =>
      matchesSearch(t, searchTerm, plainMode) && (activePersonaIds === null || activePersonaIds.has(t.id)));
    if (!filtered.length) {
      listWrap.replaceChildren(el('p', { class: 'pub-empty' }, 'No tools match your search.'));
      return;
    }
    const sections = buildCardSections(filtered, { plainMode, showToggle: false });
    listWrap.replaceChildren(...sections);
    revealSections(sections, !hasRevealedList);
    hasRevealedList = true;
  }

  draw();
  root.replaceChildren(header, entryPaths, discoverMount, changelogSection, toolbar, listWrap, footer);
  document.title = 'Free Stack · Kaipability';

  // Hero and entry paths reveal once, on mount, independently of the list's
  // own reveal above: they are static content, never rebuilt by draw().
  const reduced = prefersReducedMotion();
  [header, discoverItem, personaItem, browseItem].forEach((node, i) => revealFirstPaint(node, i, reduced));

  loadPersonaPacks(personaChipRow, activeIds, {
    setPersonaIds: (ids) => { activePersonaIds = ids; },
    getActiveChip: () => activePersonaChip,
    setActiveChip: (chip) => { activePersonaChip = chip; },
    draw,
    scrollToBrowse,
  });
}

/** Persona-pack chips (PRD section 16, entry path 2). Fetched separately
    from tools.json, non-blocking: a missing or broken data/presets.json
    leaves the Discover and Browse all entry paths fully usable, same
    tolerance the changelog strip already has. Choosing a pack filters the
    browse list to that pack's ids; it never navigates away. A second click
    on the active chip clears the filter. State lives in renderPublic's
    closure, not here, so it is threaded through as get/set pairs rather
    than duplicated as module-level variables. */
async function loadPersonaPacks(row, activeIds, state) {
  const { setPersonaIds, getActiveChip, setActiveChip, draw, scrollToBrowse } = state;
  let presets;
  try {
    const res = await fetch('data/presets.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    presets = await res.json();
  } catch (cause) {
    console.warn('Persona packs unavailable, continuing without them:', cause);
    return;
  }
  if (!Array.isArray(presets) || !presets.length) return;

  for (const preset of presets) {
    const validIds = preset.ids.filter((id) => activeIds.has(id));
    if (!validIds.length) continue;
    const label = `${preset.name} (${validIds.length})`;
    const chip = el('button', {
      class: 'pub-persona-chip', type: 'button', 'aria-pressed': 'false', title: preset.description,
    }, label);
    chip.addEventListener('click', () => {
      const wasActive = chip === getActiveChip();
      const current = getActiveChip();
      if (current) {
        current.classList.remove('is-active');
        current.setAttribute('aria-pressed', 'false');
        setActiveChip(null);
        setPersonaIds(null);
      }
      if (wasActive) { draw(); return; }
      setPersonaIds(new Set(validIds));
      chip.classList.add('is-active');
      chip.setAttribute('aria-pressed', 'true');
      setActiveChip(chip);
      draw();
      scrollToBrowse();
    });
    row.append(chip);
  }
}

/** Newest-first, max 6 shown even if the file itself carries more (per the
    spec's "up to 6 entries"). Any shape mismatch (not an array, malformed
    entries) degrades to "render nothing", never a broken page. */
async function loadChangelog(section) {
  let entries;
  try {
    const res = await fetch('data/changelog.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('changelog.json is not an array');
    entries = data.filter((e) => e && typeof e.date === 'string' && typeof e.detail === 'string').slice(0, 6);
  } catch (cause) {
    console.warn('Recently updated strip unavailable:', cause);
    return;
  }
  if (!entries.length) return;

  const list = entries.map((entry) => el('li', {
    class: entry.kind === 'archived' ? 'pub-changelog-item is-archived' : 'pub-changelog-item',
  },
    el('span', { class: 'pub-changelog-date' }, formatChangelogDate(entry.date)),
    el('span', { class: 'pub-changelog-detail' }, entry.detail),
  ));

  section.hidden = false;
  // Collapsed by default (Rocky, 25 Jul): the strip is a trust signal for
  // whoever wants it, not a headline. Native details keeps it keyboardable.
  section.replaceChildren(
    el('details', { class: 'pub-changelog-details' },
      el('summary', { class: 'eyebrow pub-changelog-summary' }, 'Recently updated'),
      el('ul', { class: 'pub-changelog-list' }, list),
    ),
  );
}

function formatChangelogDate(dateStr) {
  const parsed = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateStr;
  return parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
