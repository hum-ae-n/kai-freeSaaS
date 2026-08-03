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
 * category, each a single 44px header row (icon, name, count, chevron) that
 * reveals its card grid on click. The "Browse all" entry card is retired;
 * its job passes to the shelves plus the Expand all / Collapse all toggle on
 * the shelf-band header. Search is promoted into the ways-in band, full
 * width, its placeholder count-bearing. (The muted "scent" line of tool
 * names this header once carried was retired in Phase 15.6, Rocky's mobile
 * finesse pass: truncated to two or three words at 375px it read as noise,
 * not scent. Search still finds every tool name regardless.)
 *
 * The key architectural change from 12.1: buildCardSections() is now called
 * exactly ONCE per plain-English toggle, against the full active list, never
 * per keystroke. Search and persona filtering no longer rebuild any DOM at
 * all; they only toggle the `hidden` IDL property on individual <li> cards
 * and on whole shelf <section>s, which is what makes shelf collapse "CSS
 * only" and the rendered DOM "a superset of the previous layout's" (PRD
 * section 16, "Shelf mechanics"): every one of the active cards is always
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
import { el, themeToggleButton, readPlainMode, writePlainMode, withViewTransition, money } from './data-loader.js';
import { buildCardSections, categoryIcon } from './client.js';
import { PAYMENT_LINKS } from './payments.js';

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

/* --- motion: savings ticker count-up (Phase 17, PRD section 16 amended
   layout item 1's savings-ticker clause; BUILD-PLAN 17.1) -----------------
   "Runs ONCE on arrival, then rests forever. Not a loop." A plain rAF
   loop that terminates itself once SAVINGS_COUNT_MS has elapsed is not the
   banned `animation: infinite` the exception sweep above polices: it
   belongs to motion inventory item 1's first-paint family (an entrance,
   not ambient motion), and introduces no third exception alongside items
   8 and 9. Ease-out cubic decelerates into the final figure rather than a
   linear count that reads as mechanical. The very last write is always
   money(target), never whatever the eased interpolation happened to land
   on that frame, so the resting figure can never be a rounding artefact of
   the animation, per the phase brief's own wording. Under reduced motion
   the final figure is written once, synchronously, with no rAF at all: no
   frame of this ever runs, so there is nothing for the reduced-motion
   sweep to find. */
const SAVINGS_COUNT_MS = 1100;
/* Phase 17.2 (Rocky: the count, the pounds and the coffees "load one after the other so
   eye scans"): each figure takes its own start offset, so the three read
   left to right as a sequence rather than three things moving at once. The
   stagger is the whole point of the change: a reader's eye is led across the
   row instead of having to choose where to look. Still one entrance apiece,
   still terminating, so this remains motion item 1's family and adds no
   third ambient exception. */
const FACT_STAGGER_MS = 260;
function animateFigure(node, target, reduced, { delayMs = 0, format = (n) => String(n) } = {}) {
  if (reduced) { node.textContent = format(target); return; }
  // Hold the start value until this figure's turn, so a staggered figure is
  // not silently sitting at its final value before it animates.
  node.textContent = format(0);
  const begin = performance.now() + delayMs;
  function step(now) {
    if (now < begin) { requestAnimationFrame(step); return; }
    const progress = Math.min(1, (now - begin) / SAVINGS_COUNT_MS);
    const eased = 1 - (1 - progress) ** 3;
    node.textContent = format(Math.round(target * eased));
    if (progress < 1) requestAnimationFrame(step);
    else node.textContent = format(target); // exact, never an eased-interpolation artefact
  }
  requestAnimationFrame(step);
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

/** A "lines of text" glyph for the Plain English toggle (Phase 16, PRD
    section 16 amended layout item 1): the same hand-built SVG technique as
    chevronIcon/categoryIcon/themeIcon above, no icon font, no extra
    request. Unlike the theme toggle, Plain English never had an icon of its
    own before this wave; this is what lets it collapse to icon-only below
    768px alongside the theme toggle rather than being the one item in the
    bar with no compact form (see the PUBLIC block of styles.css for the
    breakpoint and the visually-hidden label it swaps to). */
function plainToggleIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [key, value] of Object.entries({
    viewBox: '0 0 24 24', width: '16', height: '16', fill: 'none',
    stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round',
    'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'plain-toggle-icon',
  })) svg.setAttribute(key, value);
  for (const d of ['M4 7h16', 'M4 12h11', 'M4 17h14']) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/** A plain three-line hamburger glyph for the compressed top bar's
    disclosure trigger (16.4), the same hand-built SVG technique as every
    other icon in this file: no icon font, no extra request. The button
    itself carries the real accessible name and aria-expanded/aria-controls
    (see the topbar wiring below); this glyph is purely decorative,
    aria-hidden. */
function burgerIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [key, value] of Object.entries({
    viewBox: '0 0 24 24', width: '20', height: '20', fill: 'none',
    stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round',
    'aria-hidden': 'true',
  })) svg.setAttribute(key, value);
  for (const d of ['M4 6h16', 'M4 12h16', 'M4 18h16']) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/** Groups tools by category, insertion order preserved, the same grouping
    buildCardSections does internally. Called on the same array in the same
    order as the buildCardSections() call below, so the two orderings can
    never drift apart: this is what lets shelf metadata (count, tool ids) be
    computed straight from tools.json rather than scraped back out of the
    rendered card DOM. */
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

  /* --- hero (PRD section 16 amended, layout item 1, Phase 16 rewrite) ------
     Rocky's 2 Aug direction, "the first section should be distinctive and
     say what Free Stack is, call it what it is": the headline now states
     the proposition in a stranger's words, and the live tool count (never a
     separate hard-coded figure) moves into the sub-line, which is trust
     signal 1 made prose rather than a stat line of its own. The two
     remaining verifiable trust signals (no-affiliates, curator identity)
     stay put underneath; the old standalone count paragraph this div used
     to carry first is retired here, since restating the count a second time
     directly under the sub-line that already states it would be pure
     duplication (see this wave's own report for what the hero rendered
     before this change). */
  const heroTrust = el('div', { class: 'pub-hero-trust' },
    el('p', { class: 'pub-hero-trust-item trust-line' }, 'No affiliates, no sponsors, no paid placement.'),
    el('p', { class: 'pub-hero-trust-item pub-hero-curator' },
      'Curated by ',
      el('a', { href: 'https://kaipability.com', target: '_blank', rel: 'noopener noreferrer' }, 'Kaipability Ltd'),
      '.',
    ),
  );
  // The headline states what the thing is; the sub-line carries the runtime
  // count (never hard-coded, computed from the same `active` array the
  // shelves and the search placeholder already use) plus the closing
  // sentence, the differentiator a competitor could not copy just by
  // copying the list. .pub-hero-count on the <strong> keeps the class name
  // BUILD-PLAN 16.2 already gave this figure, now scoped to where the count
  // actually lives rather than a whole paragraph of its own.
  const heroSubline = el('p', { class: 'subtitle pub-hero-subline' },
    'Honest limits, at least two alternatives for every tool, and nobody paid to be listed.',
  );
  /* --- savings ticker (Phase 17, PRD section 16 amended layout item 1's
     savings-ticker clause, Rocky, 3 Aug: "a roller that spins that shows
     the maximum amount of money you save in pounds and Starbucks
     coffees... a ticker on the hero section") --------------------------
     Beneath the sub-line. Every figure is derived from `active` at
     runtime, never a separate hard-coded total, exactly like the count
     above. The honesty rule (PRD section 10, "a figure nobody would pay
     is a bug the validator cannot catch"): the ceiling sums every active
     tool's value and nobody adopts all of them, so it is only ever built
     labelled as a ceiling ("if you used all N tools") and paired with the
     realistic core-twelve figure in the very SAME element (savingsTicker
     below), never split across two nodes that could exist independently
     of each other. COFFEE_CUP_PRICE_GBP is the one named constant the
     coffee line's own copy states as its divisor: the site never asserts
     what a given chain charges, only shows its working, the same standard
     the `value` field itself is held to. */
  const COFFEE_CUP_PRICE_GBP = 4;
  const coreTools = active.filter((t) => t.type === 'core');
  const sumValue = (list) => list.reduce((total, t) => total + (Number.isFinite(t.value) ? t.value : 0), 0);
  const savingsCeiling = sumValue(active);
  const savingsCore = sumValue(coreTools);
  // Rounded to the nearest hundred purely for a readable "roughly" figure:
  // the coffee equivalent is already an approximation once a flat £4 cup
  // price is assumed. The ceiling and core figures above stay exact, since
  // those two are what the honesty rule, and the smoke suite's mutation
  // test, hold to an exact computed sum.
  const savingsCoffees = Math.round(savingsCeiling / COFFEE_CUP_PRICE_GBP / 100) * 100;
  // Accessibility (item 4 of the phase brief): the accessible name is set
  // from the start as one settled sentence, never `aria-live`, so a screen
  // reader announces it once regardless of how the animated digits below
  // are updating; those digits (savingsAmountEl, inside
  // .pub-savings-visible) are `aria-hidden`, so the count-up itself is
  // never read digit-by-digit or announced sixty-odd times over. Chosen
  // over aria-live="off" because a static, complete sentence read on
  // arrival is more informative than an off-live-region node a screen
  // reader may still expose to "browse mode" navigation as a fragment of
  // rendered digits with no framing words attached.
  const savingsSentence = `Up to ${money(savingsCeiling)} a year, if you used all `
    + `${active.length} tools. A starter stack of ${coreTools.length} saves `
    + `${money(savingsCore)}, roughly ${savingsCoffees.toLocaleString('en-GB')} `
    + `coffees at ${money(COFFEE_CUP_PRICE_GBP)} a cup.`;
  /* Three facts, read left to right (Phase 17.2, Rocky: "make the facts
     three columns", the count, the pounds and the coffees loading one after another so
     eye scans"). The container keeps the .pub-savings-ticker class the
     honesty checks already target: every one of them asserts on this
     element's aggregate text, so the ceiling still cannot render without
     its "if you used all N tools" framing or without the core figure, which
     is exactly the guarantee that must survive a layout change. */
  const savingsAmountEl = el('span', { class: 'pub-savings-amount' }, money(0));
  const toolCountEl = el('span', { class: 'pub-fact-figure' }, '0');
  const coffeeCountEl = el('span', { class: 'pub-fact-figure' }, '0');
  const savingsTicker = el('div', { class: 'pub-savings-ticker pub-hero-facts' },
    el('p', { class: 'visually-hidden' }, savingsSentence),
    el('div', { class: 'pub-savings-visible', 'aria-hidden': 'true' },
      el('div', { class: 'pub-fact' },
        toolCountEl,
        el('p', { class: 'pub-fact-label' }, `free tool${active.length === 1 ? '' : 's'}`),
      ),
      el('div', { class: 'pub-fact pub-fact-money' },
        savingsAmountEl,
        el('p', { class: 'pub-fact-label' }, 'a year, at most'),
      ),
      el('div', { class: 'pub-fact' },
        coffeeCountEl,
        el('p', { class: 'pub-fact-label' }, 'coffees'),
      ),
      el('p', { class: 'pub-fact-detail' },
        'That is if you used all ',
        el('strong', {}, String(active.length)),
        ' tools. A starter stack of ',
        el('strong', {}, String(coreTools.length)),
        ' saves ',
        el('strong', {}, money(savingsCore)),
        `, or about ${savingsCoffees.toLocaleString('en-GB')} coffees at ${money(COFFEE_CUP_PRICE_GBP)} a cup.`,
      ),
    ),
  );
  // Drifting stack planes (motion inventory item 9, PRD section 16 amended):
  // the second and final recorded exception to the ban on looping ambient
  // motion, built here purely as inert decoration (aria-hidden, no text, no
  // interactive content) so it never enters the accessibility tree or the
  // tab order. Four parallelogram planes, CSS transform/opacity only (see
  // the PUBLIC block of styles.css for the keyframes, the reduced-motion
  // static frame and the worked contrast proof); this function only ever
  // builds the same four inert nodes, once, on mount.
  const heroBg = el('div', { class: 'pub-hero-bg', 'aria-hidden': 'true' },
    el('div', { class: 'pub-hero-plane pub-hero-plane-1' }),
    el('div', { class: 'pub-hero-plane pub-hero-plane-2' }),
    el('div', { class: 'pub-hero-plane pub-hero-plane-3' }),
    el('div', { class: 'pub-hero-plane pub-hero-plane-4' }),
  );
  // Plain English and theme toggle (Phase 16, PRD section 16 amended layout
  // item 1, Rocky's 2 Aug direction: "buttons for plain english and light
  // dark mode switch should be on the top bar really"): built here, ahead
  // of heroNav below, so they can sit in it alongside My Stack and FAQ.
  // They used to share a row with Expand all on the shelf-band header (see
  // BUILD-PLAN's "verifier fix round" history); that row is retired below
  // and its saved height is what pays for this bar (see this wave's own
  // report for the measured before/after fold numbers).
  const plainBtn = el('button', {
    class: 'btn btn-ghost btn-lg plain-toggle', type: 'button', 'aria-pressed': String(plainMode),
  }, plainToggleIcon(), el('span', { class: 'pub-util-label' }, 'Plain English'));
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
  const themeBtn = themeToggleButton('btn-ghost btn-lg');

  // Utility bar (PRD section 16 amended, layout item 1): My Stack, FAQ,
  // Plain English and the light/dark toggle, in that order, all four at
  // least 44px. Since 16.4 this nav lives inside the fixed .pub-topbar
  // below, not inside `header`: it is no longer part of the hero's one-time
  // entrance (it is always-visible chrome now, not content that fades in),
  // and a position: fixed descendant of `header` would be trapped by
  // .pub-reveal's own transform during that entrance (a transform on any
  // ancestor creates a new containing block for a fixed descendant), which
  // would visibly drag the bar along with the hero's fade-in for that one
  // frame window. My Stack/FAQ are real internal links, no target=_blank;
  // the two toggles keep their existing behaviour, just relocated.
  const heroNav = el('nav', { class: 'pub-hero-nav', id: 'pub-topbar-nav', 'aria-label': 'Utility' },
    el('a', { href: '/my' }, 'My Stack'),
    el('a', { href: '/faq.html' }, 'FAQ'),
    plainBtn,
    themeBtn,
  );

  /* --- fixed, self-compressing top bar (16.4, PRD section 16 amended layout
     item 1's fixed-bar clause) ------------------------------------------
     .pub-topbar holds heroNav (visible directly while expanded) and
     topbarBurger (visible only once compressed). Which is which is CSS
     only, keyed off the classes/attributes toggled below; the four control
     nodes themselves are never duplicated between the bar and the
     disclosure. */
  const topbarBurger = el('button', {
    class: 'pub-topbar-burger', type: 'button',
    'aria-expanded': 'false', 'aria-controls': 'pub-topbar-nav', 'aria-label': 'Menu',
  }, burgerIcon());
  const topbar = el('div', { class: 'pub-topbar' }, topbarBurger, heroNav);
  // The bar covers no control by construction wherever content is already
  // in its resting scroll position (the sticky shelf header fix above), but
  // scrollIntoView({block: 'start'}) is a different hazard entirely: this
  // page already calls it on the Discover mount, a shelf's own header (the
  // "wasStuck" collapse case) and the #cat- hash deep link, every one of
  // them aligning some element's top edge to scrollY's literal zero, which
  // is now the bar's own box, not empty space. Proven live in this wave's
  // own testing: without this, the Discover panel's close button ends up
  // roughly half covered by the bar the instant the deck opens.
  // scroll-padding-top is the general fix, a scroll-container property
  // scrollIntoView already honours natively, so every call site above is
  // covered at once without hunting each one down individually; the class
  // scopes it to this page only (curator, client and My Stack never mount
  // this bar and must not gain scroll padding they have no use for).
  document.documentElement.classList.add('pub-has-topbar');
  // the shelf headers already use. Scrolling it above the viewport is "the
  // reader has scrolled past the hero", the spec's own wording for when to
  // compress.
  const heroEndSentinel = el('div', { class: 'pub-topbar-sentinel', 'aria-hidden': 'true' });

  let topbarPanelOpen = false;
  function closeTopbarPanel(focusBurger) {
    // focusBurger: true forces it (Escape's own contract: "returns focus to
    // the burger" unconditionally); 'auto' only if focus is actually about
    // to be dropped (see below); false never moves focus at all (the
    // scroll-back-to-expanded path, where nothing is hidden so nothing is
    // at risk). Computed BEFORE the nav is hidden: once .is-compressed
    // without .is-open takes effect (the CSS above), a focused descendant
    // of a display:none subtree is dropped straight to <body> by the
    // browser itself, the exact defect the Phase 14 coach dismissal
    // shipped with (PRD section 16 amended, "Focus must never be dropped
    // on body"). Moving focus to the burger first, whenever it was inside
    // the panel, is what keeps every close route safe regardless of which
    // one fired.
    const hadFocusInside = heroNav.contains(document.activeElement);
    if (!topbarPanelOpen) return;
    topbarPanelOpen = false;
    heroNav.classList.remove('is-open');
    topbarBurger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onTopbarKeydown);
    document.removeEventListener('pointerdown', onOutsideTopbarPointerdown, true);
    if (focusBurger === true || (focusBurger === 'auto' && hadFocusInside)) {
      topbarBurger.focus({ preventScroll: true });
    }
  }
  function onTopbarKeydown(event) {
    if (event.key === 'Escape') { event.preventDefault(); closeTopbarPanel(true); }
  }
  // pointerdown, deliberately not click: a tap or click on any target,
  // focusable or not, blurs whatever currently holds focus as part of the
  // BROWSER's own default action for that pointer press, and that default
  // action runs before a same-tick 'click' listener ever sees the event,
  // often landing focus on <body> first if the pressed target is not
  // itself focusable. Proven in this wave's own testing: an outside click
  // listener on 'click' measured hadFocusInside as false (activeElement was
  // already <body> by the time it ran) for exactly this reason, which is
  // the whole defect this contract exists to prevent. 'pointerdown' fires
  // before that default blur, so closeTopbarPanel below still sees the
  // real, pre-blur activeElement and can win the race by moving focus to
  // the burger itself before the browser moves it to <body>.
  function onOutsideTopbarPointerdown(event) {
    if (heroNav.contains(event.target) || topbarBurger.contains(event.target)) return;
    // Winning the race needs one more thing beyond firing early: even
    // caught here, ahead of the browser's own blur, that blur (and any
    // fresh focus the pressed target claims for itself) is still QUEUED as
    // this same pointerdown's default action and would run right after this
    // handler returns, undoing an explicit focus() call made now. Measured
    // in this wave's own testing: without preventDefault() here, the burger
    // received focus for one instant and lost it again to <body> a moment
    // later. preventDefault() is scoped to exactly the case that needs it,
    // focus genuinely inside the panel about to be closed: an outside click
    // on ordinary page furniture (a shelf, a card, plain text) never
    // legitimately depended on the browser's default mousedown focus
    // behaviour anyway, and a click on a real link or button elsewhere
    // still activates normally, since that activation is the CLICK event's
    // own default action, a separate thing this never touches.
    if (heroNav.contains(document.activeElement)) event.preventDefault();
    closeTopbarPanel('auto');
  }
  function openTopbarPanel() {
    if (topbarPanelOpen) return;
    topbarPanelOpen = true;
    heroNav.classList.add('is-open');
    topbarBurger.setAttribute('aria-expanded', 'true');
    // "Opening moves focus into the panel": the first real control (My
    // Stack), not the <nav> element itself, since every item here is
    // already a focusable link or button and landing on the first one is
    // the standard disclosure-menu contract, more informative to a screen
    // reader than a bare, tabindex="-1" container would be.
    const firstControl = heroNav.querySelector('a, button');
    if (firstControl) firstControl.focus({ preventScroll: true });
    document.addEventListener('keydown', onTopbarKeydown);
    document.addEventListener('pointerdown', onOutsideTopbarPointerdown, true);
  }
  topbarBurger.addEventListener('click', () => {
    if (topbarPanelOpen) closeTopbarPanel(true); else openTopbarPanel();
  });

  // Compress trigger (motion inventory's ban on scroll-linked effects: a
  // class toggle from an IntersectionObserver, never a scroll handler
  // tweening anything). Direction-aware the same way the shelf headers'
  // own is-stuck detection already is: !isIntersecting alone is true both
  // for a sentinel scrolled above the viewport (genuinely past the hero)
  // and for one still below it (not there yet), so the sentinel's own top
  // edge is compared against the root's to disambiguate.
  if (typeof IntersectionObserver === 'function') {
    new IntersectionObserver(([entry]) => {
      const rootTop = entry.rootBounds ? entry.rootBounds.top : 0;
      const scrolledPast = !entry.isIntersecting && entry.boundingClientRect.top < rootTop;
      if (scrolledPast === topbar.classList.contains('is-compressed')) return;
      topbar.classList.toggle('is-compressed', scrolledPast);
      // Scrolling back above the hero always reveals the four controls
      // inline again (the CSS gates the hidden rule on .is-compressed, so
      // leaving that state shows heroNav regardless of .is-open): nothing
      // is hidden here, so this never risks dropping focus, hence false.
      if (!scrolledPast) closeTopbarPanel(false);
    }, { threshold: 0 }).observe(heroEndSentinel);
  }

  // --topbar-h (16.4): the bar's own live rendered height, read off the
  // real DOM box rather than hand-computed from tokens, so it can never
  // drift out of sync with a later CSS tweak to the bar's padding. Drives
  // the sticky shelf headers' own top offset (see the PUBLIC block of
  // styles.css) so the two can never disagree about where the obstruction
  // ends, compressed or not. --topbar-fold-reserve is a SEPARATE property,
  // frozen from this same first reading: the page always starts unscrolled
  // (so the bar is always expanded at mount), and that first height is
  // what the hero's own padding-top must reserve permanently, never
  // updated again as the bar later shrinks on scroll, or a reader who
  // scrolls down and back up would see the hero's padding visibly chase
  // the compressing bar. The 44px fallback (used before the first
  // observer callback runs, and forever on an engine with no
  // ResizeObserver) is not a guess: it is the bar's own designed height at
  // zero vertical padding, so the fallback and the measured value agree.
  let topbarFoldReserveSet = false;
  function measureTopbar(height) {
    const h = `${Math.ceil(height)}px`;
    document.documentElement.style.setProperty('--topbar-h', h);
    if (!topbarFoldReserveSet) {
      document.documentElement.style.setProperty('--topbar-fold-reserve', h);
      topbarFoldReserveSet = true;
    }
  }
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver((entries) => measureTopbar(entries[0].target.getBoundingClientRect().height)).observe(topbar);
  } else {
    measureTopbar(44);
  }

  const header = el('header', { class: 'panel pub-header' },
    heroBg,
    el('img', { class: 'logo', src: 'design-system/assets/kaipability-logo-lockup.png', alt: 'Kaipability' }),
    el('h1', { class: 'pub-hero-headline' }, 'The free software directory for small business.'),
    heroSubline,
    savingsTicker,
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
    // Phase 15.4: the house CTA's drift/pulse/sheen are an ambient loop, not
    // the old bounded one-shot pulse, so no no-replay guard is needed here
    // any more: display:none on entryPaths already stops every animation on
    // this subtree outright (a hidden element runs no CSS animation), and
    // restoring it in showWaysInBand() below correctly resumes the loop from
    // its own beginning, which is the desired behaviour for an ambient
    // treatment, not a bug to guard against.
    entryPaths.hidden = true;
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
  // Title and Expand all, a single row (fits one line together down to
  // 375px). Phase 16 retires the second row this header used to carry
  // (Plain English and the theme toggle): both moved into the hero utility
  // bar above, per PRD section 16 amended layout item 1, so this is the
  // whole shelf-band header once again.
  const shelfBandTopRow = el('div', { class: 'pub-shelf-band-top' },
    el('h2', { class: 'pub-shelf-band-title' }, 'Browse all tools'),
    expandAllBtn,
  );
  const shelfBandHeader = el('div', { class: 'pub-shelf-band-header' },
    shelfBandTopRow,
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
    // The sticky rule is entirely CSS, keyed off aria-expanded above; the
    // is-stuck shadow class is IntersectionObserver-driven (see the sentinel
    // wiring in buildShelves) and would otherwise linger from a scroll
    // position reached before this collapse. Harmless either way since the
    // CSS gates the shadow on aria-expanded="true" too, but a header should
    // never carry it while collapsed.
    if (!open) shelf.headerBtn.classList.remove('is-stuck');
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
      count/chevron the plain heading never had): buildCardSections()
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
      // Phase 15.5, PRD section 16 amended: while stuck, a visible "Close"
      // hint beside the chevron makes the tap-to-collapse affordance
      // explicit rather than implied. Part of the button itself (not a
      // sibling control), so the hit target is unchanged; the CSS below
      // hides it unless the header is both expanded and stuck. No
      // aria-label change: aria-expanded already announces the state to
      // assistive tech, this is a purely visual affordance for sighted
      // pointer/touch use.
      const closeHint = el('span', { class: 'pub-shelf-close-hint', 'aria-hidden': 'true' }, 'Close');
      const headerBtn = el('button', {
        class: 'pub-shelf-header', type: 'button',
        'aria-expanded': 'false', 'aria-controls': gridId,
      },
        categoryIcon(category),
        el('span', { class: 'pub-shelf-name' }, category),
        el('span', { class: 'pub-shelf-count' }, `· ${count} tool${count === 1 ? '' : 's'}`),
        closeHint,
        chevronIcon(),
      );
      // Sticky-header shadow detection (Phase 15.4): a zero-height sentinel
      // placed immediately before the header. The sticky pin itself is pure
      // CSS, keyed off aria-expanded; this observer only toggles the
      // separation shadow once the header is actually pinned rather than
      // sitting at its normal in-flow position. One tiny, passive observer
      // per shelf, disconnected never (shelves live for the page's whole
      // lifetime); each fires on scroll only, no rAF loop, no polling.
      const sentinel = el('div', { class: 'pub-shelf-sentinel', 'aria-hidden': 'true' });
      const section = el('section', { class: 'pub-shelf', id: `cat-${slug}` },
        sentinel,
        el('h2', { class: 'pub-shelf-heading' }, headerBtn),
        grid,
      );
      const shelf = {
        category, section, headerBtn, grid,
        toolIds: new Set(toolsInCat.map((t) => t.id)),
        manualOpen: false,
      };
      headerBtn.addEventListener('click', () => {
        // Phase 15.5 (PRD section 16 amended, "Collapse must land you back
        // in the list"): read is-stuck BEFORE the toggle, since setShelfOpen
        // clears it as part of an ordinary collapse. A stuck header at click
        // time is the honest signal the reader scrolled deep into a tall
        // shelf; closing that collapse must scroll them back to the
        // header, or the content that used to sit below the shelf (the FAQ
        // section, for the last shelves) slides up under their thumb while
        // the scroll position stays put in document coordinates. An
        // ordinary, never-stuck collapse (a tap at the top of the shelf)
        // must never scroll: `wasStuck` guards exactly that, so top-of-shelf
        // taps stay pixel-identical to before this fix.
        const wasStuck = headerBtn.classList.contains('is-stuck');
        const closing = !shelf.grid.hidden;
        setShelfOpen(shelf, shelf.grid.hidden, true);
        syncExpandAllLabel();
        if (wasStuck && closing) {
          headerBtn.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
        }
      });
      if (typeof IntersectionObserver === 'function') {
        new IntersectionObserver(([entry]) => {
          // !entry.isIntersecting alone is directionless: it is equally true
          // for a sentinel scrolled ABOVE the viewport (genuinely stuck) and
          // for one still BELOW it (an open shelf further down the page the
          // reader has not scrolled to yet), which would have shown the
          // is-stuck shadow, and now the more prominent Close hint (Phase
          // 15.5), on a shelf nobody had scrolled past at all. Comparing the
          // sentinel's own top edge against the root's disambiguates: only
          // "above the visible area" counts as stuck. rootBounds can be null
          // if the browser has not run layout yet; falling back to 0
          // (viewport top) keeps the same "above zero" comparison.
          const rootTop = entry.rootBounds ? entry.rootBounds.top : 0;
          const scrolledPast = !entry.isIntersecting && entry.boundingClientRect.top < rootTop;
          headerBtn.classList.toggle('is-stuck', scrolledPast);
        }, { threshold: 0 }).observe(sentinel);
      }
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
     the persona packs just above. */
  const faqSection = el('section', { class: 'pub-faq', id: 'faq', 'aria-label': 'Frequently asked questions', hidden: true });
  loadFaqSection(faqSection);

  /* --- payment links (docs/PAYMENTS.md section 4, PRD-adjacent Phase 13.1)
     Public directory footer only: js/payments.js is the one place a
     provider URL may live, and an empty url there means the matching
     element below is simply never built, not hidden with CSS. el()'s own
     null-child skip (js/data-loader.js) is what makes that "not built"
     invisible at the call site too: a null passed into the footer's
     children below is dropped, so shipping both urls empty (this wave's
     state) leaves the footer byte-for-byte what it was before this file
     existed, no empty paragraph, no stray separator. The trust sentence
     (trust rule 1 made visible) only exists when at least one link does:
     a sentence about payments that are not there yet would read as noise. */
  const tipLine = PAYMENT_LINKS.tip.url
    ? el('p', { class: 't-meta pub-footer-payment' },
        'Free forever. If it saved you money, ',
        el('a', { href: PAYMENT_LINKS.tip.url, target: '_blank', rel: 'noopener noreferrer' }, PAYMENT_LINKS.tip.label),
        '.',
      )
    : null;
  const auditLine = PAYMENT_LINKS.audit.url
    ? el('p', { class: 't-meta pub-footer-payment' },
        'Or ',
        el('a', { href: PAYMENT_LINKS.audit.url, target: '_blank', rel: 'noopener noreferrer' }, PAYMENT_LINKS.audit.label),
        '.',
      )
    : null;
  const paymentTrustLine = (tipLine || auditLine)
    ? el('p', { class: 't-meta pub-footer-payment-trust' },
        'Payments support the site and buy Kaipability’s time. They never affect which tools are listed.',
      )
    : null;

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
      // Payment links (docs/PAYMENTS.md section 4, Phase 13.1): tipLine,
      // auditLine and paymentTrustLine are all built above as null when
      // their url is empty, and el()'s null-child skip means a null here
      // adds nothing to the DOM at all, not an empty or hidden node.
      tipLine,
      auditLine,
      paymentTrustLine,
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
      // below the existing lines rather than replacing any of them. Phase
      // 16 adds Changelog: the "Recently updated" strip removed from this
      // page (Rocky, 2 Aug) becomes its own linked page rather than
      // vanishing outright.
      el('p', { class: 't-meta pub-footer-legal' },
        el('a', { href: '/privacy.html' }, 'Privacy'), ' · ',
        el('a', { href: '/contact.html' }, 'Contact'), ' · ',
        el('a', { href: '/faq.html' }, 'FAQ'), ' · ',
        el('a', { href: '/changelog.html' }, 'Changelog'), ' · ',
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
  // topbar is a sibling of `header`, never a child of it (see heroNav's own
  // comment above): position: fixed does not care where in the DOM it
  // lives, only that no ancestor establishes a containing block for it, so
  // it is mounted first here purely for readable source order, top of page
  // to bottom. heroEndSentinel sits immediately after `header`, the
  // boundary the compress observer watches.
  root.replaceChildren(topbar, header, heroEndSentinel, entryPaths, discoverMount, shelfBand, faqSection, footer);
  document.title = 'Free Stack · Kaipability';

  handleHashDeepLink();
  window.addEventListener('hashchange', handleHashDeepLink);

  // Hero and entry paths reveal once, on mount (motion inventory item 1):
  // static content, never rebuilt after this.
  const reduced = prefersReducedMotion();
  [header, discoverItem, personaItem].forEach((node, i) => revealFirstPaint(node, i, reduced));
  // Savings ticker count-up (Phase 17): fires once here, on mount, after
  // `reduced` above is known; never re-triggered by any later redraw (a
  // plainMode toggle rebuilds the shelves, never the header).
  animateFigure(toolCountEl, active.length, reduced, { delayMs: 0 });
  animateFigure(savingsAmountEl, savingsCeiling, reduced, { delayMs: FACT_STAGGER_MS, format: money });
  animateFigure(coffeeCountEl, savingsCoffees, reduced,
    { delayMs: FACT_STAGGER_MS * 2, format: (n) => n.toLocaleString('en-GB') });

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
    leaves the Discover entry path fully usable, same tolerance the FAQ
    slot has. Choosing a pack filters the shelves to that pack's ids (via
    the same applyFilter() the search box calls); it never navigates away.
    A second click on the active chip clears the filter.
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

/** Homepage FAQ slot (PRD section 16 item 5, filled in wave 14.3b): the ten
    site-level Q&As from data/faq.json, generated by scripts/build-seo.mjs
    from the same PRD section 18 canonical text as faq.html. Fetched
    separately from tools.json, non-blocking, same tolerance as
    loadPersonaPacks above: a missing or broken file leaves the slot
    hidden, never an error and never a blocked directory. Each Q&A renders
    as its own native <details>/<summary> ("as native details/summary
    items", not one details wrapping a list), so the content sits in the
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
