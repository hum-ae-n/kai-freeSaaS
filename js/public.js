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
 *
 * PHASE 12.3 (PRD section 16, "Grid quick-judge and list parity"): every
 * browse card whose tool has a Discover decision carries a state chip, and
 * every card additionally grows a reserved-space quick-judge rail (tick and
 * plus) on hover-capable, fine-pointer devices. Both write through
 * discover.js's getDecision/setDecision/clearDecision/subscribe
 * (loadDiscoverModule below shares the same dynamic import the Discover
 * button already used, so loading it here costs nothing extra and still
 * degrades to "no parity controls" rather than a broken page if the module
 * never arrives). This file never builds the <li>/<article> card markup
 * itself (that stays client.js's, Phase 4's file, save for the one
 * data-id attribute it now carries for exactly this pairing): it decorates
 * the already-rendered <li> in place by appending sibling elements, the
 * same technique the hover-lift CSS above already uses to work around the
 * same ownership boundary. The rail is a normal-flow sibling, never an
 * absolutely-positioned overlay: see buildJudgeRail's own comment for why
 * (re-verify round 2 found a measured-overlay shape geometrically unsound).
 *
 * PHASE 14.1 (PRD section 16 as amended, v1.5, "compact landing"): the flat
 * browse list below is now 15 collapsed category shelves, one <section> per
 * category, each a single 44px header row (icon, name, count, a truncated
 * "scent" of tool names, chevron) that reveals its card grid on click. The
 * "Browse all" entry card is retired; its job passes to the shelves plus the
 * Expand all / Collapse all toggle on the shelf-band header. Search is
 * promoted into the ways-in band, full width, its placeholder count-bearing.
 *
 * The key architectural change from 12.1: buildCardSections() is now called
 * exactly ONCE per plain-English toggle, against the full active list, never
 * per keystroke. Search and persona filtering no longer rebuild any DOM at
 * all; they only toggle the `hidden` IDL property on individual <li> cards
 * and on whole shelf <section>s, which is what makes shelf collapse "CSS
 * only" and the rendered DOM "a superset of the previous layout's" (PRD
 * section 16, "Shelf mechanics"): every one of the 89 active cards is always
 * attached, nothing is ever lazily fetched, deferred or removed. This also
 * retires the per-category scroll-reveal system 12.1 built in this file
 * (revealOnIntersect for categories past the first): with shelves collapsed
 * by default there is no "first screenful of cards" for THIS file's own
 * reveal classes to animate in, and the shelf-open stagger itself is wave
 * 14.2's job (the motion inventory), not this one's. The hero/entry-band
 * first-paint reveal (motion item 1) is unchanged.
 *
 * That retirement does not, on its own, stop every card-level animation:
 * client.js's CLIENT block gives every .tool-card an unconditional CSS
 * "card-in" fade-and-rise on `prefers-reduced-motion: no-preference`
 * (owned by Phase 4, never edited here). Toggling a shelf grid's `hidden`
 * off is exactly the kind of display-none-to-block transition that
 * re-triggers a CSS animation, so without a fix every shelf open (and every
 * card in it, on Expand all) replayed that entrance on each toggle, an
 * unlisted motion the amended section 16's exhaustive inventory does not
 * allow and whose values are 12.1's old ones, not wave 14.2's forthcoming
 * shelf-open stagger. Fixed with a scoped suppression in the PUBLIC block
 * of styles.css (`.pub-shelf .tool-card { animation: none; }`): a
 * subtraction, not a new animation, so it does not enlarge the inventory;
 * client mode's own entrance (Phase 4, `#client-root`) is untouched since
 * the selector only ever matches inside a shelf.
 */
import { el, themeToggleButton, readPlainMode, writePlainMode, withViewTransition } from './data-loader.js';
import { buildCardSections, categoryIcon } from './client.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Shared across every call (there is only ever one renderPublic() per page
    load in practice, but this also means the Discover button's own click
    handler and the judgement-parity bootstrap below reuse one cached
    import rather than racing two separate dynamic imports of the same
    module. Resolves to null, never rejects, on load failure. */
let discoverModulePromise = null;
function loadDiscoverModule() {
  if (!discoverModulePromise) {
    discoverModulePromise = import('./discover.js').catch((cause) => {
      console.warn('Discover module unavailable:', cause);
      return null;
    });
  }
  return discoverModulePromise;
}

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

/* --- motion (PRD section 16, motion inventory item 1) ----------------------
   matchMedia is read before any animation class is ever applied, per the
   phase brief: a reduced-motion visitor never receives the transform-based
   class at all, only the opacity-only one, and the CSS behind the same
   query is a second, belt-and-braces guard on top of that JS choice. Wave
   14.1 scopes this to the hero and ways-in band only (see the file banner):
   the per-category card reveal 12.1 built is retired along with the flat
   list it revealed, since collapsed shelves have no "first screenful of
   cards" left to animate, and shelf-open motion is wave 14.2's inventory. */
function prefersReducedMotion() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const STAGGER_MS = 80; // Wave 14.2 recalibration: "80ms per item" (PRD section 16 amended, motion item 1)
const FIRST_SCREEN_CAP = 6; // "capped at the first screenful" (PRD section 16)

/** First-paint reveal: fires once, immediately, with a per-item delay. Used
    for the hero and the two ways-in entry items, all of which are meant to
    be visible without scrolling. */
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
  // backgrounded tab) keeps the stagger scoped to the entrance only.
  const clearDelay = () => { node.style.transitionDelay = ''; };
  node.addEventListener('transitionend', clearDelay, { once: true });
  setTimeout(clearDelay, delayMs + 600); // fallback buffer covers the 480ms entrance itself
}

/* --- motion: shelf-expansion stagger (motion inventory item 2, "the
   showpiece") -------------------------------------------------------------
   Fires exactly once per genuine closed-to-open transition, from a single
   choke point inside setShelfOpen below, so every trigger the spec names
   (a shelf header, Expand all, and search/persona force-open) is covered by
   construction and an already-open shelf is never re-animated by a later
   filter redraw. The first six cards in the shelf's own grid travel
   translateY(14px) to 0 with a fade, 45ms apart; any card past that cap is
   left alone; "later cards appear settled" per the spec is the natural
   result of never touching them at all, not a separate rule. Class-based,
   not left permanently set: cleanup after the transition (or its timeout
   fallback) lets the very same nodes animate again the next time their
   shelf opens, which a "reveal once" pattern like motion item 1's would not
   allow. */
const SHELF_STAGGER_MS = 45;
const SHELF_STAGGER_CAP = 6;
function staggerShelfCards(grid, reduced) {
  const cards = [...grid.children].slice(0, SHELF_STAGGER_CAP);
  for (const [index, li] of cards.entries()) {
    const cls = reduced ? 'pub-shelf-stagger-reduced' : 'pub-shelf-stagger';
    li.classList.add(cls);
    if (!reduced) li.style.transitionDelay = `${index * SHELF_STAGGER_MS}ms`;
    // Same two-frame reasoning as revealFirstPaint above: the opacity:0 (and,
    // for normal motion, translateY(14px)) starting state must actually
    // paint before the is-in class flips the transition's end state.
    requestAnimationFrame(() => requestAnimationFrame(() => li.classList.add('is-in')));
    const cleanup = () => {
      li.classList.remove(cls, 'is-in');
      li.style.transitionDelay = '';
    };
    li.addEventListener('transitionend', cleanup, { once: true });
    setTimeout(cleanup, (reduced ? 120 : 300) + index * SHELF_STAGGER_MS + 400);
  }
}

/** Category name to a URL-safe fragment for the `#cat-<slug>` deep link and
    the shelf grid's own id (the aria-controls target). Lower-cased,
    non-alphanumerics collapsed to a single hyphen, trimmed of leading and
    trailing hyphens: "AI Assistants" -> "ai-assistants". */
function slugify(text) {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** A plain chevron, hand-built the same way data-loader.js's theme icon and
    client.js's category icons are (no icon font, no extra request). Rotated
    by a static CSS rule keyed off the header's own aria-expanded value: a
    state change, not an animation, so it carries no transition of its own
    (this wave introduces no new animation styles; the showpiece shelf-open
    stagger is wave 14.2's). */
function chevronIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [key, value] of Object.entries({
    viewBox: '0 0 24 24', width: '18', height: '18', fill: 'none',
    stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round',
    'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'pub-shelf-chevron',
  })) svg.setAttribute(key, value);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'm6 9 6 6 6-6');
  svg.append(path);
  return svg;
}

/** Groups tools by category, insertion order preserved, the same grouping
    buildCardSections does internally. Called on the same array in the same
    order as the buildCardSections() call below, so the two orderings can
    never drift apart: this is what lets shelf metadata (count, scent, tool
    ids) be computed straight from tools.json rather than scraped back out
    of the rendered card DOM. */
function groupByCategory(list) {
  const map = new Map();
  for (const tool of list) {
    if (!map.has(tool.category)) map.set(tool.category, []);
    map.get(tool.category).push(tool);
  }
  return map;
}

export function renderPublic(root, tools) {
  // Archived tools are retired: the public directory shows only what a
  // reader could actually adopt today, same rule the curator table follows.
  const active = tools.filter((t) => !t.archived);
  const activeIds = new Set(active.map((t) => t.id));
  const toolsById = new Map(active.map((t) => [t.id, t]));
  let plainMode = readPlainMode();
  let searchTerm = '';
  // Persona-pack filter (PRD section 16, entry path 2). null means "no pack
  // chosen", never an empty array: an empty array would read as "show
  // nothing", which is not what deselecting a pack means. A Set, not an
  // array, so membership checks below never need a truthiness test against
  // an id (id 0 is a real tool and must survive this filter untouched).
  let activePersonaIds = null;
  let activePersonaChip = null;
  // Discover deck open/close wiring (PRD section 17): discoverOpen tracks
  // whether the panel is currently mounted so a second click on the button
  // refocuses it rather than mounting a duplicate; discoverLoading guards a
  // rapid double click against a duplicate in-flight dynamic import.
  let discoverOpen = false;
  let discoverLoading = false;
  // Discover's read/write API (getDecision/setDecision/clearDecision), once
  // js/discover.js has loaded; null until then, and forever null if it
  // never arrives, in which case every card simply renders with no
  // judgement parity controls at all.
  let judgeApi = null;
  // Shelf records, rebuilt only when plainMode toggles (card body text is
  // baked in at render time); search and persona filtering below never
  // touch this array's membership, only the hidden/aria-expanded state of
  // the nodes it already holds.
  let shelves = [];

  /* --- hero (PRD section 16, "Hero") ---------------------------------------
     Tightened but unchanged in content: the live count (derived from the
     same active-tools filter the shelves themselves use, never a separate
     hard-coded figure), the no-affiliates line verbatim, and the curator
     identity with its existing link. */
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
  // Utility nav (PRD section 16 amended, layout item 1, Phase 15): quiet
  // links to My Stack and FAQ, pinned to the panel's top corner by CSS
  // absolute positioning so it adds no vertical height at 375px and the
  // 880px first-shelf budget below stays untouched. A plain child of
  // `header`, so it inherits the hero's first-paint stagger rather than
  // needing a second reveal call. Real internal links, no target=_blank.
  const heroNav = el('nav', { class: 'pub-hero-nav', 'aria-label': 'Utility' },
    el('a', { href: '/my' }, 'My Stack'),
    el('a', { href: '/faq.html' }, 'FAQ'),
  );
  const header = el('header', { class: 'panel pub-header' },
    heroNav,
    el('img', { class: 'logo', src: 'design-system/assets/kaipability-logo-lockup.png', alt: 'Kaipability' }),
    el('h1', {}, 'Free Stack'),
    el('p', { class: 'subtitle' }, 'Curated free software for small business'),
    heroTrust,
  );

  /* --- ways-in band (PRD section 16, "Ways-in band") -----------------------
     Search promoted to first-class, full width, its placeholder count
     computed at runtime, above the Discover and persona-pack entry items.
     The "Browse all" entry card is retired: its job passes to the shelves
     below plus the Expand all / Collapse all toggle on the shelf-band
     header. Mobile vs desktop ordering of the two remaining entry items is
     handled by CSS layout alone (see the PUBLIC block of styles.css), never
     by rendering the markup twice. */
  const searchInput = el('input', {
    class: 'input pub-search', type: 'search',
    placeholder: `Search ${active.length} tool${active.length === 1 ? '' : 's'}: invoicing, design, CRM…`,
    'aria-label': 'Search the directory',
  });
  // Motion inventory item 3 ("View Transitions on filter and expand-all"):
  // the actual redraw is debounced so only a settled keystroke transitions,
  // never every keypress. FILTER_VT_DEBOUNCE_MS is well under the smoke
  // suite's tightest post-filter wait (150ms) even once the View Transition
  // API's own scheduling (observed empirically at one to two animation
  // frames) is added on top; a reduced-motion or VT-unsupported visitor
  // still gets exactly this debounced timing, just without the crossfade
  // (withViewTransition's own guard runs the callback directly for them).
  const FILTER_VT_DEBOUNCE_MS = 60;
  let filterDebounceTimer = null;
  searchInput.addEventListener('input', () => {
    searchTerm = searchInput.value.trim().toLowerCase();
    clearTimeout(filterDebounceTimer);
    filterDebounceTimer = setTimeout(() => withViewTransition(applyFilter), FILTER_VT_DEBOUNCE_MS);
  });
  const searchRow = el('div', { class: 'pub-search-row' }, searchInput);

  // PRD section 16: "Discover entry: button plus one-line pitch" and
  // "Persona chips: behaviour unchanged". Neither calls for the heading and
  // padded-panel treatment Phase 12.1's three-equal-card design used; the
  // compact landing needs the ways-in band to actually be compact, so this
  // wave drops that chrome in favour of a lean pitch line plus its control,
  // which is also most of what closes the gap to the page-height budget's
  // "first shelf rows visible within the first mobile viewport" clause.
  const discoverBtn = el('button', {
    class: 'btn btn-primary btn-lg pub-discover-btn', type: 'button',
    dataset: { discoverEntry: '1' },
  }, 'Start Discover');
  const discoverItem = el('div', { class: 'pub-entry-item pub-entry-discover' },
    el('p', { class: 'pub-entry-pitch' }, 'Discover: a short deck of tools, one at a time. Say what you already use and what you want to try.'),
    discoverBtn,
  );

  const personaChipRow = el('div', { class: 'pub-persona-chip-row' });
  const personaItem = el('div', { class: 'pub-entry-item pub-entry-personas' },
    el('p', { class: 'pub-entry-pitch' }, 'Or jump to a ready-made shortlist for your situation:'),
    personaChipRow,
  );

  const entryPaths = el('section', { class: 'pub-entry', 'aria-label': 'Ways to find a tool' },
    searchRow,
    el('div', { class: 'pub-entry-grid' }, discoverItem, personaItem),
  );

  // Deck mount point (PRD section 16: "an inline panel above the list,
  // never a modal"). discover.js owns everything rendered inside it once
  // opened.
  const discoverMount = el('div', { class: 'discover-mount', hidden: true });

  // Verifier fix round (page-height budget, PRD section 16 amended, "first
  // shelf rows visible within the first mobile viewport"): the Plain
  // English and theme-toggle buttons no longer get their own toolbar row
  // above the shelf band. They move into the shelf-band header itself,
  // alongside Expand all, saving a full row's height on every viewport,
  // mobile included.
  const plainBtn = el('button', {
    class: 'btn btn-ghost btn-lg plain-toggle', type: 'button', 'aria-pressed': String(plainMode),
  }, 'Plain English');
  plainBtn.addEventListener('click', () => {
    plainMode = !plainMode;
    writePlainMode(plainMode);
    plainBtn.setAttribute('aria-pressed', String(plainMode));
    // Card body text (plain vs normal) is baked in at render time by
    // client.js's card(), so this is the one action in this file that still
    // rebuilds shelf DOM wholesale rather than toggling hidden/aria state.
    shelves = buildShelves(active, plainMode);
    applyFilter();
  });

  function scrollToShelfBand() {
    shelfBand.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }

  /* --- ways-in band hide/restore while the deck is open (verifier fix,
     PRD section 16 amended, motion inventory item 8's closing clause):
     "While the deck is open the button is hidden with the rest of the
     ways-in band, so the sequence can never compete with the deck." As
     built, nothing ever enforced that: the button (glow and pulse both)
     sat in the viewport directly above the open deck, and the pulse could
     genuinely fire while the deck had focus. "The rest of the ways-in
     band" is read literally here: the whole `entryPaths` section, search
     input included, not only the Discover/persona grid, since the clause
     says the button is hidden WITH the rest of the band, not instead of
     it. A reader who wants to search the directory while the deck is open
     now has to close the deck first; flagged in this wave's own report as
     a UX cost of following the clause literally, not silently narrowed
     away. entryPaths.hidden is the established idiom (BASE block's
     `[hidden] { display: none !important; }`), the same one discoverMount
     itself already uses. */
  function hideWaysInBand() {
    entryPaths.hidden = true;
    // The pulse (motion item 8) must never fire again once the band has
    // been hidden even once: toggling display:none back to visible
    // restarts a CSS animation from its own beginning, delay included
    // (removing an element from rendering cancels its running animation
    // outright), which would replay the "at most two pulses per page
    // load, never runs again without a reload" sequence a second time on
    // every later close. Setting this class now, unconditionally, closes
    // that off regardless of which stage the pulse itself was in (not yet
    // started, mid-flight, or already finished) at the moment the band is
    // first hidden: see the CSS rule's own comment for why this beats the
    // animation shorthand it overrides.
    discoverBtn.classList.add('pub-discover-settled');
  }
  function showWaysInBand() {
    entryPaths.hidden = false;
  }

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
      const mod = await loadDiscoverModule();
      if (!mod) throw new Error('module unavailable');
      const { openDiscoverDeck } = mod;
      discoverOpen = true;
      // A currently active persona chip seeds the deck with that pack's
      // ids (PRD section 17); otherwise the deck falls back to its own
      // default mix. activePersonaIds is a Set, never an array filtered
      // with .filter(Boolean), so tool id 0 survives untouched.
      const seed = activePersonaIds ? { type: 'persona', ids: [...activePersonaIds] } : { type: 'default' };
      const openOptions = {
        tools,
        container: discoverMount,
        opener: discoverBtn,
        seed,
        // showWaysInBand() runs before discover.js's own closeDeck() hands
        // focus back to `opener` (this button): closeDeck() calls onClose()
        // first and focuses `opener` immediately afterward, so by the time
        // that focus() call runs the button is already visible again and
        // able to take it. No discover.js edit needed for this: closeDeck()
        // is already the single seam every close route (Escape, the close
        // button, and "Browse all" below) funnels through.
        onClose: () => { discoverOpen = false; showWaysInBand(); },
        onBrowseAll: () => { discoverOpen = false; scrollToShelfBand(); },
      };
      // Motion inventory item 4 ("Deck-open morph"): guarded the same way as
      // every other item, feature-detected and off under reduced motion.
      // canMorph mirrors withViewTransition's own guard exactly (duplicated,
      // not imported, since this branch also needs to know the outcome
      // BEFORE calling it, to decide whether to set up the view-transition
      // name and defer focus at all).
      const canMorph = typeof document.startViewTransition === 'function' && !prefersReducedMotion();
      if (canMorph) {
        // "The Discover entry carries view-transition-name: discover-panel
        // before mount": added to the button just before capture, removed
        // from it (and given to the panel instead) inside the callback, so
        // the two elements never carry the same view-transition-name at
        // once (the browser requires that name to be unique at each
        // capture).
        discoverBtn.classList.add('pub-vt-discover');
        let panelRef = null;
        const transition = withViewTransition(() => {
          panelRef = openDiscoverDeck({ ...openOptions, deferFocus: true });
          discoverBtn.classList.remove('pub-vt-discover');
          if (panelRef) panelRef.classList.add('pub-vt-discover');
          // The scroll happens here, inside the callback, against the
          // ALREADY-FILLED panel, not before it: scrolling an empty
          // discoverMount into view and then inserting 500+ px of content
          // into it a frame later measurably triggers the browser's own
          // scroll anchoring (it treats the freshly inserted content, which
          // lands right at the anchor point, as something to compensate
          // for), landing the page hundreds of pixels further down than
          // intended. Scrolling once, against final geometry, in the same
          // synchronous step that builds that geometry, never gives
          // anchoring anything to react to. 'auto' (instant), never
          // 'smooth': an animated scroll racing the transition's own
          // 380ms group animation is exactly the kind of scroll-linked
          // effect the inventory bans.
          discoverMount.scrollIntoView({ behavior: 'auto', block: 'start' });
        });
        // "Focus moves into the panel after the transition's finished
        // promise": isConnected guards the case where the reader has
        // already closed (or replaced) the panel before this settles, so a
        // stale reference is never focused back into a page that has moved
        // on. Caught, not left to reject unhandled: a skipped transition
        // (closed mid-flight) still resolves `finished`, but nothing here
        // depends on that distinction.
        // hideWaysInBand() is deferred to `finished`, the same point the
        // deferred focus above already waits for, and for the same reason:
        // hiding entryPaths inside the transition callback (before the
        // browser has captured its "new" state) would change the layout of
        // elements the transition is not tracking by name while it is
        // still mid-flight, visibly breaking the morph. Waiting for
        // `finished` lets the panel morph settle first, then removes the
        // band once there is nothing left for that removal to disturb.
        let transitionSettled = !transition;
        transition?.finished.then(() => {
          transitionSettled = true;
          hideWaysInBand();
          if (panelRef && panelRef.isConnected) panelRef.focus({ preventScroll: true });
        }).catch(() => { transitionSettled = true; hideWaysInBand(); });
        // Fast-first-tap regression, reopened by the morph itself: a pointer
        // interaction with the deck (the judge buttons above all) while
        // this page-level transition is still active moves native focus to
        // the clicked button as an ordinary side effect of clicking it, and
        // measured while building this wave, Chromium's own scroll-into-view
        // math for that native focus miscalculates against the transition's
        // still-active geometry, overshooting by several hundred pixels and
        // carrying the freshly dealt next card off-screen exactly the way
        // the Phase 12 close-out's original race did. skipTransition() ends
        // the transition immediately (still resolving `finished` normally,
        // so the deferred focus above still runs); calling it from a
        // capture-phase listener on the mount, ahead of the button's own
        // default focus action for the very same event, is what makes the
        // native scroll-into-view run against final, settled geometry
        // instead. Deck internals (js/discover.js's judge/button handling)
        // are never touched: this only ever reacts to the interaction from
        // the outside, once, before the deck's own listeners see it.
        const settleTransitionOnFirstInteraction = () => {
          if (!transitionSettled) transition?.skipTransition?.();
        };
        discoverMount.addEventListener('pointerdown', settleTransitionOnFirstInteraction, { capture: true, once: true });
        discoverMount.addEventListener('keydown', settleTransitionOnFirstInteraction, { capture: true, once: true });
      } else {
        // Fallback: today's mount and scroll, unchanged. openDiscoverDeck
        // focuses the panel itself (deferFocus defaults to false), and the
        // existing preventScroll discipline inside it is what already
        // guards the fast-first-tap race documented there. No transition to
        // wait for here (this is also the reduced-motion path, since
        // canMorph is false whenever prefersReducedMotion() is true), so
        // the band hides synchronously, before the scroll below, the same
        // "settled" point as the VT path's post-finished hide once there is
        // no morph in flight to disturb.
        openDiscoverDeck(openOptions);
        hideWaysInBand();
        discoverMount.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
      }
    } catch (cause) {
      // js/discover.js failing to load must never dead-end the directory:
      // fall back to the original stub behaviour (PRD section 16,
      // "the browse list must render even if js/discover.js never arrives").
      console.warn('Discover deck unavailable, falling back to the shelf band:', cause);
      scrollToShelfBand();
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

  /* --- category shelves (PRD section 16, "Category shelves", "Shelf
     mechanics") ---------------------------------------------------------- */
  const matchCountLine = el('p', { class: 'pub-shelf-match-count', hidden: true, 'aria-live': 'polite' });
  const expandAllBtn = el('button', {
    class: 'btn btn-ghost btn-lg pub-expand-all', type: 'button', 'aria-pressed': 'false',
  }, 'Expand all');
  expandAllBtn.addEventListener('click', () => {
    const shouldOpen = !allShelvesOpen();
    // Motion inventory item 3: a discrete, already-settled action, so this
    // runs inside the guarded transition directly, no debounce needed (that
    // is reserved for the search box's rapid keystrokes above).
    withViewTransition(() => {
      for (const shelf of shelves) setShelfOpen(shelf, shouldOpen, true);
      syncExpandAllLabel();
    });
  });
  // Two explicit rows, not one flex-wrap soup of four items: title+Expand
  // all (which fit one line together down to 375px) stay paired exactly as
  // before this fix round, and Plain English/theme toggle form their own
  // second row underneath. Letting all four wrap as a single group instead
  // measured two full internal wraps at 375px (roughly 146px), defeating
  // the "~92px, one row" saving this fold is meant to realise; kept as two
  // clean rows it measures close to that estimate instead.
  const shelfBandTopRow = el('div', { class: 'pub-shelf-band-top' },
    el('h2', { class: 'pub-shelf-band-title' }, 'Browse all tools'),
    expandAllBtn,
  );
  const shelfBandControls = el('div', { class: 'pub-shelf-band-controls' },
    plainBtn, themeToggleButton('btn-ghost btn-lg'),
  );
  const shelfBandHeader = el('div', { class: 'pub-shelf-band-header' },
    shelfBandTopRow,
    shelfBandControls,
  );
  const shelvesWrap = el('div', { class: 'pub-shelves' });
  const shelfBand = el('section', {
    class: 'pub-shelf-band', id: 'pub-browse-list', 'aria-label': 'Browse by category',
  }, shelfBandHeader, matchCountLine, shelvesWrap);

  function allShelvesOpen() {
    return shelves.length > 0 && shelves.every((s) => !s.grid.hidden);
  }
  function syncExpandAllLabel() {
    const open = allShelvesOpen();
    expandAllBtn.textContent = open ? 'Collapse all' : 'Expand all';
    expandAllBtn.setAttribute('aria-pressed', String(open));
  }
  /** manual: true when the change comes from an explicit user toggle (a
      shelf header, Expand all/Collapse all, a deep link); false when the
      search/persona filter is forcing a shelf open temporarily, which must
      not overwrite the manually-chosen state that clearing the filter later
      restores. */
  function setShelfOpen(shelf, open, manual) {
    const wasClosed = shelf.grid.hidden;
    shelf.grid.hidden = !open;
    shelf.headerBtn.setAttribute('aria-expanded', String(open));
    if (manual) shelf.manualOpen = open;
    // Motion inventory item 2: only a genuine closed-to-open transition
    // staggers its cards, from this single call site regardless of which of
    // the spec's named triggers (header, Expand all, search/persona
    // force-open) reached it. An already-open shelf that a filter redraw
    // simply re-confirms as open (applyFilter calls this on every matching
    // shelf on every keystroke) must never re-animate: wasClosed guards
    // exactly that.
    if (open && wasClosed) staggerShelfCards(shelf.grid, prefersReducedMotion());
  }

  /** Builds one <section> per category from a single buildCardSections()
      call, discarding client.js's own <h2> in favour of the shelf's button
      header (which already carries the category name and icon, plus the
      count/scent/chevron the plain heading never had): buildCardSections()
      itself is untouched, this is purely how its output is wrapped. The
      grid (`ul.card-grid`) is kept exactly as rendered; only its `hidden`
      IDL property changes hereafter, never its children. */
  function buildShelves(activeTools, plain) {
    const sections = buildCardSections(activeTools, { plainMode: plain, showToggle: false });
    const grouped = groupByCategory(activeTools);
    const built = [];
    const nodes = [];
    let i = 0;
    for (const [category, toolsInCat] of grouped) {
      const grid = sections[i * 2 + 1]; // sections[i*2] is the discarded h2
      i += 1;
      grid.classList.add('pub-shelf-grid');
      grid.hidden = true; // collapsed by default; CSS-only via the [hidden] rule
      const slug = slugify(category);
      const gridId = `shelf-grid-${slug}`;
      grid.id = gridId;
      const count = toolsInCat.length;
      const scentText = toolsInCat.map((t) => t.name).join(', ');
      const headerBtn = el('button', {
        class: 'pub-shelf-header', type: 'button',
        'aria-expanded': 'false', 'aria-controls': gridId,
      },
        categoryIcon(category),
        el('span', { class: 'pub-shelf-name' }, category),
        el('span', { class: 'pub-shelf-count' }, `· ${count} tool${count === 1 ? '' : 's'}`),
        el('span', { class: 'pub-shelf-scent' }, scentText),
        chevronIcon(),
      );
      const section = el('section', { class: 'pub-shelf', id: `cat-${slug}` },
        el('h2', { class: 'pub-shelf-heading' }, headerBtn),
        grid,
      );
      const shelf = {
        category, section, headerBtn, grid,
        toolIds: new Set(toolsInCat.map((t) => t.id)),
        manualOpen: false,
      };
      headerBtn.addEventListener('click', () => {
        setShelfOpen(shelf, shelf.grid.hidden, true);
        syncExpandAllLabel();
      });
      built.push(shelf);
      nodes.push(section);
    }
    shelvesWrap.replaceChildren(...nodes);
    return built;
  }

  /** Search and persona filtering (PRD section 16, "Shelf mechanics"):
      nothing is rebuilt, only `hidden` toggled, on both individual cards and
      whole shelf sections. A shelf with at least one match is force-opened
      (without touching its manualOpen record); a shelf with none is hidden
      outright. Clearing the filter restores each shelf's manually-chosen
      state, defaulting to collapsed. */
  function computeMatches(tool) {
    return matchesSearch(tool, searchTerm, plainMode) && (activePersonaIds === null || activePersonaIds.has(tool.id));
  }

  function applyFilter() {
    const filtering = searchTerm !== '' || activePersonaIds !== null;
    let totalMatches = 0;
    for (const shelf of shelves) {
      let shelfMatches = 0;
      for (const li of shelf.grid.children) {
        const id = Number.parseInt(li.dataset.id, 10);
        const tool = Number.isInteger(id) ? toolsById.get(id) : undefined;
        const matches = tool !== undefined && computeMatches(tool);
        li.hidden = filtering && !matches;
        if (matches) shelfMatches += 1;
      }
      totalMatches += shelfMatches;
      if (filtering) {
        shelf.section.hidden = shelfMatches === 0;
        if (shelfMatches > 0) setShelfOpen(shelf, true, false);
      } else {
        shelf.section.hidden = false;
        setShelfOpen(shelf, shelf.manualOpen, false);
      }
    }
    matchCountLine.hidden = !filtering;
    if (filtering) {
      matchCountLine.textContent = totalMatches === 0
        ? 'No tools match your search.'
        : `${totalMatches} tool${totalMatches === 1 ? '' : 's'} match`;
    }
    syncExpandAllLabel();
    decorateAllCards();
  }

  function decorateAllCards() {
    if (judgeApi) decorateCardsWithJudgement(shelvesWrap, active, judgeApi);
  }

  /** `#cat-<slug>` deep link: opens and scrolls to the named shelf. Read on
      mount and again on any later hash change, so an in-page link clicked
      after the app has already booted still works. */
  function openShelfBySlug(slug) {
    const shelf = shelves.find((s) => s.section.id === `cat-${slug}`);
    if (!shelf) return;
    setShelfOpen(shelf, true, true);
    syncExpandAllLabel();
    shelf.section.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }
  function handleHashDeepLink() {
    const hash = location.hash.slice(1);
    if (hash.startsWith('cat-')) openShelfBySlug(hash.slice(4));
  }

  /* --- FAQ section slot (BUILD-PLAN 14.1 reserved the slot; wave 14.3b
     fills it, PRD section 16 item 5 and section 18). The ten site Q&As come
     from data/faq.json (scripts/build-seo.mjs), the same file the ?tool=
     permalink and the static crawler block read, so this text is never
     re-derived here: fetched, not computed. Stays hidden and costs nothing
     against the page-height budget if the fetch fails, same tolerance as
     the changelog strip and persona packs just above. */
  const faqSection = el('section', { class: 'pub-faq', id: 'faq', 'aria-label': 'Frequently asked questions', hidden: true });
  loadFaqSection(faqSection);

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
        ', a register for tracking who holds which account, and ',
        el('a', { href: '/why-register.html' }, 'the reasoning behind it'),
        '.',
      ),
      // Good-practice block (PRD section 16 amended, layout item 6, Phase
      // 15): the legal/practice line and the company identity line, added
      // below the existing lines rather than replacing any of them.
      el('p', { class: 't-meta pub-footer-legal' },
        el('a', { href: '/privacy.html' }, 'Privacy'), ' · ',
        el('a', { href: '/contact.html' }, 'Contact'), ' · ',
        el('a', { href: '/faq.html' }, 'FAQ'), ' · ',
        el('a', { href: '/why-register.html' }, 'Why we built My Stack'),
      ),
      el('p', { class: 't-meta pub-footer-company' },
        'Kaipability Ltd, registered in England and Wales, Company No. 15772934. ',
        el('a', { href: 'https://kaipability.com', target: '_blank', rel: 'noopener noreferrer' }, 'kaipability.com'),
        ' · ',
        el('a', { href: 'https://www.airl.io', target: '_blank', rel: 'noopener noreferrer' }, 'AIRL'),
        '.',
      ),
    ),
  );

  shelves = buildShelves(active, plainMode);
  applyFilter();
  root.replaceChildren(header, entryPaths, discoverMount, changelogSection, shelfBand, faqSection, footer);
  document.title = 'Free Stack · Kaipability';

  handleHashDeepLink();
  window.addEventListener('hashchange', handleHashDeepLink);

  // Hero and entry paths reveal once, on mount (motion inventory item 1):
  // static content, never rebuilt after this.
  const reduced = prefersReducedMotion();
  [header, discoverItem, personaItem].forEach((node, i) => revealFirstPaint(node, i, reduced));

  loadPersonaPacks(personaChipRow, activeIds, {
    setPersonaIds: (ids) => { activePersonaIds = ids; },
    getActiveChip: () => activePersonaChip,
    setActiveChip: (chip) => { activePersonaChip = chip; },
    draw: applyFilter,
    scrollToBrowse: scrollToShelfBand,
  });

  // Judgement parity bootstrap (PRD section 16): the module may still be
  // loading (or may never arrive) by the time applyFilter() first ran above,
  // so once it resolves, decorate whatever the shelves currently hold in
  // place. From here on, any decision change anywhere, deck or browse list,
  // calls this same targeted redecoration through subscribe: never a full
  // rebuild, so settled shelves are never disturbed.
  loadDiscoverModule().then((mod) => {
    if (!mod) return;
    judgeApi = mod;
    decorateAllCards();
    mod.subscribe(decorateAllCards);
  });
}

/* --- judgement parity (Phase 12.3, PRD section 16, "Grid quick-judge and
   list parity") --------------------------------------------------------
   Every browse card whose tool carries a Discover decision gets a state
   chip, on every device. Every card also grows a quick-judge rail (tick and
   plus), but that only ever shows under (hover: hover) and (pointer: fine):
   the CSS in the PUBLIC block keeps it display:none, and therefore out of
   the tab order, everywhere else, so "absent entirely on coarse-pointer
   devices" holds without any UA sniffing here. A rail button reflects the
   current decision and clears it on a second activation of the same
   control, so a fine-pointer visitor never needs the chooser just to
   toggle a card. */

/** Pairs each rendered <li> with its tool by the data-id attribute
    client.js's buildCardSections now carries (wave 12.3 fix round: that
    file's one-line addition, documented there, is the authorised
    integration point). Number.parseInt plus Number.isInteger, never a
    truthiness test, so tool id 0's li (data-id="0") is never skipped as if
    it were "no id". Reads container.querySelectorAll directly rather than
    replaying buildCardSections' own category-grouping order, which used to
    be the only way to pair a card with its tool and broke silently the
    moment the two orderings drifted apart. Wave 14.1: called against the
    full active list every time, never a filtered subset, since every card
    is always attached to the DOM regardless of the current search/persona
    filter (only its `hidden` state differs). */
function decorateCardsWithJudgement(container, activeTools, judgeApi) {
  closeAnyOpenChooser(); // defensive: never leak a stale chooser's document listeners across a redraw
  const byId = new Map(activeTools.map((tool) => [String(tool.id), tool]));
  for (const li of container.querySelectorAll('.card-grid > li[data-id]')) {
    const id = Number.parseInt(li.dataset.id, 10);
    if (!Number.isInteger(id)) continue;
    const tool = byId.get(String(id));
    if (tool) decorateCard(li, tool, judgeApi);
  }
}

/** Tracks whichever chip chooser is currently open, page-wide (verifier fix
    round: there was no dismissal at all before this). Only one chooser may
    be open at a time: opening a new one closes whatever was already open,
    and this same function is called defensively at the top of every
    redecoration pass so a stale chooser's document-level listeners (see
    buildJudgeChipWrap) can never leak across a search/persona redraw or a
    live subscribe-triggered redraw fired from elsewhere on the page. */
let openChooserClose = null;
function closeAnyOpenChooser() {
  if (!openChooserClose) return;
  const close = openChooserClose;
  openChooserClose = null;
  close(false);
}

/** Idempotent: removes whatever this function itself last appended before
    adding fresh nodes, so a live subscribe notification (fired on every
    decision change, from any source) never stacks a second chip or rail
    pair onto the same card. */
function decorateCard(li, tool, judgeApi) {
  li.querySelectorAll(':scope > .pub-judge-rail, :scope > .pub-judge-chip-wrap').forEach((n) => n.remove());
  li.append(buildJudgeRail(li, tool, judgeApi), buildJudgeChipWrap(li, tool, judgeApi));
}

/** setDecision/clearDecision below call discover.js's notify() before
    returning, which runs decorateCard again synchronously: by the time a
    click handler here gets back control, the control the reader just
    activated has already been replaced. This moves focus onto whatever now
    represents the card, in priority order (the chip, a rail button, the
    card itself as a last resort), so a keyboard user's focus is never
    silently dropped to <body>. */
function focusJudgeChip(li) {
  const chip = li.querySelector(':scope > .pub-judge-chip-wrap .pub-judge-chip');
  if (chip) { chip.focus(); return; }
  const railBtn = li.querySelector(':scope > .pub-judge-rail .pub-judge-rail-have');
  if (railBtn && railBtn.offsetParent !== null) { railBtn.focus(); return; }
  const article = li.querySelector(':scope > article');
  if (!article) return;
  article.setAttribute('tabindex', '-1');
  article.focus();
  article.addEventListener('blur', () => article.removeAttribute('tabindex'), { once: true });
}

/** Quick-judge rail (PRD section 16; re-verify round 2 rearchitecture):
    tick ("Got it") and plus ("Try it", the rail's short label for "add to
    my list"). The previous shape was an absolutely-positioned overlay
    pinned to a JS-measured offset below the card's name/favicon/value row
    (.card-top); that measurement raced the grid's own layout on fresh load
    (a wrapped two-line title had not reached its settled height yet when
    read) and never recomputed on viewport resize, so the overlay landed on
    top of the header both on a slow first paint and after a resize
    re-wrapped a title. This shape carries no position, no
    getBoundingClientRect call and no resize listener anywhere: the rail is
    a plain sibling of the card's own <article> in normal document flow
    (built and appended in decorateCard above, never inside client.js's own
    element), so its box can never occupy the same pixels as the article's
    internal content by construction, regardless of viewport width, wrap
    state or load timing, the same guarantee the state chip below it
    already had. The CSS block for .pub-judge-rail reserves this box's
    height unconditionally the instant (hover: hover) and (pointer: fine)
    matches (dimmed at rest, full opacity on hover/focus-within, a plain
    value swap with no transition), so hovering never shifts layout either:
    the space was already there from the moment this function ran. */
function buildJudgeRail(li, tool, judgeApi) {
  const decision = judgeApi.getDecision(tool.id);
  const haveBtn = el('button', {
    class: 'pub-judge-rail-btn pub-judge-rail-have', type: 'button',
    'aria-label': 'Got it', title: 'Got it', 'aria-pressed': String(decision === 'have'),
  }, '✓');
  const wantBtn = el('button', {
    class: 'pub-judge-rail-btn pub-judge-rail-want', type: 'button',
    'aria-label': 'Try it', title: 'Try it', 'aria-pressed': String(decision === 'want'),
  }, '+');
  haveBtn.addEventListener('click', () => {
    if (judgeApi.getDecision(tool.id) === 'have') judgeApi.clearDecision(tool.id);
    else judgeApi.setDecision(tool.id, 'have');
    focusJudgeChip(li);
  });
  wantBtn.addEventListener('click', () => {
    if (judgeApi.getDecision(tool.id) === 'want') judgeApi.clearDecision(tool.id);
    else judgeApi.setDecision(tool.id, 'want');
    focusJudgeChip(li);
  });
  return el('div', { class: 'pub-judge-rail' }, haveBtn, wantBtn);
}

/** The state chip and its Got it / Add to my list / Clear chooser (PRD
    section 16): the single edit path for a judgement outside the deck,
    present on every device regardless of pointer or hover capability. A
    still-unjudged tool gets an empty wrapper: there is nothing to open a
    chooser for yet, and the quick-judge rail above (fine-pointer only) or
    the deck itself (universally) are how it gets judged for the first time. */
function buildJudgeChipWrap(li, tool, judgeApi) {
  const wrap = el('div', { class: 'pub-judge-chip-wrap' });
  const decision = judgeApi.getDecision(tool.id);
  if (decision !== 'have' && decision !== 'want') return wrap;

  const chip = el('button', {
    class: 'pub-judge-chip', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false',
  }, decision === 'have' ? 'Got it' : 'On my list');
  // Motion inventory item 5 ("Judged-chip pop"): wasFreshlyDecided consumes
  // a one-shot marker discover.js sets only on the setDecision/judge() write
  // path, never on a load-time or otherwise unrelated redecoration pass, so
  // this chip pops only when it is rendering the reader's own just-made
  // choice. Never applied under reduced motion, matching the discipline
  // every other item in this inventory uses (chosen in JS, guarded again in
  // CSS behind the same query).
  //
  // If the judgement lands while this tool's shelf is collapsed (a deck
  // judgement never opens the matching shelf), the animation cannot run at
  // all (a display:none element does not execute CSS animations): it plays
  // the first time the shelf is later opened instead, the same mechanism
  // .pub-shelf .tool-card's suppression rule above exists to guard against
  // for the OLD card-in animation. Left uncleaned, that would make this
  // pop replay on every subsequent open/close of the same shelf, exactly
  // that bug reborn on a new element. animationend removes the class the
  // first time it actually plays (immediately if the shelf is already
  // open, or on first reveal otherwise), so it is a genuine once-only pop
  // regardless of when the reader first sees it.
  if (!prefersReducedMotion() && judgeApi.wasFreshlyDecided(tool.id)) {
    chip.classList.add('is-new');
    chip.addEventListener('animationend', () => chip.classList.remove('is-new'), { once: true });
  }
  wrap.append(chip);

  // chooser, and the document-level listeners that dismiss it, only exist
  // between openChooser() and closeChooser(): nothing is ever left bound
  // once this chip's chooser is closed, by any path (verifier fix round).
  let chooser = null;
  let docPointerHandler = null;
  let docKeyHandler = null;

  function detachDocListeners() {
    if (docPointerHandler) { document.removeEventListener('pointerdown', docPointerHandler, true); docPointerHandler = null; }
    if (docKeyHandler) { document.removeEventListener('keydown', docKeyHandler, true); docKeyHandler = null; }
  }

  function closeChooser(returnFocus) {
    if (!chooser) return;
    chooser.remove();
    chooser = null;
    chip.setAttribute('aria-expanded', 'false');
    detachDocListeners();
    if (openChooserClose === closeChooser) openChooserClose = null;
    if (returnFocus) chip.focus();
  }

  function openChooser() {
    if (chooser) { closeChooser(true); return; } // second activation of the chip: toggle it shut
    closeAnyOpenChooser(); // only one chooser open at a time, page-wide
    chip.setAttribute('aria-expanded', 'true');
    const gotItBtn = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Got it');
    const wantBtn = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Add to my list');
    const clearBtn = el('button', { class: 'btn btn-ghost', type: 'button' }, 'Clear');
    gotItBtn.addEventListener('click', () => { judgeApi.setDecision(tool.id, 'have'); focusJudgeChip(li); });
    wantBtn.addEventListener('click', () => { judgeApi.setDecision(tool.id, 'want'); focusJudgeChip(li); });
    clearBtn.addEventListener('click', () => { judgeApi.clearDecision(tool.id); focusJudgeChip(li); });
    chooser = el('div', {
      class: 'pub-judge-chooser', role: 'group', 'aria-label': `Change judgement for ${tool.name}`,
    }, gotItBtn, wantBtn, clearBtn);
    wrap.append(chooser);

    // Outside-click dismissal: a document-level pointerdown landing outside
    // both the chooser and its own chip closes it, so clicking the search
    // input, another card or anywhere else on the page dismisses it, not
    // only Escape. Capture phase, so nothing downstream can swallow it.
    docPointerHandler = (event) => {
      if (chooser && !chooser.contains(event.target) && !chip.contains(event.target)) closeChooser(false);
    };
    // Escape closes regardless of where focus currently sits: a
    // document-level listener rather than one scoped to the chooser
    // element, since focus may still be on the chip (never having entered
    // the chooser at all) when Escape is pressed.
    docKeyHandler = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeChooser(true);
    };
    document.addEventListener('pointerdown', docPointerHandler, true);
    document.addEventListener('keydown', docKeyHandler, true);
    openChooserClose = closeChooser;
  }

  chip.addEventListener('click', openChooser);
  return wrap;
}

/** Persona-pack chips (PRD section 16, entry path 2). Fetched separately
    from tools.json, non-blocking: a missing or broken data/presets.json
    leaves the Discover entry path fully usable, same tolerance the
    changelog strip already has. Choosing a pack filters the shelves to that
    pack's ids (via the same applyFilter() the search box calls); it never
    navigates away. A second click on the active chip clears the filter.
    State lives in renderPublic's closure, not here, so it is threaded
    through as get/set pairs rather than duplicated as module-level
    variables. */
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
      // Motion inventory item 3: a discrete click, not a keystroke stream,
      // so draw() (applyFilter) runs inside the guarded transition directly.
      // The chip's own colour swap stays outside it (that is its existing,
      // unrelated micro-transition, not part of the page-wide filter
      // crossfade), and scrollToBrowse below is a separate scroll action,
      // never bundled into the transition's DOM mutation.
      if (wasActive) { withViewTransition(draw); return; }
      setPersonaIds(new Set(validIds));
      chip.classList.add('is-active');
      chip.setAttribute('aria-pressed', 'true');
      setActiveChip(chip);
      withViewTransition(draw);
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

/** Homepage FAQ slot (PRD section 16 item 5, filled in wave 14.3b): the ten
    site-level Q&As from data/faq.json, generated by scripts/build-seo.mjs
    from the same PRD section 18 canonical text as faq.html. Fetched
    separately from tools.json, non-blocking, same tolerance as
    loadChangelog and loadPersonaPacks just above: a missing or broken file
    leaves the slot hidden, never an error and never a blocked directory.
    Each Q&A renders as its own native <details>/<summary> ("as native
    details/summary items", not one details wrapping a list, the way the
    changelog strip's single collapsible does), so the content sits in the
    DOM whether open or not and every answer is reachable without opening
    every other one first. No motion is added anywhere here: details/summary
    toggles instantly by native browser behaviour, so there is nothing to
    guard under reduced motion. */
async function loadFaqSection(section) {
  let data;
  try {
    const res = await fetch('data/faq.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (cause) {
    console.warn('FAQ section unavailable, continuing without it:', cause);
    return;
  }
  if (!data || !Array.isArray(data.site)) return;

  const items = data.site
    .filter((entry) => entry && typeof entry.q === 'string' && typeof entry.a === 'string')
    .map((entry) => el('details', { class: 'pub-faq-item' },
      el('summary', { class: 'pub-faq-summary' }, entry.q),
      el('p', { class: 'pub-faq-answer' }, entry.a),
    ));
  if (!items.length) return;

  section.hidden = false;
  section.replaceChildren(
    el('h2', { class: 'pub-faq-heading' }, 'Frequently asked questions'),
    el('div', { class: 'pub-faq-list' }, items),
  );
}
