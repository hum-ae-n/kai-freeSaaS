#!/usr/bin/env node
/**
 * Browser smoke test: serves the repo, drives both modes in headless Chromium.
 * Run: node scripts/smoke-test.mjs
 *
 * Needs Playwright, which this repo deliberately does not depend on. It is
 * resolved from PLAYWRIGHT_DIR (a directory whose node_modules contains
 * playwright) or from a sibling checkout of kaipability-services. External
 * hosts (fonts, favicon proxies) are blocked so the test is deterministic
 * offline; favicon rendering itself is therefore NOT covered here.
 */
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { PRIVACY_NOTICE } from '../js/my/copy.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_DIR,
    join(ROOT, '..', 'kaipability-services'),
    ROOT,
  ].filter(Boolean);
  for (const dir of candidates) {
    try {
      return createRequire(pathToFileURL(join(dir, 'node_modules', 'x.js')))('playwright');
    } catch { /* try next */ }
  }
  console.error('Playwright not found. Set PLAYWRIGHT_DIR to a project that has it installed.');
  process.exit(2);
}
const { chromium } = loadPlaywright();

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

/* When set, /data/tools.json is served with the given tool ids marked
   archived, so archived rendering is testable without touching the repo data. */
let archiveIds = null;

const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const file = normalize(join(ROOT, path === '/' ? 'index.html' : path));
  try {
    let body = await readFile(file);
    if (archiveIds && path === '/data/tools.json') {
      const tools = JSON.parse(body.toString('utf8'));
      for (const t of tools) if (archiveIds.has(t.id)) t.archived = true;
      body = Buffer.from(JSON.stringify(tools));
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    // SPA fallback, mirroring the netlify.toml redirect: unknown paths
    // (/x above all) serve index.html, real files always win first.
    try {
      const index = await readFile(join(ROOT, 'index.html'));
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(index);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  }
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

/* Expected counts come from the data itself, so adding or archiving tools
   never breaks the suite; the suite checks the app agrees with the data. */
const allTools = JSON.parse(await readFile(join(ROOT, 'data', 'tools.json'), 'utf8'));
const active = allTools.filter((t) => !t.archived);
const activeCore = active.filter((t) => t.type === 'core').length;
const activeCategories = new Set(active.map((t) => t.category)).size;

const browser = await chromium.launch();
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/net::|Failed to load resource/.test(m.text())) pageErrors.push(m.text()); });
await page.route(/^(?!.*localhost).*$/, (route) => route.abort());

/* --- public directory at the root (batch I) -------------------------------- */
/* Phase 14.1 adaptation, applies to every occurrence below: with the compact
   landing (PRD section 16 amended), every category shelf starts collapsed,
   so no .tool-card is ever visible without either expanding a shelf or
   searching/filtering to force one open. The readiness gate below (and
   every other waitForSelector('#public-root .tool-card') in this file)
   therefore waits for the card to be attached to the DOM rather than
   Playwright's default "visible", which is exactly the property the shelf
   redesign's DOM-superset rule (nothing lazily fetched, deferred or
   removed) actually guarantees. Tests further down that need to interact
   with a specific card (hover, click) separately expand the relevant shelf
   first, noted at each call site. */
await page.goto(`${base}/`);
await page.waitForSelector('#public-root .tool-card', { state: 'attached' });
check(`public: all ${active.length} active tools as cards`, await page.locator('#public-root .tool-card').count() === active.length);
check('public: indexable, no robots meta', await page.locator('meta[name=robots]').count() === 0);
check('public: trust line and CTA present',
  (await page.textContent('#public-root')).includes('No affiliates')
  && (await page.textContent('#public-root')).includes('Talk to Kaipability'));

/* --- Phase 15: hero utility nav (PRD section 16 amended, layout item 1) ---
   My Stack and FAQ links inside .pub-header, each at least 44px tall (the
   site-wide touch-target rule), present without moving the pinned
   first-shelf budget below (that budget's own check, further down, already
   proves the number itself; this just confirms the nav did not regress
   it). */
const heroNavLinks = page.locator('.pub-header .pub-hero-nav a');
check('homepage: hero utility nav links to /my and /faq.html', await heroNavLinks.count() === 2
  && (await heroNavLinks.nth(0).getAttribute('href')) === '/my'
  && (await heroNavLinks.nth(1).getAttribute('href')) === '/faq.html');
const heroNavBoxes = await heroNavLinks.evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().height));
// Sub-pixel tolerance: getBoundingClientRect() on this inline-flex row can
// report 43.999996 for a CSS min-height:44px box (observed on this exact
// build), a float-rounding artefact rather than a real sub-44px target;
// the same 0.1px tolerance a device's own physical pixel grid would round
// away.
check('homepage: hero utility nav links are each at least 44px tall',
  heroNavBoxes.every((h) => h >= 43.9), heroNavBoxes.join(','));

/* --- Phase 15: footer good-practice block (PRD section 16 amended, layout
   item 6) -------------------------------------------------------------- */
const footerHtml = await page.locator('.pub-footer').innerHTML();
check('homepage: footer links to /privacy.html and /contact.html',
  footerHtml.includes('href="/privacy.html"') && footerHtml.includes('href="/contact.html"'));
const footerOutboundLinks = await page.locator('.pub-footer a[href^="https://kaipability.com"], .pub-footer a[href^="https://www.airl.io"]').all();
const footerOutboundRels = await Promise.all(footerOutboundLinks.map((a) => a.getAttribute('rel')));
check('homepage: footer carries outbound links to kaipability.com and www.airl.io, all rel=noopener noreferrer',
  footerOutboundLinks.length >= 2 && footerOutboundRels.every((r) => r === 'noopener noreferrer'),
  footerOutboundRels.join('|'));

await page.fill('#public-root input[type=search]', 'canva');
// Wave 14.2: the redraw is now debounced and runs inside the guarded View
// Transition helper (motion inventory item 3), so polling for the settled
// state replaces a fixed sleep guess (see FILTER_VT_DEBOUNCE_MS in
// js/public.js). applyFilter toggles `hidden` on the card-grid <li>, not on
// .tool-card itself, so that is what this polls.
await page.waitForFunction((total) => document.querySelectorAll('#public-root .card-grid > li:not([hidden])').length < total, active.length);
const publicFiltered = await page.locator('#public-root .tool-card:visible').count();
check('public: search filters cards', publicFiltered > 0 && publicFiltered < active.length, `visible=${publicFiltered}`);
check('public: recently-updated strip renders', await page.locator('.pub-changelog, [class*=changelog]').count() >= 1);
await page.fill('#public-root input[type=search]', '');
await page.waitForFunction(() => document.querySelectorAll('#public-root .card-grid > li[hidden]').length === 0);

/* --- Phase 12.1: redesigned public homepage (PRD section 16) --------------
   Robots meta and the CSP hash set are already exercised by the checks
   above and by the csp: block further down respectively; this wave adds no
   inline script, so those existing checks are the extension the task calls
   for. The rest below is net new: the hero's live count, the three entry
   paths and their order, the Discover stub's scroll (never a dead end
   before js/discover.js exists), persona chips composing with the rest of
   the filter state, and the reduced-motion reveal contract. */
const heroCountText = await page.locator('.pub-hero-count').textContent();
check('homepage: hero count equals the active tools.json count',
  heroCountText.includes(String(active.length)), heroCountText.trim());

// Phase 14.1 adaptation: PRD section 16 as amended retires the "Browse all"
// entry card, its job passing to the shelf band's own Expand all / Collapse
// all toggle, so only Discover and Persona packs remain in the ways-in
// band. It also retires the padded-card treatment (and its per-item <h2>)
// in favour of a lean pitch line, per the amended spec's "button plus
// one-line pitch": the readiness signal is now the pitch text itself.
const entryPitches = await page.locator('.pub-entry-item .pub-entry-pitch').allTextContents();
check('homepage: two entry paths present, Discover first',
  entryPitches.length === 2
  && entryPitches[0].startsWith('Discover:')
  && entryPitches[1].toLowerCase().includes('shortlist'),
  entryPitches.join(' | '));

const beforeScrollY = await page.evaluate(() => window.scrollY);
await page.locator('[data-discover-entry]').click();
await page.waitForTimeout(300);
const afterDiscoverScrollY = await page.evaluate(() => window.scrollY);
check('homepage: Discover stub scrolls to the browse list instead of dead-ending',
  afterDiscoverScrollY > beforeScrollY, `before=${beforeScrollY} after=${afterDiscoverScrollY}`);
await page.evaluate(() => window.scrollTo(0, 0));

// Phase 14.1 adaptation: with all shelves collapsed by default, ZERO cards
// are visible before any filter is applied (there is no longer a
// meaningful "before" visible count to compare against, since a persona
// chip no longer removes cards from the DOM at all: shelf mechanics keep
// every card attached, only its `hidden` IDL property changes, per the
// DOM-superset rule). The assertion is rephrased as "a proper, non-empty
// subset of the full catalogue is visible", which is what "filters the
// browse list" now means; the plain .count() this used to read would
// return 89 unconditionally today, so it is replaced with :visible.
await page.waitForSelector('.pub-persona-chip');
await page.locator('.pub-persona-chip').first().click();
// Wave 14.2: a discrete click, wrapped in the guarded View Transition
// helper (motion inventory item 3, no debounce for a click); polled rather
// than slept, same reasoning as the search box above.
await page.waitForFunction((total) => document.querySelectorAll('#public-root .card-grid > li:not([hidden])').length < total, active.length);
const chipFilteredCount = await page.locator('#public-root .tool-card:visible').count();
check('homepage: a persona chip filters the browse list',
  chipFilteredCount > 0 && chipFilteredCount < active.length, `visible=${chipFilteredCount} total=${active.length}`);
await page.locator('.pub-persona-chip').first().click(); // toggle back off
await page.waitForFunction(() => document.querySelectorAll('#public-root .card-grid > li[hidden]').length === 0);
// Clearing restores the collapsed default (PRD section 16, "Shelf
// mechanics": "Clearing restores the collapsed state"), which is zero
// *visible* cards, not all 89: the pre-Phase-14.1 behaviour of showing
// every card again no longer applies once shelves exist. The plain
// .count() (all 89 always attached) is still checked to confirm nothing
// was actually removed from the DOM.
const chipClearedVisible = await page.locator('#public-root .tool-card:visible').count();
const chipClearedAttached = await page.locator('#public-root .tool-card').count();
check('homepage: a second click on the active persona chip clears the filter and restores collapsed shelves',
  chipClearedVisible === 0 && chipClearedAttached === active.length,
  `visible=${chipClearedVisible} attached=${chipClearedAttached}`);

const homeMobile = await browser.newPage({ viewport: { width: 375, height: 812 } });
await homeMobile.route(/^(?!.*localhost).*$/, (route) => route.abort());
await homeMobile.goto(`${base}/`);
await homeMobile.waitForSelector('#public-root .tool-card', { state: 'attached' });
const homeMobileScrollW = await homeMobile.evaluate(() => document.documentElement.scrollWidth);
check('homepage: no horizontal scroll at 375px', homeMobileScrollW <= 375, `scrollWidth=${homeMobileScrollW}`);
// Phase 14.1 adaptation: two entry paths now, not three, and the readiness
// signal is the pitch text (see the entryPitches note above, same reason).
const homeMobilePitches = await homeMobile.locator('.pub-entry-item .pub-entry-pitch').allTextContents();
check('homepage: entry paths still Discover-first at 375px',
  homeMobilePitches[0]?.startsWith('Discover:') && homeMobilePitches[1]?.toLowerCase().includes('shortlist'),
  homeMobilePitches.join(' | '));
await homeMobile.close();

// Phase 14.1: shared helper, used throughout the rest of this file. Every
// card lives inside a collapsed shelf by default (PRD section 16 amended,
// "Shelf mechanics"), so any test that needs to hover, click or measure a
// specific card first has to open its shelf. Expand all is the simplest
// reliable way to do that regardless of which card a given test needs.
//
// Wave 14.2 adaptation: Expand all now runs its DOM mutation inside the
// guarded View Transition helper (motion inventory item 3), whose update
// callback is NOT invoked synchronously with the click (confirmed
// empirically: one to two animation frames later, not a fixed bound under
// load). Polled with waitForFunction, not a fixed sleep, so this never
// flakes under a slower run.
async function expandAllShelves(pg) {
  await pg.locator('.pub-expand-all').click();
  await pg.waitForFunction(() => document.querySelectorAll('.pub-shelf-grid[hidden]').length === 0);
}

// The hover lift is set on the card-grid <li>, never on .tool-card itself:
// a "both" fill-mode keyframe animation (the CLIENT block's existing
// entrance effect on .tool-card) permanently holds that element's
// transform property once it finishes, which silently defeats any later
// hover-triggered transition on the same element and property. Confirmed
// in isolation while building this wave; this check is the regression
// guard against it recurring.
const hoverPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await hoverPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await hoverPage.goto(`${base}/`);
await hoverPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
// Phase 14.1 adaptation: the first card lives inside a collapsed shelf, so
// it must be expanded before it can be hovered at all.
await expandAllShelves(hoverPage);
const firstCardLi = hoverPage.locator('#public-root .card-grid > li').first();

// Regression guard: revealFirstPaint used to leave its inline entrance
// transition-delay set forever, which (transition-delay being a single CSS
// property, not scoped to the reveal transition alone) also delayed the
// hover-lift transition on this same element by however many milliseconds
// the entrance stagger had assigned it. Phase 14.1 adaptation: cards no
// longer carry any entrance reveal at all (the per-category card reveal is
// retired along with the flat list it revealed; see js/public.js's file
// banner), so this now simply confirms no stray inline delay was ever set,
// with no need to wait for an entrance transition that no longer exists.
//
// Wave 14.2 adaptation: Expand all now legitimately sets a transient
// transitionDelay on the first six cards of every shelf it opens (the new
// shelf-expansion stagger, motion inventory item 2), self-cleaning on
// transitionend. That is not the regression this check guards against
// (a delay left behind forever); this wait lets the stagger's own 300ms
// transition and cleanup finish first, so the assertion below is back to
// checking for a truly residual, un-cleaned-up value.
await hoverPage.waitForTimeout(500);
const leftoverDelay = await firstCardLi.evaluate((n) => ({
  inline: n.style.transitionDelay,
  computed: getComputedStyle(n).transitionDelay,
}));
check('homepage: shelf cards carry no residual inline transition-delay',
  leftoverDelay.inline === '' && /^(0s(, 0s)*)$/.test(leftoverDelay.computed), JSON.stringify(leftoverDelay));

await firstCardLi.scrollIntoViewIfNeeded();
await firstCardLi.hover();
await hoverPage.waitForTimeout(300);
const hoverTransform = await firstCardLi.evaluate((n) => getComputedStyle(n).transform);
check('homepage: hover lift actually translates the card (not silently blocked by any entrance animation)',
  hoverTransform !== 'none' && hoverTransform !== 'matrix(1, 0, 0, 1, 0, 0)', hoverTransform);
await hoverPage.close();

/* --- Phase 12.1 regression, adapted for Phase 14.1's shelf architecture ---
   revealSections used to call revealOnIntersect unconditionally for every
   category past the first on every draw(), including redraws triggered by
   search keystrokes and persona-chip clicks. A freshly rebuilt heading that
   was already on screen got handed a brand new IntersectionObserver, which
   fired immediately and re-ran the entrance (opacity 1 -> 0 -> back to 1)
   on every keystroke.

   Phase 14.1 adaptation: that regression class is now structurally
   impossible, not merely fixed. draw() (now applyFilter()) no longer
   rebuilds any shelf or card DOM on a keystroke or a persona-chip click; it
   only toggles `hidden` on already-built nodes (see js/public.js's file
   banner). There is no more per-category opacity reveal to poll for at all
   (.cli-category does not even render inside #public-root any more: the
   shelf header replaces it, see the PUBLIC block of styles.css). The
   equivalent, honest regression guard for the new architecture is a
   DOM-identity check: mark a shelf header with a throwaway data attribute,
   then confirm the exact same node (not a rebuilt lookalike) still carries
   it after a search keystroke and after a persona-chip round trip. */
const categoryOrder = [];
for (const t of active) { if (!categoryOrder.includes(t.category)) categoryOrder.push(t.category); }
const targetCategory = categoryOrder[1] ?? categoryOrder[0];

const noRefirePage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await noRefirePage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await noRefirePage.goto(`${base}/`);
await noRefirePage.waitForSelector('#public-root .tool-card', { state: 'attached' });
const targetShelfHeader = noRefirePage.locator('.pub-shelf-header', { hasText: targetCategory }).first();
await targetShelfHeader.scrollIntoViewIfNeeded();
await targetShelfHeader.evaluate((n) => { n.dataset.stabilityMarker = 'kept'; });

// The search term must be broad, deliberately, so many shelves (including
// the marked one) stay in the matched set.
await noRefirePage.locator('#public-root input[type=search]').pressSequentially('a', { delay: 20 });
await noRefirePage.waitForTimeout(300);
const markerAfterSearch = await targetShelfHeader.evaluate((n) => n.dataset.stabilityMarker).catch(() => null);
check('homepage: typing into search never rebuilds shelf DOM (no per-keystroke section recreation)',
  markerAfterSearch === 'kept', `marker=${markerAfterSearch} category="${targetCategory}"`);

await noRefirePage.locator('#public-root input[type=search]').fill('');
await noRefirePage.waitForTimeout(200);

// Same assertion for the persona-chip filter path: toggling a pack on and
// off must not rebuild the shelf either.
const chip = noRefirePage.locator('.pub-persona-chip-row button').first();
let markerAfterChip = 'kept';
if (await chip.count()) {
  await chip.click();
  await noRefirePage.waitForTimeout(150);
  await chip.click(); // clear the pack
  await noRefirePage.waitForTimeout(150);
  markerAfterChip = await targetShelfHeader.evaluate((n) => n.dataset.stabilityMarker).catch(() => null);
}
check('homepage: persona-chip toggle never rebuilds shelf DOM (no section recreation)',
  markerAfterChip === 'kept', `marker=${markerAfterChip}`);
await noRefirePage.close();

const reducedMotionPage = await browser.newPage();
await reducedMotionPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await reducedMotionPage.emulateMedia({ reducedMotion: 'reduce' }); // set before goto, matchMedia is read at first render
await reducedMotionPage.goto(`${base}/`);
await reducedMotionPage.waitForSelector('.pub-reveal-reduced');
const revealTransitionProp = await reducedMotionPage.locator('.pub-reveal-reduced').first()
  .evaluate((node) => getComputedStyle(node).transitionProperty);
check('homepage: reduced motion reveal elements carry no transform in their transition',
  !revealTransitionProp.includes('transform'), revealTransitionProp);
const reducedMotionClassCount = await reducedMotionPage.locator('.pub-reveal').count();
check('homepage: reduced motion never applies the transform-bearing reveal class', reducedMotionClassCount === 0, `count=${reducedMotionClassCount}`);

// Discover button emphasis (motion inventory item 8, PRD section 16
// amended, Phase 15): under reduced motion, no pulse animation and no
// transform response on hover.
const reducedDiscoverAnim = await reducedMotionPage.locator('.pub-discover-btn').first()
  .evaluate((node) => getComputedStyle(node).animationName);
check('homepage: Discover button carries no animation under reduced motion', reducedDiscoverAnim === 'none', reducedDiscoverAnim);
await reducedMotionPage.hover('.pub-discover-btn');
const reducedDiscoverHoverTransform = await reducedMotionPage.locator('.pub-discover-btn').first()
  .evaluate((node) => getComputedStyle(node).transform);
check('homepage: Discover button has no transform on hover under reduced motion',
  reducedDiscoverHoverTransform === 'none', reducedDiscoverHoverTransform);
await reducedMotionPage.close();

// Same button, normal motion: a finite, bounded pulse sequence, never
// 'infinite' anywhere on this element (motion inventory item 8's own
// explicit ban).
const discoverAnimInfo = await page.locator('.pub-discover-btn').first()
  .evaluate((node) => {
    const cs = getComputedStyle(node);
    return { name: cs.animationName, iterationCount: cs.animationIterationCount };
  });
check('homepage: Discover button pulse animation is present and has a finite iteration count (never infinite)',
  discoverAnimInfo.name !== 'none' && discoverAnimInfo.iterationCount !== 'infinite' && !Number.isNaN(Number(discoverAnimInfo.iterationCount)),
  JSON.stringify(discoverAnimInfo));

/* --- Phase 14.1: shelf mechanics (PRD section 16 amended, "compact
   landing") ---------------------------------------------------------------
   BUILD-PLAN 14.1's named checks: collapsed page-height budgets at both
   widths, all 89 cards attached with every shelf collapsed, a single
   shelf's expand/collapse round trip plus Expand all / Collapse all,
   aria-expanded truthfulness, 44px shelf headers at 375px, search
   force-open and restore, a #cat- deep link, and tool id 0 findable both by
   search and by its own shelf. */
function slugifyForTest(text) {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
const tool0 = active.find((t) => t.id === 0);
const tool0Slug = slugifyForTest(tool0.category);

// Height budgets, both widths, all shelves collapsed (the default state on
// a fresh load, before anything is clicked).
for (const [width, budget] of [[375, 3200], [1280, 2200]]) {
  const budgetPage = await browser.newPage({ viewport: { width, height: 900 } });
  const budgetErrors = [];
  budgetPage.on('pageerror', (e) => budgetErrors.push(String(e)));
  budgetPage.on('console', (m) => { if (m.type() === 'error' && !/net::|Failed to load resource/.test(m.text())) budgetErrors.push(m.text()); });
  await budgetPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
  await budgetPage.goto(`${base}/`);
  await budgetPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
  await budgetPage.waitForTimeout(500);
  const pageHeight = await budgetPage.evaluate(() => document.documentElement.scrollHeight);
  const collapsedGridCount = await budgetPage.locator('.pub-shelf-grid[hidden]').count();
  const totalShelfCount = await budgetPage.locator('.pub-shelf').count();
  check(`shelf: page height at ${width}px is within the ${budget}px budget with all shelves collapsed`,
    pageHeight <= budget && collapsedGridCount === totalShelfCount,
    `height=${pageHeight} collapsedGrids=${collapsedGridCount}/${totalShelfCount}`);
  check(`shelf: no page errors at ${width}px`, budgetErrors.length === 0, budgetErrors.join(' | ').slice(0, 300));
  await budgetPage.close();
}

// The missing half of BUILD-PLAN 14.1's named height-budget check: "the
// search input and first shelf header top against the 812 viewport". This
// asserts the achieved contract at the literal 375x812 reference; if that
// number is ever renegotiated (verifier fix round, PRD section 16 amended,
// "first shelf rows visible within the first mobile viewport"), the
// constant moves with the spec, not silently in this file alone.
const foldPage = await browser.newPage({ viewport: { width: 375, height: 812 } });
await foldPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await foldPage.goto(`${base}/`);
await foldPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
await foldPage.waitForSelector('.pub-search');
await foldPage.waitForSelector('.pub-shelf-header');
await foldPage.waitForTimeout(400);
const FIRST_VIEWPORT = 812;
// PRD section 16's reconciled budget (BUILD-PLAN changelog, 31 Jul): the
// search input sits inside the 812px viewport; the first shelf header's top
// is at most 880px, since the mandated hero trust signals and ways-in band
// honestly occupy most of the first screen (measured 863px as built).
const FIRST_SHELF_BUDGET = 880;
const searchBox = await foldPage.locator('.pub-search').boundingBox();
const firstShelfHeaderBox = await foldPage.locator('.pub-shelf-header').first().boundingBox();
// Playwright's boundingBox() returns {x, y, width, height}, not the DOM
// getBoundingClientRect() shape ({top, left, ...}): .y is the vertical
// offset from the viewport's top edge, exactly what "within the first
// viewport" needs to compare against its height.
const searchTop = searchBox ? searchBox.y : null;
const firstShelfHeaderTop = firstShelfHeaderBox ? firstShelfHeaderBox.y : null;
check('shelf: the search input sits within the first 375x812 mobile viewport',
  searchTop !== null && searchTop <= FIRST_VIEWPORT, `searchTop=${searchTop}`);
check('shelf: the first shelf header top is within the reconciled 880px budget at 375x812',
  firstShelfHeaderTop !== null && firstShelfHeaderTop <= FIRST_SHELF_BUDGET, `firstShelfHeaderTop=${firstShelfHeaderTop}`);
await foldPage.close();

// All 89 active cards present in the DOM with shelves collapsed (the "all X
// active tools as cards" check at the very top of this file already covers
// the count; this makes the "collapsed" half explicit).
const shelfMechPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await shelfMechPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await shelfMechPage.goto(`${base}/`);
await shelfMechPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
const collapsedCardCount = await shelfMechPage.locator('#public-root .tool-card').count();
const collapsedVisibleCount = await shelfMechPage.locator('#public-root .tool-card:visible').count();
check('shelf: all 89 active cards are attached to the DOM with every shelf collapsed',
  collapsedCardCount === active.length && collapsedVisibleCount === 0,
  `attached=${collapsedCardCount} visible=${collapsedVisibleCount}`);

// Shelf expand/collapse round trip on a single header, checking
// aria-expanded truthfulness (the attribute actually matches the grid's
// real hidden state) at each step.
const firstShelfHeader = shelfMechPage.locator('.pub-shelf-header').first();
const firstShelfGridId = await firstShelfHeader.getAttribute('aria-controls');
await firstShelfHeader.click();
await shelfMechPage.waitForTimeout(50);
const afterOpen = await shelfMechPage.evaluate((gridId) => {
  const grid = document.getElementById(gridId);
  const header = grid.closest('.pub-shelf').querySelector('.pub-shelf-header');
  return { hidden: grid.hidden, ariaExpanded: header.getAttribute('aria-expanded') };
}, firstShelfGridId);
check('shelf: clicking a header opens its shelf and sets aria-expanded truthfully',
  afterOpen.hidden === false && afterOpen.ariaExpanded === 'true', JSON.stringify(afterOpen));
await firstShelfHeader.click();
await shelfMechPage.waitForTimeout(50);
const afterClose = await shelfMechPage.evaluate((gridId) => {
  const grid = document.getElementById(gridId);
  const header = grid.closest('.pub-shelf').querySelector('.pub-shelf-header');
  return { hidden: grid.hidden, ariaExpanded: header.getAttribute('aria-expanded') };
}, firstShelfGridId);
check('shelf: clicking the same header again closes it and sets aria-expanded truthfully',
  afterClose.hidden === true && afterClose.ariaExpanded === 'false', JSON.stringify(afterClose));

// Expand all / Collapse all round trip. Polled, not slept: see
// expandAllShelves's own comment on the guarded View Transition's
// scheduling delay (Wave 14.2, motion inventory item 3).
await shelfMechPage.locator('.pub-expand-all').click();
await shelfMechPage.waitForFunction(() => document.querySelectorAll('.pub-shelf-grid[hidden]').length === 0);
const stillHiddenAfterExpandAll = await shelfMechPage.locator('.pub-shelf-grid[hidden]').count();
const labelAfterExpandAll = await shelfMechPage.locator('.pub-expand-all').textContent();
check('shelf: Expand all opens every shelf',
  stillHiddenAfterExpandAll === 0 && labelAfterExpandAll === 'Collapse all',
  `stillHidden=${stillHiddenAfterExpandAll} label="${labelAfterExpandAll}"`);
await shelfMechPage.locator('.pub-expand-all').click();
await shelfMechPage.waitForFunction(() => document.querySelectorAll('.pub-shelf-grid:not([hidden])').length === 0);
const stillOpenAfterCollapseAll = await shelfMechPage.locator('.pub-shelf-grid:not([hidden])').count();
const labelAfterCollapseAll = await shelfMechPage.locator('.pub-expand-all').textContent();
check('shelf: Collapse all round-trips back to fully collapsed',
  stillOpenAfterCollapseAll === 0 && labelAfterCollapseAll === 'Expand all',
  `stillOpen=${stillOpenAfterCollapseAll} label="${labelAfterCollapseAll}"`);
await shelfMechPage.close();

// Card-in replay suppression (verifier fix round): client.js's CLIENT block
// gives every .tool-card an unconditional "card-in" fade-and-rise, gated
// only on prefers-reduced-motion: no-preference (the default here, left
// unemulated so this is exactly the condition a replay would show under).
// Toggling a shelf's grid `hidden` off used to re-trigger that animation on
// every card inside, every time: an unlisted motion against the amended
// section 16's exhaustive inventory. Two toggle cycles, since a replay bug
// would show identically on the first open but only a fix proves the
// second open is not somehow different (e.g. an animation "having already
// run once" quirk masking a real replay on repeat).
const animPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await animPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await animPage.goto(`${base}/`);
await animPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
const animShelfHeader = animPage.locator('.pub-shelf-header').first();
async function sampleFirstShelfCard() {
  return animPage.evaluate(() => {
    const card = document.querySelector('.pub-shelf .tool-card');
    const cs = getComputedStyle(card);
    return { animationName: cs.animationName, opacity: cs.opacity };
  });
}
await animShelfHeader.click(); // open, cycle 1
const animSampleOpen1 = await sampleFirstShelfCard();
await animShelfHeader.click(); // close
await animPage.waitForTimeout(50);
await animShelfHeader.click(); // open again, cycle 2
const animSampleOpen2 = await sampleFirstShelfCard();
check('shelf: opening a shelf never replays the card-in entrance (animationName none, opacity 1, two toggle cycles)',
  animSampleOpen1.animationName === 'none' && animSampleOpen1.opacity === '1'
  && animSampleOpen2.animationName === 'none' && animSampleOpen2.opacity === '1',
  `cycle1=${JSON.stringify(animSampleOpen1)} cycle2=${JSON.stringify(animSampleOpen2)}`);
await animPage.close();

/* --- Wave 14.2, motion inventory item 2: the shelf-expansion stagger -----
   The sample above deliberately reads .tool-card, which the new stagger
   never touches (it is set on the card-grid's own <li> wrapper, the same
   split the hover-lift rule above already uses and for the identical
   reason: a "both" fill-mode keyframe animation on .tool-card would defeat
   a later transition on that same element and property). This block reads
   the <li> instead, at trigger time (no wait at all, the worst case for
   catching a state that was never really opacity:0 to begin with) and
   again once settled, per BUILD-PLAN 14.2's named check ("sample computed
   animation/transition state at trigger time for... the shelf stagger"). */
const staggerPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await staggerPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await staggerPage.goto(`${base}/`);
await staggerPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
async function sampleFirstLi(pg) {
  return pg.evaluate(() => {
    const li = document.querySelector('.pub-shelf .card-grid > li');
    const cs = getComputedStyle(li);
    return { opacity: cs.opacity, transform: cs.transform, className: li.className };
  });
}
const staggerHeader = staggerPage.locator('.pub-shelf-header').first();
/* Sampling computed style after the click raced the animation clock: the
   first li has no stagger delay, so its whole 300ms transition can start
   and finish (classes cleaned up and all) inside one slow Playwright
   round-trip, which made this check flake under CPU load. Instead,
   instrument the page BEFORE the click: the stagger is a transition, and
   transitionstart events captured at the document level record exactly
   which elements genuinely animated, with their class state at that
   moment, no matter how fast the flight completes. */
await staggerPage.evaluate(() => {
  window.__staggerEvidence = { starts: 0, first: null };
  document.addEventListener('transitionstart', (e) => {
    const t = e.target;
    if (!(t instanceof Element) || !t.matches('.pub-shelf .card-grid > li')) return;
    if (!t.classList.contains('pub-shelf-stagger')) return;
    window.__staggerEvidence.starts++;
    if (!window.__staggerEvidence.first) {
      window.__staggerEvidence.first = { property: e.propertyName, className: t.className };
    }
  }, true);
});
await staggerHeader.click();
await staggerPage.waitForTimeout(600);
const staggerMid = await staggerPage.evaluate(() => window.__staggerEvidence);
check('shelf: the stagger fires under normal motion (transitionstart evidence: pub-shelf-stagger lis genuinely animated, reduced variant absent)',
  staggerMid.starts > 0 && staggerMid.first !== null
  && staggerMid.first.className.includes('pub-shelf-stagger')
  && !staggerMid.first.className.includes('reduced'),
  `starts=${staggerMid.starts} first=${JSON.stringify(staggerMid.first)}`);
await staggerPage.waitForTimeout(500);
const staggerSettled = await sampleFirstLi(staggerPage);
check('shelf: the stagger settles to opacity 1, no transform, and cleans up its own class',
  staggerSettled.opacity === '1' && staggerSettled.transform === 'none' && !staggerSettled.className.includes('pub-shelf-stagger'),
  JSON.stringify(staggerSettled));

// Cap at the first six cards: a shelf with more than six tools leaves the
// seventh (and later) alone at every point, never carrying the stagger
// class, per "later cards appear settled".
const cappedShelfCategory = active.reduce((best, t) => {
  const count = active.filter((x) => x.category === t.category).length;
  return count > 6 && (!best || count > best.count) ? { category: t.category, count } : best;
}, null);
if (cappedShelfCategory) {
  await staggerHeader.click(); // close
  await staggerPage.waitForTimeout(30);
  const cappedHeader = staggerPage.locator('.pub-shelf-header', { hasText: cappedShelfCategory.category }).first();
  await cappedHeader.click();
  const seventhClass = await staggerPage.evaluate((category) => {
    const header = [...document.querySelectorAll('.pub-shelf-header')].find((h) => h.textContent.includes(category));
    const grid = document.getElementById(header.getAttribute('aria-controls'));
    return grid.children[6]?.className ?? null;
  }, cappedShelfCategory.category);
  check('shelf: the stagger cap leaves the 7th card and beyond untouched',
    seventhClass !== null && !seventhClass.includes('pub-shelf-stagger'), `category="${cappedShelfCategory.category}" class="${seventhClass}"`);
}

// Repeatable, unlike motion item 1's once-only reveal: closing and
// reopening the SAME shelf stagers again, not only on its first ever open.
// aria-expanded, not an assumed toggle parity: the cap check above may or
// may not have already closed this same header, depending on whether this
// dataset happens to have a >6-tool category at all.
if ((await staggerHeader.getAttribute('aria-expanded')) === 'true') {
  await staggerHeader.click(); // close
  await staggerPage.waitForTimeout(30);
}
await staggerPage.waitForTimeout(400);
await staggerHeader.click(); // reopen
const staggerReplay = await sampleFirstLi(staggerPage);
check('shelf: the stagger replays on a later reopen of the same shelf (repeatable, not once-only)',
  staggerReplay.className.includes('pub-shelf-stagger') && Number(staggerReplay.opacity) < 1,
  JSON.stringify(staggerReplay));
await staggerPage.close();

// Reduced motion: opacity only, no stagger delay, no translate, at trigger
// time (the same "sample mid-flight" discipline as the normal-motion check
// above, not only a settled-state check).
const staggerReducedPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await staggerReducedPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await staggerReducedPage.emulateMedia({ reducedMotion: 'reduce' });
await staggerReducedPage.goto(`${base}/`);
await staggerReducedPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
await staggerReducedPage.locator('.pub-shelf-header').first().click();
const staggerReducedMid = await sampleFirstLi(staggerReducedPage);
check('shelf: reduced motion: the stagger carries no transform at trigger time and no per-item delay class',
  staggerReducedMid.className.includes('pub-shelf-stagger-reduced') && staggerReducedMid.transform === 'none',
  JSON.stringify(staggerReducedMid));
await staggerReducedPage.close();

// 44px shelf headers at 375px.
const shelf375Page = await browser.newPage({ viewport: { width: 375, height: 900 } });
await shelf375Page.route(/^(?!.*localhost).*$/, (route) => route.abort());
await shelf375Page.goto(`${base}/`);
await shelf375Page.waitForSelector('#public-root .tool-card', { state: 'attached' });
const headerHeights375 = await shelf375Page.locator('.pub-shelf-header').evaluateAll(
  (nodes) => nodes.map((n) => n.getBoundingClientRect().height));
check('shelf: every shelf header is at least 44px tall at 375px',
  headerHeights375.length === 15 && headerHeights375.every((h) => h >= 44), JSON.stringify(headerHeights375));
await shelf375Page.close();

// Search force-open and restore: searching tool 0's own name opens its
// shelf (and shows the "N tools match" line), and clearing restores the
// fully collapsed default. This is also the "tool id 0 found by search"
// check BUILD-PLAN 14.1 names.
const searchShelfPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await searchShelfPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await searchShelfPage.goto(`${base}/`);
await searchShelfPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
await searchShelfPage.fill('#public-root input[type=search]', tool0.name);
// Wave 14.2: debounced and view-transitioned (motion inventory item 3);
// polled on the actual card, not slept.
await searchShelfPage.waitForFunction((slug) => {
  const grid = document.getElementById(`cat-${slug}`)?.querySelector('.pub-shelf-grid');
  return grid && !grid.hidden;
}, tool0Slug);
const tool0ShelfOpenDuringSearch = await searchShelfPage.evaluate((slug) => {
  const section = document.getElementById(`cat-${slug}`);
  return !section.hidden && !section.querySelector('.pub-shelf-grid').hidden;
}, tool0Slug);
const tool0CardVisibleDuringSearch = await searchShelfPage.locator('#public-root .card-grid > li[data-id="0"]').isVisible();
const matchLineText = await searchShelfPage.locator('.pub-shelf-match-count').textContent();
check('shelf: searching tool 0\'s name force-opens its shelf and finds tool id 0',
  tool0ShelfOpenDuringSearch && tool0CardVisibleDuringSearch && /match/.test(matchLineText),
  `shelfOpen=${tool0ShelfOpenDuringSearch} cardVisible=${tool0CardVisibleDuringSearch} matchLine="${matchLineText}"`);
await searchShelfPage.fill('#public-root input[type=search]', '');
await searchShelfPage.waitForFunction((slug) => {
  const grid = document.getElementById(`cat-${slug}`)?.querySelector('.pub-shelf-grid');
  return grid && grid.hidden;
}, tool0Slug);
const tool0ShelfAfterClear = await searchShelfPage.evaluate((slug) => {
  const section = document.getElementById(`cat-${slug}`);
  return { sectionHidden: section.hidden, gridHidden: section.querySelector('.pub-shelf-grid').hidden };
}, tool0Slug);
const matchLineHiddenAfterClear = await searchShelfPage.locator('.pub-shelf-match-count').isHidden();
check('shelf: clearing the search restores the collapsed default',
  tool0ShelfAfterClear.sectionHidden === false && tool0ShelfAfterClear.gridHidden === true && matchLineHiddenAfterClear,
  JSON.stringify({ ...tool0ShelfAfterClear, matchLineHidden: matchLineHiddenAfterClear }));
await searchShelfPage.close();

// #cat-<slug> deep link opens and scrolls to its shelf.
const deepLinkPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await deepLinkPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await deepLinkPage.goto(`${base}/#cat-${tool0Slug}`);
await deepLinkPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
await deepLinkPage.waitForTimeout(700); // let the smooth scrollIntoView settle
const deepLinkResult = await deepLinkPage.evaluate((slug) => {
  const section = document.getElementById(`cat-${slug}`);
  const grid = section.querySelector('.pub-shelf-grid');
  const rect = section.getBoundingClientRect();
  return { gridHidden: grid.hidden, top: rect.top, nearViewportTop: rect.top >= -50 && rect.top <= 300 };
}, tool0Slug);
check('shelf: a #cat- deep link opens and scrolls to its shelf',
  deepLinkResult.gridHidden === false && deepLinkResult.nearViewportTop,
  JSON.stringify(deepLinkResult));
await deepLinkPage.close();

// Tool id 0's judgement chip inside its own shelf: judge it via the
// fine-pointer quick-judge rail (no deck needed) once its shelf is
// expanded, then confirm the chip renders in place, still inside that
// shelf (the "id 0 in a shelf and its judgement chip" check).
const shelfChipPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await shelfChipPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await shelfChipPage.goto(`${base}/`);
await shelfChipPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
await shelfChipPage.evaluate(() => localStorage.removeItem('freestack:v1:discover'));
await shelfChipPage.reload();
await shelfChipPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
await shelfChipPage.waitForTimeout(400); // let discover.js resolve so the rail actually renders
await expandAllShelves(shelfChipPage);
const tool0Li = shelfChipPage.locator('#public-root .card-grid > li[data-id="0"]');
await tool0Li.scrollIntoViewIfNeeded();
await tool0Li.hover();
await tool0Li.locator('.pub-judge-rail-have').click();
await shelfChipPage.waitForTimeout(200);
const tool0ChipText = await tool0Li.locator('.pub-judge-chip').textContent().catch(() => '');
const tool0ChipInsideShelf = await tool0Li.evaluate((li) => li.closest('.pub-shelf') !== null);
check('shelf: tool id 0 can be judged and its chip renders inside its own shelf',
  tool0ChipText.trim() === 'Got it' && tool0ChipInsideShelf,
  `chip="${tool0ChipText}" insideShelf=${tool0ChipInsideShelf}`);
await shelfChipPage.close();

/* --- Phase 12.2: Discover deck engine (PRD section 17) ---------------------
   js/discover.js is dynamically imported by the Discover entry path's click
   handler (js/public.js), so every check below opens the deck the same way
   a reader would: click [data-discover-entry], wait for the first card. The
   default seed deals unjudged core tools first (data/tools.json's first
   core id is 0), which is what the tool-0 checks below rely on rather than
   any special-cased test hook. */
async function openDiscoverDeck(pg) {
  await pg.goto(`${base}/`);
  await pg.waitForSelector('#public-root .tool-card', { state: 'attached' });
  await pg.locator('[data-discover-entry]').click();
  await pg.waitForSelector('.discover-card');
}
/** Resets to a fresh, unjudged deck, but with coachDone already true: the
    first-open coaching overlay (Phase 12 close-out) would otherwise show
    over a genuinely first-ever deck, disabling the three judge buttons and
    swallowing the very first tap/click/key these tests rely on to exercise
    real judging behaviour. The coach itself has its own dedicated checks
    below, run against a truly removed key. */
async function clearDiscoverStorage(pg) {
  await pg.evaluate(() => localStorage.setItem('freestack:v1:discover', JSON.stringify({
    v: 1, lastVisit: new Date().toISOString(), seenIds: [], decisions: {}, coachDone: true,
  })));
}

/** Same coach bypass as clearDiscoverStorage, but seeded before the very
    first navigation (page.addInitScript), for the handful of checks below
    that interact with the deck on a genuinely first load rather than the
    open-then-clear-then-reopen sequence most of this section otherwise
    uses. */
async function seedCoachDoneBeforeLoad(pg) {
  await pg.addInitScript(() => {
    try {
      localStorage.setItem('freestack:v1:discover', JSON.stringify({
        v: 1, lastVisit: new Date().toISOString(), seenIds: [], decisions: {}, coachDone: true,
      }));
    } catch { /* private mode etc: irrelevant here, this is the non-blocked-storage path */ }
  });
}

const discoverPage = await browser.newPage();
await discoverPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await openDiscoverDeck(discoverPage);
await clearDiscoverStorage(discoverPage);
await discoverPage.reload();
await discoverPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
await discoverPage.locator('[data-discover-entry]').click();
await discoverPage.waitForSelector('.discover-card');

const firstDealtId = await discoverPage.locator('.discover-card').getAttribute('data-id');
await discoverPage.locator('.discover-panel').press('ArrowLeft'); // keyboard: got it
await discoverPage.waitForTimeout(400);
const decisionsAfterKeyboard = await discoverPage.evaluate(() => JSON.parse(localStorage.getItem('freestack:v1:discover')).decisions);
check('discover: keyboard-judged tool 0 recorded as have',
  firstDealtId === '0' && decisionsAfterKeyboard['0']?.d === 'have', `firstDealtId=${firstDealtId} decisions=${JSON.stringify(decisionsAfterKeyboard)}`);

await discoverPage.reload();
await discoverPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
const decisionsAfterReload = await discoverPage.evaluate(() => JSON.parse(localStorage.getItem('freestack:v1:discover')).decisions);
check('discover: tool 0 decision survives a reload', decisionsAfterReload['0']?.d === 'have', JSON.stringify(decisionsAfterReload));

await discoverPage.locator('[data-discover-entry]').click();
await discoverPage.waitForSelector('.discover-card');
const secondDealIds = [];
for (let i = 0; i < 12 && (await discoverPage.locator('.discover-card').count()) > 0; i++) {
  secondDealIds.push(await discoverPage.locator('.discover-card').getAttribute('data-id'));
  if ((await discoverPage.locator('.discover-btn-skip').count()) === 0) break;
  await discoverPage.locator('.discover-btn-skip').click();
  await discoverPage.waitForTimeout(300);
  if ((await discoverPage.locator('.discover-completion').count()) > 0) break;
}
check('discover: a second deal excludes already-judged tool 0', !secondDealIds.includes('0'), secondDealIds.join(','));
check('discover: deck length never exceeds 12', secondDealIds.length <= 12, `dealt=${secondDealIds.length}`);
await discoverPage.close();

// Sub-threshold drag: 40px, well under the 100px/35%-width commit floor,
// paced over real elapsed time so it reads as a slow drag rather than a
// fling (a near-instant synthetic jump is itself a real 0.5px/ms release
// velocity by the spec's own definition, not a false positive to guard).
const dragPage = await browser.newPage({ viewport: { width: 1000, height: 900 } });
await dragPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await openDiscoverDeck(dragPage);
await clearDiscoverStorage(dragPage);
await dragPage.reload();
await dragPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
await dragPage.locator('[data-discover-entry]').click();
await dragPage.waitForSelector('.discover-card');
const idBeforeDrag = await dragPage.locator('.discover-card').getAttribute('data-id');
const dragBox = await dragPage.locator('.discover-card').boundingBox();
const dragStartX = dragBox.x + dragBox.width / 2;
const dragStartY = dragBox.y + dragBox.height / 2;
await dragPage.mouse.move(dragStartX, dragStartY);
await dragPage.mouse.down();
await dragPage.mouse.move(dragStartX + 20, dragStartY, { steps: 1 });
await dragPage.waitForTimeout(120);
await dragPage.mouse.move(dragStartX + 40, dragStartY, { steps: 1 });
await dragPage.waitForTimeout(120);
await dragPage.mouse.up();
await dragPage.waitForTimeout(300);
const idAfterDrag = await dragPage.locator('.discover-card').getAttribute('data-id');
const stateAfterDrag = await dragPage.evaluate(() => {
  const raw = localStorage.getItem('freestack:v1:discover');
  return raw ? JSON.parse(raw) : null;
});
check('discover: sub-threshold drag springs back with no decision recorded',
  idAfterDrag === idBeforeDrag && !stateAfterDrag?.decisions?.[idBeforeDrag],
  `before=${idBeforeDrag} after=${idAfterDrag} decisions=${JSON.stringify(stateAfterDrag?.decisions)}`);

// Rocky's second phone-test finding (production, dark mode, mid-drag left):
// the GOT IT stamp had no backing at all and landed directly on the
// card's own title text, both becoming illegible together. Two guards,
// per theme: the stamp's own computed background-color must carry alpha 1
// (a solid token, never a translucent one), and at the commit distance
// its bounding box must not intersect the card title's box, since it was
// repositioned off the fixed top-of-card slot the title also lives in.
async function checkStampLegibility(theme) {
  const pg = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await pg.route(/^(?!.*localhost).*$/, (route) => route.abort());
  await pg.goto(`${base}/`);
  await pg.waitForSelector('#public-root .tool-card', { state: 'attached' });
  await pg.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await clearDiscoverStorage(pg);
  await pg.reload();
  await pg.waitForSelector('#public-root .tool-card', { state: 'attached' });
  await pg.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await pg.locator('[data-discover-entry]').click();
  await pg.waitForSelector('.discover-card');

  const alphaOk = await pg.evaluate(() => {
    const alpha1 = (el) => {
      const c = getComputedStyle(el).backgroundColor;
      const m = c.match(/rgba?\(([^)]+)\)/);
      const parts = m[1].split(',').map((s) => s.trim());
      return parts.length === 3 || Number.parseFloat(parts[3]) === 1;
    };
    return alpha1(document.querySelector('.discover-stamp-have')) && alpha1(document.querySelector('.discover-stamp-want'));
  });
  check(`discover: ${theme} mode: both stamps have an opaque (alpha 1) background`, alphaOk, String(alphaOk));

  const cardBox = await pg.locator('.discover-card').boundingBox();
  const sx = cardBox.x + cardBox.width / 2;
  const sy = cardBox.y + cardBox.height / 2;
  await pg.mouse.move(sx, sy);
  await pg.mouse.down();
  await pg.mouse.move(sx - 40, sy, { steps: 2 });
  await pg.mouse.move(sx - 110, sy, { steps: 4 }); // past the 100px commit floor
  await pg.waitForTimeout(50);
  const stampBox = await pg.locator('.discover-stamp-have').boundingBox();
  const h3Box = await pg.locator('.discover-card-name').boundingBox();
  const intersects = stampBox && h3Box
    && stampBox.x < h3Box.x + h3Box.width && stampBox.x + stampBox.width > h3Box.x
    && stampBox.y < h3Box.y + h3Box.height && stampBox.y + stampBox.height > h3Box.y;
  check(`discover: ${theme} mode: the stamp never intersects the card title at commit distance`,
    !intersects, JSON.stringify({ stampBox, h3Box }));
  await pg.mouse.up();
  await pg.close();
}
await checkStampLegibility('light');
await checkStampLegibility('dark');
await dragPage.close();

// Rocky's third phone-test finding ("check fonts and text sizes... here
// too big", the deck card's description reading oversized at 375-390px):
// the description must match client mode's own card-desc register, not
// the site's larger default body-copy size, and the title must actually
// be set in the brand heading font rather than silently falling back to a
// generic sans-serif (which would also read as "wrong" even at the
// correct size).
const typographyPage = await browser.newPage({ viewport: { width: 375, height: 812 } });
await typographyPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await openDiscoverDeck(typographyPage);
await clearDiscoverStorage(typographyPage);
await typographyPage.reload();
await typographyPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
await typographyPage.locator('[data-discover-entry]').click();
await typographyPage.waitForSelector('.discover-card');
const deckDescSize = await typographyPage.locator('.discover-card-desc').evaluate((n) => Number.parseFloat(getComputedStyle(n).fontSize));
const deckTitleFont = await typographyPage.locator('.discover-card-name').evaluate((n) => getComputedStyle(n).fontFamily);
await typographyPage.close();

const clientComparisonPage = await browser.newPage({ viewport: { width: 375, height: 812 } });
await clientComparisonPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await clientComparisonPage.goto(`${base}/?t=0,2,6&client=Test`);
await clientComparisonPage.waitForSelector('.tool-card');
const clientDescSize = await clientComparisonPage.locator('.tool-card .card-desc').first().evaluate((n) => Number.parseFloat(getComputedStyle(n).fontSize));
await clientComparisonPage.close();

check('discover: at 375px the deck card description is at or below the client-mode card description size',
  deckDescSize <= clientDescSize, `deck=${deckDescSize}px client=${clientDescSize}px`);
check('discover: the deck card title renders in the brand heading font, not a fallback',
  deckTitleFont.trim().startsWith('"Galano Grotesque"') || deckTitleFont.trim().startsWith('Galano Grotesque'),
  deckTitleFont);

// Reduced motion: the two new animated paths (new-card deal-in, stamp pop
// on commit) must yield zero transform transitions/animations, the same
// guarantee every other motion path in this module already carries.
const reducedDiscoverPage = await browser.newPage();
await reducedDiscoverPage.emulateMedia({ reducedMotion: 'reduce' });
await reducedDiscoverPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await openDiscoverDeck(reducedDiscoverPage);
await clearDiscoverStorage(reducedDiscoverPage);
await reducedDiscoverPage.reload();
await reducedDiscoverPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
await reducedDiscoverPage.locator('[data-discover-entry]').click();
await reducedDiscoverPage.waitForSelector('.discover-card');
const enterAnimationName = await reducedDiscoverPage.locator('.discover-card').evaluate((n) => getComputedStyle(n).animationName);
check('discover: reduced motion: the new-card deal-in carries no animation', enterAnimationName === 'none', enterAnimationName);
await reducedDiscoverPage.locator('.discover-btn-have').click();
await reducedDiscoverPage.waitForTimeout(30);
const stampPopAnimationName = await reducedDiscoverPage.locator('.discover-stamp-have').evaluate((n) => getComputedStyle(n).animationName).catch(() => 'gone');
check('discover: reduced motion: the stamp pop on commit carries no animation', stampPopAnimationName === 'none' || stampPopAnimationName === 'gone', stampPopAnimationName);
await reducedDiscoverPage.close();

// Phase 14 close-out: the coach's Continue button removes itself from the
// DOM on dismissal (click, any tap, or the 5s auto-dismiss all funnel
// through dismissCoach), which the browser resolves by dropping focus to
// body. The deck's own Left/Right/Backspace/Escape handling lives on
// panel's keydown listener, so unless dismissCoach hands focus back into
// the panel, the very next keyboard press silently does nothing. Every
// other keyboard check in this file pre-seeds coachDone precisely to avoid
// the coach, which is exactly why the sweep found this blind: these two are
// deliberately genuinely first-ever opens, no coachDone seed at all. The
// ArrowLeft/Escape presses below use page.keyboard, not locator.press,
// because locator.press() focuses its own target first and would silently
// paper over a focus regression rather than exercise it.
// Reduced motion is forced here, not just for its own sake: headless
// Chromium supports View Transitions, and js/public.js's deck-open only
// takes the VT-morph path when both startViewTransition exists and
// prefersReducedMotion() is false (matchMedia('(prefers-reduced-motion:
// reduce)')). That path defers panel focus into
// transition.finished.then(...), and its own capture-phase
// first-interaction listener calls skipTransition() on the very Enter
// keypress this check sends, which resolves that promise and refocuses the
// panel on its own, regardless of whether dismissCoach() does. Without
// forcing the fallback (non-VT) path here, this check passes even against
// the pre-fix dismissCoach(), proving nothing. emulateMedia is exactly
// right against that matchMedia guard.
const coachKeyboardPage = await browser.newPage();
await coachKeyboardPage.emulateMedia({ reducedMotion: 'reduce' });
await coachKeyboardPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await coachKeyboardPage.goto(`${base}/`);
await coachKeyboardPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
await coachKeyboardPage.locator('[data-discover-entry]').click();
await coachKeyboardPage.waitForSelector('.discover-coach');
const progressBeforeCoachDismiss = await coachKeyboardPage.locator('.discover-progress').textContent();
// Focuses the Continue button, then presses Enter on it: the exact
// "keyboard Enter on Continue" dismissal path the sweep reproduced.
await coachKeyboardPage.locator('.discover-coach-dismiss').press('Enter');
await coachKeyboardPage.waitForSelector('.discover-coach', { state: 'detached' });
await coachKeyboardPage.keyboard.press('ArrowLeft');
await coachKeyboardPage.waitForTimeout(400);
const progressAfterArrowLeft = await coachKeyboardPage.locator('.discover-progress').textContent();
const decisionsAfterCoachEnterDismiss = await coachKeyboardPage.evaluate(
  () => JSON.parse(localStorage.getItem('freestack:v1:discover') || '{}').decisions ?? {});
check('discover: ArrowLeft still judges the card after keyboard-dismissing the first-ever coach with Enter (reduced-motion path)',
  progressAfterArrowLeft !== progressBeforeCoachDismiss && Object.keys(decisionsAfterCoachEnterDismiss).length === 1,
  `before=${progressBeforeCoachDismiss} after=${progressAfterArrowLeft} decisions=${JSON.stringify(decisionsAfterCoachEnterDismiss)}`);
await coachKeyboardPage.close();

const coachClickPage = await browser.newPage();
await coachClickPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await coachClickPage.goto(`${base}/`);
await coachClickPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
await coachClickPage.locator('[data-discover-entry]').focus();
await coachClickPage.locator('[data-discover-entry]').click();
await coachClickPage.waitForSelector('.discover-coach');
// The click-to-dismiss path, not keyboard: a mouse click on Continue
// natively focuses it before the click listener removes it from the DOM.
await coachClickPage.locator('.discover-coach-dismiss').click();
await coachClickPage.waitForSelector('.discover-coach', { state: 'detached' });
await coachClickPage.keyboard.press('Escape');
await coachClickPage.waitForTimeout(100);
const deckClosedAfterCoachClickEscape = await coachClickPage.locator('.discover-panel').count();
const focusReturnedAfterCoachClickEscape = await coachClickPage.evaluate(() => document.activeElement?.hasAttribute('data-discover-entry'));
check('discover: Escape still closes the deck and restores opener focus after click-dismissing the first-ever coach',
  deckClosedAfterCoachClickEscape === 0 && focusReturnedAfterCoachClickEscape === true,
  `panelCount=${deckClosedAfterCoachClickEscape} focusReturned=${focusReturnedAfterCoachClickEscape}`);
await coachClickPage.close();

// Escape restores focus to the opener button.
const escPage = await browser.newPage();
await escPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await seedCoachDoneBeforeLoad(escPage); // otherwise the first Escape only dismisses the coach
await escPage.goto(`${base}/`);
await escPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
await escPage.locator('[data-discover-entry]').focus();
await escPage.locator('[data-discover-entry]').click();
await escPage.waitForSelector('.discover-card');
await escPage.locator('.discover-panel').press('Escape');
await escPage.waitForTimeout(100);
const focusReturnedToOpener = await escPage.evaluate(() => document.activeElement?.hasAttribute('data-discover-entry'));
check('discover: Escape closes the deck and restores focus to the opener',
  focusReturnedToOpener === true && (await escPage.locator('.discover-panel').count()) === 0);
await escPage.close();

// Completion hand-off: have= always present (even empty), skip never travels.
const handoffPage = await browser.newPage();
await handoffPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await openDiscoverDeck(handoffPage);
await clearDiscoverStorage(handoffPage);
await handoffPage.reload();
await handoffPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
await handoffPage.locator('[data-discover-entry]').click();
await handoffPage.waitForSelector('.discover-card');
// One "want" decision first: with only skips, both resolved lists would be
// empty and the button is correctly not rendered at all (per the section's
// own rule), which would make this the wrong scenario to test have= against.
await handoffPage.locator('.discover-btn-want').click();
await handoffPage.waitForTimeout(300);
const skippedIds = [];
let handoffGuard = 0;
while ((await handoffPage.locator('.discover-completion').count()) === 0 && (await handoffPage.locator('.discover-card').count()) > 0 && handoffGuard < 12) {
  skippedIds.push(await handoffPage.locator('.discover-card').getAttribute('data-id'));
  await handoffPage.locator('.discover-btn-skip').click();
  await handoffPage.waitForTimeout(300);
  handoffGuard++;
}
await handoffPage.waitForSelector('.discover-completion');
const handoffHref = await handoffPage.locator('.discover-completion-actions a.btn').getAttribute('href');
check('discover: completion hand-off always carries the have= marker, even empty',
  handoffHref !== null && /[?&]have=(&|$)/.test(handoffHref), handoffHref);
check('discover: completion hand-off never carries a skipped id',
  skippedIds.every((id) => !new URL(handoffHref, base).searchParams.get('have')?.split(',').includes(id)
    && !(new URL(handoffHref, base).searchParams.get('from')?.split(',') ?? []).includes(id)),
  `skipped=${skippedIds.join(',')} href=${handoffHref}`);
await handoffPage.close();

// Blocked localStorage: the deck must still deal and complete in-session,
// with no console/page error cascade (private mode, some webviews).
const blockedCtx = await browser.newContext();
await blockedCtx.addInitScript(() => {
  const blocked = () => { throw new DOMException('blocked', 'SecurityError'); };
  Object.defineProperty(window, 'localStorage', {
    get() { return { getItem: blocked, setItem: blocked, removeItem: blocked, clear: blocked }; },
  });
});
const blockedPage = await blockedCtx.newPage();
await blockedPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
const blockedPageErrors = [];
blockedPage.on('pageerror', (e) => blockedPageErrors.push(String(e)));
blockedPage.on('console', (m) => { if (m.type() === 'error' && !/net::|Failed to load resource/.test(m.text())) blockedPageErrors.push(m.text()); });
await blockedPage.goto(`${base}/`);
await blockedPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
await blockedPage.locator('[data-discover-entry]').click();
await blockedPage.waitForSelector('.discover-card');
check('discover: blocked localStorage still deals a card', (await blockedPage.locator('.discover-card').count()) === 1);
// With storage genuinely blocked there is no way to pre-seed coachDone (the
// mock throws on every access, including a seed attempt), so the coach
// overlay legitimately shows here: exactly the "blocked-storage visitors
// may see it once per session, acceptable" case the fix round names. A
// real visitor would dismiss it once and carry on, so this test does too.
if (await blockedPage.locator('.discover-coach-dismiss').count()) {
  await blockedPage.locator('.discover-coach-dismiss').click();
  await blockedPage.waitForTimeout(150);
}
let blockedGuard = 0;
while ((await blockedPage.locator('.discover-completion').count()) === 0 && blockedGuard < 14) {
  await blockedPage.locator('.discover-btn-skip').click();
  await blockedPage.waitForTimeout(300);
  blockedGuard++;
}
check('discover: blocked localStorage still reaches a completion card', (await blockedPage.locator('.discover-completion').count()) === 1, `guard=${blockedGuard}`);
check('discover: blocked localStorage produces no console/page errors', blockedPageErrors.length === 0, blockedPageErrors.join(' | ').slice(0, 300));
await blockedCtx.close();

// Verifier round (defects 1, 2, 4): rapid double-judge, the More permalink,
// and the [hidden] attribute actually hiding. Permanent per the fix report.

// Defect 1: a zero-delay double click on the same visible button must
// record exactly one decision, and the card shown afterwards must be the
// true next id, not a second judgement read mid-transition.
const doubleJudgePage = await browser.newPage();
await doubleJudgePage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await openDiscoverDeck(doubleJudgePage);
await clearDiscoverStorage(doubleJudgePage);
await doubleJudgePage.reload();
await doubleJudgePage.waitForSelector('#public-root .tool-card', { state: 'attached' });
await doubleJudgePage.locator('[data-discover-entry]').click();
await doubleJudgePage.waitForSelector('.discover-card');
const firstCardId = await doubleJudgePage.locator('.discover-card').getAttribute('data-id');
await doubleJudgePage.evaluate(() => {
  const btn = document.querySelector('.discover-btn-have');
  btn.click();
  btn.click(); // synchronous, same tick: no real-world delay is faster than this
});
await doubleJudgePage.waitForTimeout(500);
const decisionsAfterDoubleClick = await doubleJudgePage.evaluate(() => JSON.parse(localStorage.getItem('freestack:v1:discover')).decisions);
const nextCardIdAfterDoubleClick = await doubleJudgePage.locator('.discover-card').getAttribute('data-id');
check('discover: zero-delay double click records exactly one decision',
  Object.keys(decisionsAfterDoubleClick).length === 1 && decisionsAfterDoubleClick[firstCardId]?.d === 'have',
  JSON.stringify(decisionsAfterDoubleClick));
check('discover: zero-delay double click still shows the true next card',
  nextCardIdAfterDoubleClick !== null && nextCardIdAfterDoubleClick !== firstCardId,
  `first=${firstCardId} next=${nextCardIdAfterDoubleClick}`);
await doubleJudgePage.close();

// Defect 2: the quiet "More" permalink must be reachable by a stationary
// mouse click, not silently swallowed by unconditional pointer capture.
const morePage = await browser.newPage();
await morePage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await seedCoachDoneBeforeLoad(morePage); // otherwise the coach overlay covers the card and the More link
await openDiscoverDeck(morePage);
const [moreTab] = await Promise.all([
  morePage.context().waitForEvent('page'),
  morePage.locator('.discover-card-more').click(),
]);
await moreTab.waitForLoadState();
check('discover: More link click navigates to the tool permalink', /[?&]tool=/.test(moreTab.url()), moreTab.url());
await moreTab.close();
await morePage.close();

// Defect 4: the hidden IDL property must actually hide, not just be present
// with no visual effect (a flex/inline-flex display declaration elsewhere
// wins over the bare UA [hidden] rule unless overridden).
const hiddenPage = await browser.newPage();
await hiddenPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await seedCoachDoneBeforeLoad(hiddenPage); // otherwise Skip stays disabled behind the coach overlay
await openDiscoverDeck(hiddenPage);
const undoDisplayAtStart = await hiddenPage.locator('.discover-undo').evaluate((n) => getComputedStyle(n).display);
check('discover: Undo button computed display is none at deck start', undoDisplayAtStart === 'none', undoDisplayAtStart);
let hiddenGuard = 0;
while ((await hiddenPage.locator('.discover-completion').count()) === 0 && hiddenGuard < 14) {
  await hiddenPage.locator('.discover-btn-skip').click();
  await hiddenPage.waitForTimeout(300);
  hiddenGuard++;
}
const controlsDisplayAtCompletion = await hiddenPage.locator('.discover-controls').evaluate((n) => getComputedStyle(n).display);
check('discover: controls row computed display is none at completion', controlsDisplayAtCompletion === 'none', controlsDisplayAtCompletion);
await hiddenPage.close();

// Phase 12 close-out: opening the deck used to race two scroll-affecting
// calls (js/discover.js's panel.focus() and js/public.js's
// discoverMount.scrollIntoView), and a judgement made in the first
// ~100-150ms could carry the freshly dealt next card off-screen entirely.
// panel.focus({preventScroll: true}) is the fix; this is the permanent
// regression guard, at the mobile width the defect reproduced at, with the
// judge button clicked the instant the first card exists (no settle wait
// at all, the worst case).
//
// Wave 14.2 re-run (the deck-open morph, motion inventory item 4, reopened
// exactly this class of race): the immediate judge click below uses
// page.mouse.click() at the button's own current coordinates, not
// Locator.click(). Investigated while building this wave: Locator.click()'s
// own pre-action "scroll target into view if needed" step (Playwright's,
// not this app's) measurably miscalculates while a page-level View
// Transition is still mid-flight, producing a scroll position no real tap
// ever would; page.mouse.click() dispatches at fixed coordinates with no
// such framework-level auto-scroll, matching what an actual immediate tap
// on a phone does (buttons do not natively pull the viewport to themselves
// on tap, unlike a focused text input avoiding a virtual keyboard). This is
// the honest regression guard for a real tap; a Locator.click()-based
// version of this same check would be testing Playwright's own scrolling
// heuristic under an active transition, not this app's behaviour.
const scrollRacePage = await browser.newPage({ viewport: { width: 375, height: 812 } });
await scrollRacePage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await seedCoachDoneBeforeLoad(scrollRacePage); // otherwise the zero-delay click only dismisses the coach
await scrollRacePage.goto(`${base}/`, { waitUntil: 'load' });
await scrollRacePage.waitForSelector('#public-root .tool-card', { state: 'attached' });
await scrollRacePage.locator('[data-discover-entry]').click();
await scrollRacePage.waitForSelector('.discover-card');
const scrollRaceJudgeBox = await scrollRacePage.locator('.discover-btn-have').boundingBox();
await scrollRacePage.mouse.click(scrollRaceJudgeBox.x + scrollRaceJudgeBox.width / 2, scrollRaceJudgeBox.y + scrollRaceJudgeBox.height / 2); // zero delay: the reproduced race window
await scrollRacePage.waitForTimeout(600); // let any scroll and the exit/deal transition settle
const scrollRaceViewportHeight = await scrollRacePage.evaluate(() => window.innerHeight);
const scrollRaceCardBox = await scrollRacePage.locator('.discover-card').boundingBox();
check('discover: an immediate judgement never carries the next card off-screen',
  scrollRaceCardBox !== null && scrollRaceCardBox.y >= 0 && scrollRaceCardBox.y + scrollRaceCardBox.height <= scrollRaceViewportHeight,
  scrollRaceCardBox ? `y=${scrollRaceCardBox.y} bottom=${scrollRaceCardBox.y + scrollRaceCardBox.height} viewportH=${scrollRaceViewportHeight}` : 'no card');
await scrollRacePage.close();

/* --- Phase 12 close-out, phone-test fix round -----------------------------
   Two findings from Rocky's phone test of the Deploy Preview. (1) "swipe
   has an error on bottom": investigated and reproduced as a layout defect,
   not a broken image. A long card (a long description plus a long
   free_limit line) could make .discover-panel taller than the viewport,
   pushing the control row off-screen; interacting with an off-screen
   button then triggered the browser's own scroll-the-focused-element-
   into-view correction, an uncontrolled jump that revealed the browse list
   underneath. Fixed by capping the panel to one screenful and making the
   card body scroll internally instead. No broken image was reproducible
   anywhere in this app's own DOM, including under a driven all-404 remote
   network and across every dealt card's favicon; the checks below assert
   both halves. (2) a first-open coaching overlay, additive coachDone in
   freestack:v1:discover. */

// (1e) Layout: the panel itself must never exceed the viewport, and no
// <img> anywhere in the open deck may be broken (naturalWidth 0) while
// still occupying visible layout space, even under a hostile network
// where every remote favicon host genuinely 404s (not merely aborts).
const longestContentTool = active.reduce((best, t) => {
  const len = (t.description || '').length + (t.free_limit || '').length;
  return len > best.len ? { id: t.id, len } : best;
}, { id: null, len: -1 });

async function checkLongestCardFitsOnScreen(viewport) {
  const pg = await browser.newPage({ viewport });
  await pg.route(/^(?!.*localhost).*$/, (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' }));
  await pg.goto(`${base}/`);
  await pg.waitForSelector('#public-root .tool-card', { state: 'attached' });
  await pg.evaluate(async (id) => {
    const mod = await import('/js/discover.js');
    const toolsRes = await fetch('/data/tools.json');
    const allTools = await toolsRes.json();
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    mod.openDiscoverDeck({ tools: allTools, container: mount, opener: document.body, seed: { type: 'persona', ids: [id] } });
  }, longestContentTool.id);
  await pg.waitForSelector('.discover-card');
  if (await pg.locator('.discover-coach-dismiss').count()) await pg.locator('.discover-coach-dismiss').click();
  await pg.waitForTimeout(200);
  const panelBox = await pg.locator('.discover-panel').boundingBox();
  const haveBox = await pg.locator('.discover-btn-have').boundingBox();
  const skipBox = await pg.locator('.discover-btn-skip').boundingBox();
  const wantBox = await pg.locator('.discover-btn-want').boundingBox();
  const boxes = { haveBox, skipBox, wantBox };
  const allOnScreen = Object.values(boxes).every((b) => b && b.y >= 0 && b.y + b.height <= viewport.height);
  check(`discover: the longest-content card (id ${longestContentTool.id}) keeps all three buttons on screen at ${viewport.width}x${viewport.height}`,
    allOnScreen, JSON.stringify({ ...boxes, viewportHeight: viewport.height }));
  check(`discover: the panel itself never exceeds the viewport at ${viewport.width}x${viewport.height} (longest card)`,
    panelBox !== null && panelBox.height <= viewport.height, JSON.stringify(panelBox));
  const brokenVisibleInViewport = await pg.evaluate(() => {
    const vh = window.innerHeight;
    return [...document.querySelectorAll('img')].filter((img) => {
      const s = getComputedStyle(img);
      const rect = img.getBoundingClientRect();
      const visible = s.display !== 'none' && s.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      const inViewport = rect.top < vh && rect.bottom > 0;
      return img.naturalWidth === 0 && img.complete && visible && inViewport;
    }).length;
  });
  check(`discover: no broken (failed, complete, visible) image sits in the viewport at ${viewport.width}x${viewport.height} under an all-404 network`,
    brokenVisibleInViewport === 0, `count=${brokenVisibleInViewport}`);
  await pg.close();
}
await checkLongestCardFitsOnScreen({ width: 375, height: 812 });
await checkLongestCardFitsOnScreen({ width: 390, height: 844 });

// (2) First-open coaching overlay.
const coachFirstPage = await browser.newPage({ viewport: { width: 375, height: 812 } });
await coachFirstPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await coachFirstPage.goto(`${base}/`);
await coachFirstPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
await coachFirstPage.evaluate(() => localStorage.removeItem('freestack:v1:discover')); // genuinely first-ever
await coachFirstPage.reload();
await coachFirstPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
await coachFirstPage.locator('[data-discover-entry]').click();
await coachFirstPage.waitForSelector('.discover-card');
check('discover: the coach overlay appears on a genuinely first-ever deck open',
  (await coachFirstPage.locator('.discover-coach').count()) === 1);
check('discover: judge buttons are disabled while the coach overlay is up',
  await coachFirstPage.locator('.discover-btn-have').isDisabled());

// Rocky's phone-test finding: the old small side-text labels were unclear.
// Both directions must now render in the same large, high-contrast stamp
// treatment as the real in-card verdict stamps (colour reused exactly,
// text visibly larger than the in-card stamp's fs-18), always at full
// opacity so the message reads on a single static glance, not just mid
// animation.
const coachStampInfo = await coachFirstPage.evaluate(() => {
  const have = document.querySelector('.discover-coach-stamp-have');
  const want = document.querySelector('.discover-coach-stamp-want');
  const px = (v) => Number.parseFloat(v);
  return {
    haveText: have?.textContent.trim(),
    wantText: want?.textContent.trim(),
    haveColor: have ? getComputedStyle(have).color : null,
    wantColor: want ? getComputedStyle(want).color : null,
    haveOpacity: have ? getComputedStyle(have).opacity : null,
    arrowFontSize: have ? px(getComputedStyle(have.querySelector('.discover-coach-stamp-arrow')).fontSize) : 0,
    inCardStampFontSize: px(getComputedStyle(document.querySelector('.discover-stamp-have')).fontSize),
  };
});
const realStampColors = await coachFirstPage.evaluate(() => ({
  have: getComputedStyle(document.querySelector('.discover-stamp-have')).color,
  want: getComputedStyle(document.querySelector('.discover-stamp-want')).color,
}));
check('discover: both direction labels are present with the arrow and stamp word',
  /got it/i.test(coachStampInfo.haveText) && coachStampInfo.haveText.includes('←')
  && /my list/i.test(coachStampInfo.wantText) && coachStampInfo.wantText.includes('→'),
  JSON.stringify({ have: coachStampInfo.haveText, want: coachStampInfo.wantText }));
check('discover: the direction labels reuse the exact real-stamp colours (have and want)',
  coachStampInfo.haveColor === realStampColors.have && coachStampInfo.wantColor === realStampColors.want,
  JSON.stringify({ coach: { have: coachStampInfo.haveColor, want: coachStampInfo.wantColor }, real: realStampColors }));
check('discover: the direction labels are visibly large, well past the in-card stamp size, and fully opaque',
  coachStampInfo.arrowFontSize > coachStampInfo.inCardStampFontSize && coachStampInfo.haveOpacity === '1',
  `arrow=${coachStampInfo.arrowFontSize} inCard=${coachStampInfo.inCardStampFontSize} opacity=${coachStampInfo.haveOpacity}`);

await coachFirstPage.locator('.discover-coach-dismiss').click();
await coachFirstPage.waitForTimeout(150);
const coachDoneAfterDismiss = await coachFirstPage.evaluate(() => JSON.parse(localStorage.getItem('freestack:v1:discover')).coachDone);
const decisionsAfterCoachDismiss = await coachFirstPage.evaluate(() => JSON.parse(localStorage.getItem('freestack:v1:discover')).decisions);
check('discover: dismissing the coach records coachDone and judges nothing',
  coachDoneAfterDismiss === true && Object.keys(decisionsAfterCoachDismiss).length === 0,
  `coachDone=${coachDoneAfterDismiss} decisions=${JSON.stringify(decisionsAfterCoachDismiss)}`);

await coachFirstPage.locator('.discover-close').click();
await coachFirstPage.waitForTimeout(150);
await coachFirstPage.locator('[data-discover-entry]').click();
await coachFirstPage.waitForSelector('.discover-card');
check('discover: a reopened deck shows no coach overlay once coachDone is set',
  (await coachFirstPage.locator('.discover-coach').count()) === 0);
await coachFirstPage.close();

// coach does not appear once any judgement already exists (an existing
// device with real history, even one that somehow has coachDone unset).
const coachJudgedPage = await browser.newPage({ viewport: { width: 375, height: 812 } });
await coachJudgedPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await coachJudgedPage.goto(`${base}/`);
await coachJudgedPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
await coachJudgedPage.evaluate(() => localStorage.setItem('freestack:v1:discover', JSON.stringify({
  v: 1, lastVisit: new Date().toISOString(), seenIds: [0], decisions: { 0: { d: 'have', t: Date.now() } },
})));
await coachJudgedPage.reload();
await coachJudgedPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
await coachJudgedPage.locator('[data-discover-entry]').click();
await coachJudgedPage.waitForSelector('.discover-card');
check('discover: the coach overlay does not appear once any judgement already exists',
  (await coachJudgedPage.locator('.discover-coach').count()) === 0);
await coachJudgedPage.close();

// Auto-dismiss within roughly 6 seconds, no interaction at all.
const coachTimeoutPage = await browser.newPage({ viewport: { width: 375, height: 812 } });
await coachTimeoutPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await coachTimeoutPage.goto(`${base}/`);
await coachTimeoutPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
await coachTimeoutPage.evaluate(() => localStorage.removeItem('freestack:v1:discover'));
await coachTimeoutPage.reload();
await coachTimeoutPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
await coachTimeoutPage.locator('[data-discover-entry]').click();
await coachTimeoutPage.waitForSelector('.discover-coach');
await coachTimeoutPage.waitForTimeout(6000);
const coachGoneUnattended = (await coachTimeoutPage.locator('.discover-coach').count()) === 0;
const decisionsAfterCoachTimeout = await coachTimeoutPage.evaluate(() => JSON.parse(localStorage.getItem('freestack:v1:discover')).decisions);
check('discover: the coach overlay disappears within about 6 seconds with no interaction',
  coachGoneUnattended, `coachStillVisible=${!coachGoneUnattended}`);
check('discover: auto-dismiss never judges a card', Object.keys(decisionsAfterCoachTimeout).length === 0, JSON.stringify(decisionsAfterCoachTimeout));
await coachTimeoutPage.close();

/* --- Phase 12.3: list parity and quick-judge (PRD section 16) -------------
   getDecision/setDecision/clearDecision/subscribe live in js/discover.js;
   this section drives them only through the UI (the browse list's chip
   chooser and corner buttons, and the deck itself), the same way a reader
   would, never by calling the module's exports directly. */
async function toolNameFor(pg, id) {
  return pg.evaluate(async (rawId) => {
    const res = await fetch('/data/tools.json');
    const tools = await res.json();
    return tools.find((t) => String(t.id) === rawId)?.name;
  }, id);
}
function browseCardFor(pg, name) {
  return pg.locator('#public-root .card-grid > li', { hasText: name }).first();
}

// Tool 0, judged left in the deck (have), must appear as a chip on the
// matching browse card, and the chooser's Clear must remove it from the
// exact localStorage shape the deck itself writes (decisions keyed by
// decimal id string, "0" included, per PRD section 17).
const parityPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await parityPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await openDiscoverDeck(parityPage);
await clearDiscoverStorage(parityPage);
await parityPage.reload();
await parityPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
await parityPage.locator('[data-discover-entry]').click();
await parityPage.waitForSelector('.discover-card');
const parityFirstId = await parityPage.locator('.discover-card').getAttribute('data-id');
await parityPage.locator('.discover-panel').press('ArrowLeft'); // have
await parityPage.waitForTimeout(400);
await parityPage.locator('.discover-close').click();
await parityPage.waitForTimeout(300); // let the judgement-parity bootstrap import/decorate settle
// Phase 14.1 adaptation: the browse card lives inside a collapsed shelf by
// default; expand every shelf so it can be scrolled to and clicked.
await expandAllShelves(parityPage);

const parityToolName = await toolNameFor(parityPage, parityFirstId);
const parityCard = browseCardFor(parityPage, parityToolName);
await parityCard.scrollIntoViewIfNeeded();
const chipText = await parityCard.locator('.pub-judge-chip').textContent().catch(() => '');
check('parity: a deck decision (tool 0, have) renders as a list chip',
  parityFirstId === '0' && chipText.trim() === 'Got it', `id=${parityFirstId} chip="${chipText}"`);

await parityCard.locator('.pub-judge-chip').click();
await parityPage.waitForTimeout(150);
await parityCard.locator('.pub-judge-chooser button', { hasText: 'Clear' }).click();
await parityPage.waitForTimeout(200);
const decisionsAfterChooserClear = await parityPage.evaluate(() => JSON.parse(localStorage.getItem('freestack:v1:discover')).decisions);
const chipCountAfterClear = await parityCard.locator('.pub-judge-chip').count();
check('parity: chooser Clear removes the id from the stored decisions object',
  !('0' in decisionsAfterChooserClear) && chipCountAfterClear === 0, JSON.stringify(decisionsAfterChooserClear));
await parityPage.close();

// Corner quick-judge: present and operable under (hover: hover) and
// (pointer: fine), and includes the clear-on-second-activation path.
const finePage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await finePage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await finePage.goto(`${base}/`);
await finePage.waitForSelector('#public-root .tool-card', { state: 'attached' });
await finePage.evaluate(() => localStorage.removeItem('freestack:v1:discover'));
await finePage.reload();
await finePage.waitForSelector('#public-root .tool-card', { state: 'attached' });
await finePage.waitForTimeout(400); // let the discover.js dynamic import resolve
// Phase 14.1 adaptation: the first card lives inside a collapsed shelf.
await expandAllShelves(finePage);
const fineFirstLi = finePage.locator('#public-root .card-grid > li').first();
await fineFirstLi.hover();
const railDisplayFine = await fineFirstLi.locator('.pub-judge-rail').evaluate((n) => getComputedStyle(n).display);
check('parity: the quick-judge rail is shown under (hover: hover) and (pointer: fine)',
  railDisplayFine === 'flex', railDisplayFine);
await fineFirstLi.locator('.pub-judge-rail-have').click();
await finePage.waitForTimeout(200);
const decisionsAfterRailSet = await finePage.evaluate(() => JSON.parse(localStorage.getItem('freestack:v1:discover')).decisions);
await fineFirstLi.hover();
await fineFirstLi.locator('.pub-judge-rail-have').click(); // second activation of the same control
await finePage.waitForTimeout(200);
const decisionsAfterRailClear = await finePage.evaluate(() => JSON.parse(localStorage.getItem('freestack:v1:discover')).decisions);
check('parity: a second activation of the same rail control clears the decision',
  decisionsAfterRailSet['0']?.d === 'have' && !('0' in decisionsAfterRailClear),
  `afterSet=${JSON.stringify(decisionsAfterRailSet)} afterClear=${JSON.stringify(decisionsAfterRailClear)}`);
await finePage.close();

// Coarse pointer: the rail must be entirely absent, not merely invisible.
// Playwright has no direct "force (pointer: coarse)" media override, so
// this emulates a touch/mobile device (hasTouch + isMobile), which is how
// Chromium itself derives (hover: none)/(pointer: coarse) from the device
// metrics override; a plain context with no touch always reports
// (hover: hover)/(pointer: fine) regardless of viewport width alone.
const coarseCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const coarsePage = await coarseCtx.newPage();
await coarsePage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await coarsePage.goto(`${base}/`);
await coarsePage.waitForSelector('#public-root .tool-card', { state: 'attached' });
const coarseMediaMatches = await coarsePage.evaluate(() => ({
  hoverNone: matchMedia('(hover: none)').matches,
  pointerCoarse: matchMedia('(pointer: coarse)').matches,
}));
await coarsePage.waitForTimeout(400);
const coarseRailDisplay = await coarsePage.locator('#public-root .card-grid > li').first()
  .locator('.pub-judge-rail').evaluate((n) => getComputedStyle(n).display);
check('parity: the quick-judge rail is absent (display: none) under coarse-pointer emulation',
  coarseMediaMatches.hoverNone && coarseMediaMatches.pointerCoarse && coarseRailDisplay === 'none',
  JSON.stringify({ ...coarseMediaMatches, display: coarseRailDisplay }));
await coarseCtx.close();

// 44px targets: the chip and every chooser option, at 375px.
const parity375 = await browser.newPage({ viewport: { width: 375, height: 900 } });
await parity375.route(/^(?!.*localhost).*$/, (route) => route.abort());
await openDiscoverDeck(parity375);
await clearDiscoverStorage(parity375);
await parity375.reload();
await parity375.waitForSelector('#public-root .tool-card', { state: 'attached' });
await parity375.locator('[data-discover-entry]').click();
await parity375.waitForSelector('.discover-card');
await parity375.locator('.discover-panel').press('ArrowLeft');
await parity375.waitForTimeout(400);
await parity375.locator('.discover-close').click();
await parity375.waitForTimeout(300);
// Phase 14.1 adaptation: the browse card lives inside a collapsed shelf.
await expandAllShelves(parity375);
const parity375ToolName = await toolNameFor(parity375, '0');
const parity375Card = browseCardFor(parity375, parity375ToolName);
await parity375Card.scrollIntoViewIfNeeded();
const chipBox375 = await parity375Card.locator('.pub-judge-chip').boundingBox();
await parity375Card.locator('.pub-judge-chip').click();
await parity375.waitForTimeout(150);
const chooserBoxes375 = await parity375Card.locator('.pub-judge-chooser button').evaluateAll(
  (nodes) => nodes.map((n) => n.getBoundingClientRect().height));
check('parity: state chip is at least 44px tall at 375px', chipBox375 && chipBox375.height >= 44, JSON.stringify(chipBox375));
check('parity: every chooser option is at least 44px tall at 375px',
  chooserBoxes375.length === 3 && chooserBoxes375.every((h) => h >= 44), JSON.stringify(chooserBoxes375));
await parity375.close();

// Reveal-once law extended to this redraw path, adapted for Phase 14.1's
// shelf architecture the same way the earlier no-refire regression was:
// opening or acting on the chooser must never rebuild a settled shelf's
// DOM. There is no more per-category opacity reveal to poll (see the
// no-refire block above); the equivalent honest guard is the same
// DOM-identity marker check.
const parityRevealPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await parityRevealPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await openDiscoverDeck(parityRevealPage);
await clearDiscoverStorage(parityRevealPage);
await parityRevealPage.reload();
await parityRevealPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
await parityRevealPage.waitForTimeout(700); // let the first-screen entrance reveal finish
await parityRevealPage.locator('[data-discover-entry]').click();
await parityRevealPage.waitForSelector('.discover-card');
await parityRevealPage.locator('.discover-panel').press('ArrowLeft');
await parityRevealPage.waitForTimeout(400);
await parityRevealPage.locator('.discover-close').click();
await parityRevealPage.waitForTimeout(300);
await expandAllShelves(parityRevealPage);
const parityCategoryOrder = [];
for (const t of active) { if (!parityCategoryOrder.includes(t.category)) parityCategoryOrder.push(t.category); }
const parityTargetCategory = parityCategoryOrder[1] ?? parityCategoryOrder[0];
const parityHeading = parityRevealPage.locator('.pub-shelf-header', { hasText: parityTargetCategory }).first();
await parityHeading.scrollIntoViewIfNeeded();
await parityHeading.evaluate((n) => { n.dataset.stabilityMarker = 'kept'; });
const parityToolNameForReveal = await toolNameFor(parityRevealPage, '0');
const parityRevealCard = browseCardFor(parityRevealPage, parityToolNameForReveal);
await parityRevealCard.scrollIntoViewIfNeeded();
await parityRevealCard.locator('.pub-judge-chip').click();
await parityRevealPage.waitForTimeout(300);
await parityRevealCard.locator('.pub-judge-chooser button', { hasText: 'Clear' }).click();
await parityRevealPage.waitForTimeout(300);
const parityMarkerAfter = await parityHeading.evaluate((n) => n.dataset.stabilityMarker).catch(() => null);
check('parity: opening and acting on the chooser never rebuilds a settled shelf',
  parityMarkerAfter === 'kept', `marker=${parityMarkerAfter} category="${parityTargetCategory}"`);
await parityRevealPage.close();

// Counts agree: judge a deck through to completion, change one decision via
// the browse-list chooser while the completion card is still showing, and
// confirm its summary and hand-off link update in place (PRD section 16:
// "Deck and list never disagree after a repaint").
const countsPage = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
await countsPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await openDiscoverDeck(countsPage);
await clearDiscoverStorage(countsPage);
await countsPage.reload();
await countsPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
await countsPage.locator('[data-discover-entry]').click();
await countsPage.waitForSelector('.discover-card');
let countsGuard = 0;
while ((await countsPage.locator('.discover-completion').count()) === 0 && countsGuard < 14) {
  await countsPage.locator('.discover-panel').press(countsGuard % 2 === 0 ? 'ArrowLeft' : 'ArrowRight');
  await countsPage.waitForTimeout(300);
  countsGuard++;
}
await countsPage.waitForSelector('.discover-completion');
// Phase 14.1 adaptation: the browse card lives inside a collapsed shelf.
await expandAllShelves(countsPage);
const decisionsBeforeCountsEdit = await countsPage.evaluate(() => JSON.parse(localStorage.getItem('freestack:v1:discover')).decisions);
const haveIdToClear = Object.entries(decisionsBeforeCountsEdit).find(([, v]) => v.d === 'have')?.[0];
const haveCountBefore = Object.values(decisionsBeforeCountsEdit).filter((v) => v.d === 'have').length;
const countsToolName = await toolNameFor(countsPage, haveIdToClear);
const countsCard = browseCardFor(countsPage, countsToolName);
await countsCard.scrollIntoViewIfNeeded();
await countsCard.locator('.pub-judge-chip').click();
await countsPage.waitForTimeout(150);
await countsCard.locator('.pub-judge-chooser button', { hasText: 'Clear' }).click();
await countsPage.waitForTimeout(300);
const completionSummaryAfterEdit = await countsPage.locator('.discover-completion p').first().textContent();
const expectedHaveCount = haveCountBefore - 1;
check('parity: the still-open deck completion card updates its counts after a chooser change',
  completionSummaryAfterEdit.startsWith(`${expectedHaveCount} got it`),
  `expected=${expectedHaveCount} summary="${completionSummaryAfterEdit}"`);
const completionHandoffAfterEdit = await countsPage.locator('.discover-completion-actions a.btn').getAttribute('href').catch(() => null);
check('parity: the hand-off link no longer includes the id cleared via the chooser',
  completionHandoffAfterEdit === null || !(completionHandoffAfterEdit.split('have=')[1] ?? '').split(',').includes(haveIdToClear),
  `href=${completionHandoffAfterEdit} cleared=${haveIdToClear}`);
await countsPage.close();

// Keyboard-only operation of the chip chooser: Enter opens it, Tab reaches
// the first option, Escape closes it and returns focus to the chip.
const keyboardPage = await browser.newPage();
await keyboardPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await openDiscoverDeck(keyboardPage);
await clearDiscoverStorage(keyboardPage);
await keyboardPage.reload();
await keyboardPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
await keyboardPage.locator('[data-discover-entry]').click();
await keyboardPage.waitForSelector('.discover-card');
await keyboardPage.locator('.discover-panel').press('ArrowLeft');
await keyboardPage.waitForTimeout(400);
await keyboardPage.locator('.discover-close').click();
await keyboardPage.waitForTimeout(300);
// Phase 14.1 adaptation: the browse card lives inside a collapsed shelf.
await expandAllShelves(keyboardPage);
const keyboardToolName = await toolNameFor(keyboardPage, '0');
const keyboardCard = browseCardFor(keyboardPage, keyboardToolName);
await keyboardCard.scrollIntoViewIfNeeded();
await keyboardCard.locator('.pub-judge-chip').focus();
await keyboardPage.keyboard.press('Enter');
await keyboardPage.waitForTimeout(150);
const chooserOpenedByKeyboard = await keyboardCard.locator('.pub-judge-chooser').count();
await keyboardPage.keyboard.press('Tab');
const focusedAfterTab = await keyboardPage.evaluate(() => document.activeElement?.textContent);
await keyboardPage.keyboard.press('Escape');
await keyboardPage.waitForTimeout(150);
const chooserClosedByEscape = await keyboardCard.locator('.pub-judge-chooser').count();
const focusAfterEscape = await keyboardPage.evaluate(() => document.activeElement?.classList.contains('pub-judge-chip'));
check('parity: the chip chooser opens on Enter, tabs to its first option and closes on Escape with focus restored',
  chooserOpenedByKeyboard === 1 && focusedAfterTab === 'Got it' && chooserClosedByEscape === 0 && focusAfterEscape === true,
  `opened=${chooserOpenedByKeyboard} tabbedTo="${focusedAfterTab}" closed=${chooserClosedByEscape} focusBack=${focusAfterEscape}`);
await keyboardPage.close();

/* --- Phase 12.3 verifier fix round: dismissal, corner overlap, module
   failure tolerance ---------------------------------------------------- */

// (a) Outside click: a pointerdown outside the chooser and its own chip
// closes it. Clicking the search input is the exact repro from the
// verifier's report (it used to leave the chooser open).
const outsideClickPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await outsideClickPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await openDiscoverDeck(outsideClickPage);
await clearDiscoverStorage(outsideClickPage);
await outsideClickPage.reload();
await outsideClickPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
await outsideClickPage.locator('[data-discover-entry]').click();
await outsideClickPage.waitForSelector('.discover-card');
await outsideClickPage.locator('.discover-panel').press('ArrowLeft');
await outsideClickPage.waitForTimeout(400);
await outsideClickPage.locator('.discover-close').click();
await outsideClickPage.waitForTimeout(300);
// Phase 14.1 adaptation: the browse card lives inside a collapsed shelf.
await expandAllShelves(outsideClickPage);
const outsideClickToolName = await toolNameFor(outsideClickPage, '0');
const outsideClickCard = browseCardFor(outsideClickPage, outsideClickToolName);
await outsideClickCard.scrollIntoViewIfNeeded();
await outsideClickCard.locator('.pub-judge-chip').click();
await outsideClickPage.waitForTimeout(150);
const chooserOpenBeforeOutsideClick = await outsideClickCard.locator('.pub-judge-chooser').count();
await outsideClickPage.locator('#public-root input[type=search]').click();
await outsideClickPage.waitForTimeout(150);
const chooserOpenAfterOutsideClick = await outsideClickCard.locator('.pub-judge-chooser').count();
const searchFocusedAfter = await outsideClickPage.evaluate(() => document.activeElement === document.querySelector('#public-root input[type=search]'));
check('parity: a click outside the chooser (the search input) closes it and still focuses the clicked control',
  chooserOpenBeforeOutsideClick === 1 && chooserOpenAfterOutsideClick === 0 && searchFocusedAfter === true,
  `before=${chooserOpenBeforeOutsideClick} after=${chooserOpenAfterOutsideClick} searchFocused=${searchFocusedAfter}`);
await outsideClickPage.close();

// (b) Escape pressed while focus is still on the chip, never having tabbed
// into the chooser at all: the previous Escape check above tabs into the
// chooser first, which is exactly why it missed this defect (a chooser-
// scoped keydown listener never sees a keydown whose target is the chip).
const escapeFromChipPage = await browser.newPage();
await escapeFromChipPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await openDiscoverDeck(escapeFromChipPage);
await clearDiscoverStorage(escapeFromChipPage);
await escapeFromChipPage.reload();
await escapeFromChipPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
await escapeFromChipPage.locator('[data-discover-entry]').click();
await escapeFromChipPage.waitForSelector('.discover-card');
await escapeFromChipPage.locator('.discover-panel').press('ArrowLeft');
await escapeFromChipPage.waitForTimeout(400);
await escapeFromChipPage.locator('.discover-close').click();
await escapeFromChipPage.waitForTimeout(300);
// Phase 14.1 adaptation: the browse card lives inside a collapsed shelf.
await expandAllShelves(escapeFromChipPage);
const escapeFromChipToolName = await toolNameFor(escapeFromChipPage, '0');
const escapeFromChipCard = browseCardFor(escapeFromChipPage, escapeFromChipToolName);
await escapeFromChipCard.scrollIntoViewIfNeeded();
await escapeFromChipCard.locator('.pub-judge-chip').focus();
await escapeFromChipPage.keyboard.press('Enter');
await escapeFromChipPage.waitForTimeout(150);
const chooserOpenBeforeEscape = await escapeFromChipCard.locator('.pub-judge-chooser').count();
await escapeFromChipPage.keyboard.press('Escape'); // focus is still on the chip, never tabbed in
await escapeFromChipPage.waitForTimeout(150);
const chooserOpenAfterEscapeFromChip = await escapeFromChipCard.locator('.pub-judge-chooser').count();
const focusStillChipAfterEscape = await escapeFromChipPage.evaluate(() => document.activeElement?.classList.contains('pub-judge-chip'));
check('parity: Escape pressed with focus still on the chip (no Tab into the chooser) closes it',
  chooserOpenBeforeEscape === 1 && chooserOpenAfterEscapeFromChip === 0 && focusStillChipAfterEscape === true,
  `before=${chooserOpenBeforeEscape} after=${chooserOpenAfterEscapeFromChip} focusOnChip=${focusStillChipAfterEscape}`);
await escapeFromChipPage.close();

// (c) Rail overlap, re-verified round 2: the tick/plus used to be an
// absolutely-positioned overlay whose vertical offset was measured in JS
// from .card-top's rendered height. That raced the grid's own layout on
// fresh load (a wrapped two-line title had not reached its settled height
// yet when read) and never recomputed on resize, so it intermittently
// landed back on top of the header it was meant to clear. The rail is now
// a normal-flow sibling of the card with no position and no measurement at
// all, so it cannot occupy the same pixels as the card's own name, favicon
// or value by construction; this still checks it empirically, on the first
// card, on the two longest active tool names (derived from tools.json
// itself so the check keeps meaning if the data changes, rather than
// hard-coding the ids the re-verifier's own repro happened to use), at
// 1024, 1280 and 1440px after a settled load, and across a resize with no
// reload, which a JS-measured, load-time-only offset could never survive.
function rectsOverlap(a, b) {
  if (!a || !b) return false;
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
async function railClearance(li) {
  const h3Box = await li.locator('article .card-top h3').first().boundingBox();
  const faviconBox = await li.locator('article .card-top .favicon').first().boundingBox().catch(() => null);
  const valueBox = await li.locator('article .card-top .card-value').first().boundingBox();
  const haveBox = await li.locator('.pub-judge-rail-have').boundingBox();
  const wantBox = await li.locator('.pub-judge-rail-want').boundingBox();
  const overlap = [h3Box, faviconBox, valueBox].some((content) => [haveBox, wantBox].some((rail) => rectsOverlap(content, rail)));
  return { overlap, h3Box, faviconBox, valueBox, haveBox, wantBox };
}
function cardByName(pg, name) {
  return pg.locator('#public-root .card-grid > li').filter({ has: pg.locator('h3', { hasText: name }) }).first();
}

// First card (kept from the previous round).
const railOverlapPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await railOverlapPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await railOverlapPage.goto(`${base}/`);
await railOverlapPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
await railOverlapPage.waitForTimeout(400); // let discover.js resolve so the rail actually renders
// Phase 14.1 adaptation: the first card lives inside a collapsed shelf.
await expandAllShelves(railOverlapPage);
const railLi = railOverlapPage.locator('#public-root .card-grid > li').first();
await railLi.hover();
const firstCardClearance = await railClearance(railLi);
check('parity: the quick-judge rail never intersects the first card\'s name, favicon or value badge at 1280px',
  !firstCardClearance.overlap, JSON.stringify(firstCardClearance));
await railOverlapPage.close();

// Data-driven: the two longest active tool names, the cards most likely to
// wrap onto a second line, at three widths, each a fresh settled load.
const longestNameTools = [...active].sort((a, b) => b.name.length - a.name.length).slice(0, 2);
for (const width of [1024, 1280, 1440]) {
  const widthPage = await browser.newPage({ viewport: { width, height: 900 } });
  await widthPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
  await widthPage.goto(`${base}/`);
  await widthPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
  await widthPage.waitForTimeout(400); // settled load
  // Phase 14.1 adaptation: named cards live inside collapsed shelves.
  await expandAllShelves(widthPage);
  for (const tool of longestNameTools) {
    const li = cardByName(widthPage, tool.name);
    await li.scrollIntoViewIfNeeded();
    await li.hover();
    const clearance = await railClearance(li);
    check(`parity: rail clears "${tool.name}" (longest active name) at ${width}px`, !clearance.overlap, JSON.stringify(clearance));
  }
  await widthPage.close();
}

// Resize case: load at 1024, resize to 1280 with no reload (re-wraps a long
// title differently), re-hover, assert clearance still holds.
const resizePage = await browser.newPage({ viewport: { width: 1024, height: 900 } });
await resizePage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await resizePage.goto(`${base}/`);
await resizePage.waitForSelector('#public-root .tool-card', { state: 'attached' });
await resizePage.waitForTimeout(400);
await resizePage.setViewportSize({ width: 1280, height: 900 });
await resizePage.waitForTimeout(150);
// Phase 14.1 adaptation: named cards live inside collapsed shelves.
await expandAllShelves(resizePage);
for (const tool of longestNameTools) {
  const li = cardByName(resizePage, tool.name);
  await li.scrollIntoViewIfNeeded();
  await li.hover();
  const clearance = await railClearance(li);
  check(`parity: rail still clears "${tool.name}" after a 1024→1280 resize with no reload`, !clearance.overlap, JSON.stringify(clearance));
}
await resizePage.close();

// (d) js/discover.js blocked entirely (PRD 16 AC7, never automated before
// this fix round): the browse list must still render every active card,
// with zero page errors and no judgement chips at all (there is nothing to
// read a decision from without the module).
const discoverBlockedPage = await browser.newPage();
const discoverBlockedErrors = [];
discoverBlockedPage.on('pageerror', (e) => discoverBlockedErrors.push(String(e)));
discoverBlockedPage.on('console', (m) => { if (m.type() === 'error' && !/net::|Failed to load resource/.test(m.text())) discoverBlockedErrors.push(m.text()); });
await discoverBlockedPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await discoverBlockedPage.route('**/js/discover.js', (route) => route.abort());
await discoverBlockedPage.goto(`${base}/`);
await discoverBlockedPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
await discoverBlockedPage.waitForTimeout(500); // give the aborted dynamic import time to settle
check('parity: with js/discover.js blocked, every active card still renders',
  await discoverBlockedPage.locator('#public-root .tool-card').count() === active.length);
check('parity: with js/discover.js blocked, no judgement chips render (nothing to read a decision from)',
  await discoverBlockedPage.locator('.pub-judge-chip').count() === 0);
check('parity: with js/discover.js blocked, no page/console errors', discoverBlockedErrors.length === 0, discoverBlockedErrors.join(' | ').slice(0, 300));
await discoverBlockedPage.close();

/* --- Wave 14.2: motion inventory close-out (PRD section 16 amended) -------
   The shelf-stagger checks live earlier, right after the shelf mechanics
   they extend. Everything else BUILD-PLAN 14.2 names: the two easing
   tokens, a full reduced-motion sweep sampling computed state at the
   remaining trigger points (deck-open morph, judged-chip pop, theme
   toggle, filter/expand-all), a stubbed non-VT browser proving every
   interaction still completes with startViewTransition deleted, and the
   .is-new load-time exclusion. */

// Easing tokens present in colors_and_type.css, byte-checked (pure Node,
// no browser): the PRD gives exact cubic-bezier values, not just names.
const colorsAndType = (await readFile(join(ROOT, 'design-system', 'colors_and_type.css'))).toString('utf8');
check('motion: --ease-swift present with the exact PRD value',
  colorsAndType.includes('--ease-swift:  cubic-bezier(0.22, 1, 0.36, 1)') || colorsAndType.includes('--ease-swift: cubic-bezier(0.22, 1, 0.36, 1)'));
check('motion: --ease-spring present with the exact PRD value',
  colorsAndType.includes('--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1)'));

// Reduced motion sweep: one page, sampling computed state at each trigger
// point named in BUILD-PLAN 14.2, plus a live count of startViewTransition
// calls (theme toggle and filters must be instant AND never even attempt a
// transition under reduced motion, not just visually settle instantly).
const reducedSweepPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await reducedSweepPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await reducedSweepPage.emulateMedia({ reducedMotion: 'reduce' });
await reducedSweepPage.addInitScript(() => {
  window.__vtCalls = 0;
  const install = () => {
    if (typeof document.startViewTransition !== 'function') return;
    const orig = document.startViewTransition.bind(document);
    document.startViewTransition = (...args) => { window.__vtCalls++; return orig(...args); };
  };
  install();
});
await reducedSweepPage.goto(`${base}/`);
await reducedSweepPage.waitForSelector('#public-root .tool-card', { state: 'attached' });

// Item 6: theme toggle, instant, no view transition attempted.
await reducedSweepPage.locator('.theme-toggle').first().click();
await reducedSweepPage.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
const vtCallsAfterTheme = await reducedSweepPage.evaluate(() => window.__vtCalls);
check('motion: reduced motion: theme toggle never calls startViewTransition and swaps instantly',
  vtCallsAfterTheme === 0, `vtCalls=${vtCallsAfterTheme}`);
await reducedSweepPage.locator('.theme-toggle').first().click();
await reducedSweepPage.waitForFunction(() => document.documentElement.dataset.theme === 'light');

// Item 3: Expand all, instant, no view transition attempted.
await reducedSweepPage.locator('.pub-expand-all').click();
await reducedSweepPage.waitForFunction(() => document.querySelectorAll('.pub-shelf-grid[hidden]').length === 0);
const vtCallsAfterExpandAll = await reducedSweepPage.evaluate(() => window.__vtCalls);
check('motion: reduced motion: Expand all never calls startViewTransition',
  vtCallsAfterExpandAll === 0, `vtCalls=${vtCallsAfterExpandAll}`);

// Item 4: deck-open morph, no view-transition-name class ever applied, no
// startViewTransition call, focus lands in the panel immediately (not
// deferred, since there is no transition to defer past).
await reducedSweepPage.locator('[data-discover-entry]').click();
await reducedSweepPage.waitForSelector('.discover-card');
const vtCallsAfterDeckOpen = await reducedSweepPage.evaluate(() => window.__vtCalls);
const deckOpenReducedState = await reducedSweepPage.evaluate(() => ({
  anyVtNameClass: document.querySelectorAll('.pub-vt-discover').length,
  focusInPanel: document.activeElement?.classList.contains('discover-panel') === true,
}));
check('motion: reduced motion: deck-open never calls startViewTransition or applies the morph class',
  vtCallsAfterDeckOpen === 0 && deckOpenReducedState.anyVtNameClass === 0, JSON.stringify({ vtCallsAfterDeckOpen, ...deckOpenReducedState }));
check('motion: reduced motion: deck-open focuses the panel immediately (fallback path, no deferral)',
  deckOpenReducedState.focusInPanel === true, JSON.stringify(deckOpenReducedState));

// Item 5: judged-chip pop, no .is-new class and no scale/rotate transform
// ever observed, mid-flight, under reduced motion.
const reducedSweepFirstCardId = await reducedSweepPage.locator('.discover-card').getAttribute('data-id');
await reducedSweepPage.locator('.discover-btn-have').click();
await reducedSweepPage.waitForFunction((id) => {
  const li = document.querySelector(`.card-grid > li[data-id="${id}"]`);
  return li && li.querySelector('.pub-judge-chip');
}, reducedSweepFirstCardId);
const chipReducedState = await reducedSweepPage.evaluate((id) => {
  const li = document.querySelector(`.card-grid > li[data-id="${id}"]`);
  const chip = li.querySelector('.pub-judge-chip');
  const cs = getComputedStyle(chip);
  return { hasIsNew: chip.classList.contains('is-new'), transform: cs.transform, opacity: cs.opacity };
}, reducedSweepFirstCardId);
check('motion: reduced motion: a fresh judgement never marks the chip is-new (no scale, no rotate)',
  chipReducedState.hasIsNew === false && (chipReducedState.transform === 'none' || !/matrix\(0\.\d/.test(chipReducedState.transform)),
  JSON.stringify(chipReducedState));
await reducedSweepPage.close();

// Stubbed non-VT browser (startViewTransition deleted via init script,
// simulating an unsupported browser): every interaction must complete
// identically minus the transition. Normal motion (no reducedMotion
// emulation), since this is testing feature-detection, not the separate
// reduced-motion guard already swept above.
const noVtPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await noVtPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await noVtPage.addInitScript(() => { document.startViewTransition = undefined; });
await noVtPage.goto(`${base}/`);
await noVtPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
check('motion: stubbed non-VT browser: startViewTransition really is absent',
  (await noVtPage.evaluate(() => typeof document.startViewTransition)) === 'undefined');

const noVtThemeBefore = await noVtPage.evaluate(() => document.documentElement.dataset.theme);
await noVtPage.locator('.theme-toggle').first().click();
await noVtPage.waitForFunction((before) => document.documentElement.dataset.theme !== before, noVtThemeBefore);
check('motion: stubbed non-VT browser: theme toggle still flips', true);
await noVtPage.locator('.theme-toggle').first().click(); // restore

await noVtPage.locator('.pub-expand-all').click();
await noVtPage.waitForFunction(() => document.querySelectorAll('.pub-shelf-grid[hidden]').length === 0);
check('motion: stubbed non-VT browser: Expand all still opens every shelf', true);
await noVtPage.locator('.pub-expand-all').click();
await noVtPage.waitForFunction(() => document.querySelectorAll('.pub-shelf-grid:not([hidden])').length === 0);

await noVtPage.fill('#public-root input[type=search]', tool0.name);
await noVtPage.waitForFunction((slug) => {
  const grid = document.getElementById(`cat-${slug}`)?.querySelector('.pub-shelf-grid');
  return grid && !grid.hidden;
}, tool0Slug);
check('motion: stubbed non-VT browser: search still force-opens the matching shelf', true);
await noVtPage.fill('#public-root input[type=search]', '');
await noVtPage.waitForFunction(() => document.querySelectorAll('#public-root .card-grid > li[hidden]').length === 0);

await noVtPage.locator('[data-discover-entry]').click();
await noVtPage.waitForSelector('.discover-card');
const noVtDeckState = await noVtPage.evaluate(() => ({
  anyVtNameClass: document.querySelectorAll('.pub-vt-discover').length,
  focusInPanel: document.activeElement?.classList.contains('discover-panel') === true,
}));
check('motion: stubbed non-VT browser: deck still opens, focuses the panel, applies no morph class',
  noVtDeckState.anyVtNameClass === 0 && noVtDeckState.focusInPanel === true, JSON.stringify(noVtDeckState));
await noVtPage.close();

// .is-new never applied during load-time redecoration (a stored decision
// from a previous session, present before the page ever mounts, must never
// pop), contrasted against a genuinely fresh judgement in the same run,
// which must. Two separate pages, not a judge-then-reload sequence on one:
// reloading mid-session here runs into a pre-existing, unrelated defect
// (tracked below, out of scope for this wave) where the judgement-parity
// bootstrap does not always re-decorate a reloaded page's cards; seeding
// the decision via addInitScript, the same technique
// seedCoachDoneBeforeLoad already uses, is both the correct test for "load
// time" (the decision exists before first paint, exactly what the spec
// means by it) and sidesteps that unrelated defect entirely.
const isNewFreshPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await isNewFreshPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await seedCoachDoneBeforeLoad(isNewFreshPage);
await isNewFreshPage.goto(`${base}/`, { waitUntil: 'load' });
await isNewFreshPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
await isNewFreshPage.locator('[data-discover-entry]').click();
await isNewFreshPage.waitForSelector('.discover-card');
const isNewFirstId = await isNewFreshPage.locator('.discover-card').getAttribute('data-id');
await isNewFreshPage.locator('.discover-btn-have').click();
await isNewFreshPage.waitForFunction((id) => {
  const li = document.querySelector(`.card-grid > li[data-id="${id}"]`);
  return li && li.querySelector('.pub-judge-chip.is-new');
}, isNewFirstId);
check('motion: a fresh judgement (setDecision/judge path) marks its chip is-new', true);
await isNewFreshPage.close();

const isNewLoadTimePage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await isNewLoadTimePage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await isNewLoadTimePage.addInitScript(() => {
  try {
    localStorage.setItem('freestack:v1:discover', JSON.stringify({
      v: 1, lastVisit: new Date().toISOString(), seenIds: [0],
      decisions: { 0: { d: 'have', t: Date.now() } }, coachDone: true,
    }));
  } catch { /* private mode etc: irrelevant, no decision to redecorate either way */ }
});
await isNewLoadTimePage.goto(`${base}/`, { waitUntil: 'load' });
await isNewLoadTimePage.waitForSelector('#public-root .tool-card', { state: 'attached' });
await isNewLoadTimePage.waitForFunction(() => {
  const li = document.querySelector('.card-grid > li[data-id="0"]');
  return li && li.querySelector('.pub-judge-chip');
});
const loadTimeChipState = await isNewLoadTimePage.evaluate(() => {
  const chip = document.querySelector('.card-grid > li[data-id="0"] .pub-judge-chip');
  return { text: chip?.textContent.trim(), hasIsNew: chip?.classList.contains('is-new') };
});
check('motion: load-time redecoration of an existing decision never marks a chip is-new',
  loadTimeChipState.text === 'Got it' && loadTimeChipState.hasIsNew === false, JSON.stringify(loadTimeChipState));
await isNewLoadTimePage.close();

/* --- curator mode (staff path /x, batch I) --------------------------------- */
await page.goto(`${base}/x`);
await page.waitForSelector('.tools-table');
check('curator: noindexed at /x', await page.locator('meta[name=robots][content=noindex]').count() === 1);
check(`curator: ${active.length} active rows`, await page.locator('.tools-table tbody tr').count() === active.length);
check(`curator: ${activeCore} core pre-checked`, await page.locator('tbody input[type=checkbox]:checked').count() === activeCore);
check(`curator: category dropdown has ${activeCategories} + All`, await page.locator('select >> nth=1 >> option').count() === activeCategories + 1);

await page.locator('select').first().selectOption('core');
await page.fill('input[type=search]', 'canva');
const visible = await page.locator('.tools-table tbody tr:visible').count();
check('curator: filters compose (core+canva → 1 row)', visible === 1, `visible=${visible}`);
await page.locator('select').first().selectOption('all');
await page.fill('input[type=search]', '');

await page.fill('#client-name', 'Acme Ltd');
await page.click('text=Generate link');
const url = await page.locator('.generated-url').textContent();
check('curator: generated URL has t= and client=', /[?&]t=0,/.test(url) && url.includes('client=Acme+Ltd'), url);

/* --- client mode --------------------------------------------------------- */
await page.goto(url);
await page.waitForSelector('.tool-card');
check(`client: ${activeCore} cards for ${activeCore} core tools`, await page.locator('.tool-card').count() === activeCore);
check('client: prepared-for shows name', (await page.locator('.prepared-for').textContent()).includes('Acme Ltd'));
check('client: summary shows count', (await page.locator('.cli-summary').textContent()).includes(String(activeCore)));
const deadLinks = await page.locator('#client-root a:not([href^="http"]):not([href^="/"])').count();
check('client: no dead links', deadLinks === 0, `dead=${deadLinks}`);
check('client: category sections present', await page.locator('.cli-category').count() >= 5);

/* --- XSS acceptance (PRD section 7) -------------------------------------- */
await page.goto(`${base}/?t=0&client=${encodeURIComponent('<img src=x onerror=window.__xss=1>')}`);
await page.waitForSelector('.tool-card');
const literal = await page.locator('.prepared-for').textContent();
const xss = await page.evaluate(() => window.__xss);
check('client: XSS renders as literal text', literal.includes('<img src=x onerror=window.__xss=1>') && xss === undefined);

/* --- edge cases ----------------------------------------------------------- */
await page.goto(`${base}/?t=999,abc,`);
await page.waitForSelector('#client-root .app-message');
check('client: empty state for zero valid ids', (await page.locator('#client-root .app-message').textContent()).includes('no tools'));

await page.goto(`${base}/?t=0`);
await page.waitForSelector('.tool-card');
check('client: tool 0 survives round trip', (await page.locator('.tool-card h3').first().textContent()).includes('Claude'));

/* --- 375px viewport (DoD 5) ----------------------------------------------- */
const mobile = await browser.newPage({ viewport: { width: 375, height: 700 } });
await mobile.route(/^(?!.*localhost).*$/, (route) => route.abort());
await mobile.goto(url);
await mobile.waitForSelector('.tool-card');
const scrollW = await mobile.evaluate(() => document.documentElement.scrollWidth);
check('client: no horizontal scroll at 375px', scrollW <= 375, `scrollWidth=${scrollW}`);

/* --- batch A surface: meta, hardening, semantics, freshness ---------------- */
const rawHtml = (await readFile(join(ROOT, 'index.html'))).toString('utf8');
const ogAt = rawHtml.indexOf('og:image');
const cssAt = rawHtml.indexOf('rel="stylesheet"');
check('meta: og tags present and before the stylesheet', ogAt > -1 && cssAt > -1 && ogAt < cssAt);
check('meta: twitter card + canonical, no static robots',
  rawHtml.includes('summary_large_image') && rawHtml.includes('rel="canonical"') && !/name="robots"/.test(rawHtml));

await page.goto(`${base}/x`);
await page.waitForSelector('.tools-table');
check('curator: trust line present', (await page.locator('.trust-line').first().textContent()).includes('No affiliates'));

await page.goto(`${base}/?t=0,2&client=${'a'.repeat(100)}`);
await page.waitForSelector('.tool-card');
check('client: robots noindex injected', await page.locator('meta[name=robots][content=noindex]').count() === 1);
check('client: name capped at 80 chars', !(await page.locator('.prepared-for').textContent()).includes('a'.repeat(81)));
check('client: print + share buttons in no-print wrap',
  await page.locator('.no-print >> text=Print or save as PDF').count() === 1
  && await page.locator('.no-print >> text=Share this page').count() === 1);
check('client: ul/li/article card semantics', await page.locator('ul.card-grid > li > article.tool-card').count() >= 2);
check('client: last_verified badge renders', (await page.locator('.card-verified').first().textContent()).includes('Verified July 2026'));

const wide = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await wide.route(/^(?!.*localhost).*$/, (route) => route.abort());
await wide.goto(url);
await wide.waitForSelector('.tool-card');
const soloSpan = await wide.locator('li.card-solo').first().evaluate((li) => getComputedStyle(li).gridColumn).catch(() => 'none');
check('client: single-card category spans full row', /1 \/ -1/.test(soloSpan), `gridColumn=${soloSpan}`);
await wide.close();

/* --- hostile-length params must not break the 375px layout ---------------- */
const hostile = await browser.newPage({ viewport: { width: 375, height: 812 } });
await hostile.route(/^(?!.*localhost).*$/, (route) => route.abort());
await hostile.goto(`${base}/?t=0,2&client=${'A'.repeat(80)}&note=${'B'.repeat(280)}`);
await hostile.waitForSelector('.tool-card');
const hostileW = await hostile.evaluate(() => document.documentElement.scrollWidth);
check('client: unbroken 80-char name + 280-char note wrap at 375px', hostileW <= 375, `scrollWidth=${hostileW}`);
await hostile.close();

/* --- archived rendering (served from a mutated copy, repo data untouched) -- */
archiveIds = new Set([2]);
await page.goto(`${base}/x`);
await page.waitForSelector('.tools-table');
check('curator: archived tool excluded from table', await page.locator('.tools-table tbody tr').count() === active.length - 1);
await page.goto(`${base}/?t=0,2`);
await page.waitForSelector('.tool-card');
check('client: archived tool renders retirement card, not silence',
  await page.locator('.tool-card-archived').count() === 1
  && (await page.locator('.tool-card-archived').textContent()).includes('No longer recommended'));
archiveIds = null;

/* --- byo: build-your-own line (Phase 9 surface) ---------------------------- */
await page.goto(`${base}/?t=44,62`);
await page.waitForSelector('.tool-card');
const byoBlocks = await page.locator('.card-byo').count();
const byoLabel = byoBlocks ? await page.locator('.card-byo-label').first().textContent() : '';
check('client: byo block renders once for the tool that has it', byoBlocks === 1 && byoLabel.includes('Or build your own'), `blocks=${byoBlocks}`);
const byoOnBitwarden = await page.locator('.tool-card', { hasText: 'Bitwarden' }).locator('.card-byo').count();
check('client: no byo container on tools without byo', byoOnBitwarden === 0);

/* --- batch G surface: curator surfacing, edit flow, permalink -------------- */
const paidTool = active.find((t) => Number.isInteger(t.paid_from) && t.paid_from > 0);
const freeForeverTool = active.find((t) => t.paid_from === 0);
const byoCount = active.filter((t) => t.byo).length;
await page.goto(`${base}/x`);
await page.waitForSelector('.tools-table');
check('curator: paid-from sublines render from data',
  await page.locator('.cell-value-sub', { hasText: `from £${paidTool.paid_from}/mo` }).count() >= 1
  && (freeForeverTool ? await page.locator('.cell-value-sub', { hasText: 'free forever' }).count() >= 1 : true));
check('curator: BYO chips match byo tool count', await page.locator('.byo-chip').count() === byoCount, `chips=${await page.locator('.byo-chip').count()} expected=${byoCount}`);

await page.goto(`${base}/?edit=0,2&client=Acme&note=hello`);
await page.waitForSelector('.tools-table');
check('curator: edit param pre-ticks and prefills',
  await page.locator('tbody input[type=checkbox]:checked').count() === 2
  && await page.inputValue('#client-name') === 'Acme'
  && await page.inputValue('#client-note') === 'hello');

await page.goto(`${base}/?tool=0`);
await page.waitForSelector('.tool-card');
check('client: single-tool permalink renders one card, no summary, id 0 safe',
  await page.locator('.tool-card').count() === 1
  && await page.locator('.cli-summary').count() === 0
  && await page.locator('.card-toggle').count() === 0);

/* --- batch H surface: plain mode, share-back mailto, print QR -------------- */
await page.goto(`${base}/?t=0,2`);
await page.waitForSelector('.tool-card');
await page.click('.plain-toggle');
check('client: plain mode relabels and swaps text',
  await page.locator('text=Other options like this').count() >= 1
  && await page.locator('.plain-toggle[aria-pressed="true"]').count() === 1);
await page.click('.plain-toggle');
check('client: plain mode toggles back off', await page.locator('.card-section-label', { hasText: 'Alternatives' }).count() >= 1);
await page.evaluate(() => { try { localStorage.removeItem('freestack:v1:plainmode'); } catch {} });

const allIds = active.map((t) => t.id).join(',');
await page.goto(`${base}/?t=${allIds}&client=${'X'.repeat(80)}`);
await page.waitForSelector('.tool-card');
const mailtoPromise = new Promise((resolve) => {
  const grab = (u) => { if (u.startsWith('mailto:')) resolve(u); };
  page.on('framenavigated', (f) => grab(f.url()));
  page.on('requestfailed', (r) => grab(r.url()));
  setTimeout(() => resolve(''), 4000);
});
await page.click('text=Share progress with Kaipability');
const mailto = await mailtoPromise;
check('client: share-progress mailto correct and under 1900 chars at full catalogue',
  mailto.startsWith('mailto:info@kaipability.com') && mailto.includes('Not%20yet') && mailto.length > 0 && mailto.length < 1900,
  `len=${mailto.length}`);
await page.goto(`${base}/?t=0,2&client=Acme`).catch(() => {});
await page.waitForSelector('.tool-card');
const qrScreen = await page.locator('.cli-print-qr').evaluate((n) => getComputedStyle(n).display).catch(() => 'missing');
await page.emulateMedia({ media: 'print' });
const qrPrint = await page.locator('.cli-print-qr').evaluate((n) => getComputedStyle(n).display).catch(() => 'missing');
await page.emulateMedia({ media: 'screen' });
check('client: QR block print-only', qrScreen === 'none' && qrPrint !== 'none' && qrPrint !== 'missing', `screen=${qrScreen} print=${qrPrint}`);

/* --- batch I: staff gating and embed --------------------------------------- */
const freshVisitor = await browser.newPage();
await freshVisitor.route(/^(?!.*localhost).*$/, (route) => route.abort());
await freshVisitor.goto(`${base}/?t=0,2`);
await freshVisitor.waitForSelector('.tool-card');
check('client: no Open in curator for non-staff visitors', await freshVisitor.locator('text=Open in curator').count() === 0);
await freshVisitor.close();
await page.goto(`${base}/?t=0,2`); // this context visited /x earlier, staff flag set
await page.waitForSelector('.tool-card');
const editHref = await page.locator('text=Open in curator').getAttribute('href').catch(() => null);
check('client: staff device sees Open in curator pointing at /x', editHref !== null && editHref.includes('/x?edit=0,2'));
await page.goto(`${base}/embed.html?t=0,2`);
await page.waitForSelector('.tool-card');
check('embed: bare cards, noindex, no app chrome',
  await page.locator('.tool-card').count() === 2
  && await page.locator('meta[name=robots][content=noindex]').count() === 1
  && await page.locator('.cli-header, .cli-toolbar, .cli-summary').count() === 0
  && (await page.textContent('body')).includes('From Free Stack'));

/* --- My Stack workspace core (Phase 11; full DoD mechanics land at 11.5) --- */
const my = await browser.newPage();
await my.route(/^(?!.*localhost).*$/, (route) => route.abort());
await my.goto(`${base}/my`);
await my.waitForSelector('#my-root:not([hidden])');
check('my: first-run renders with noindex', await my.locator('meta[name=robots][content=noindex]').count() === 1
  && (await my.textContent('#my-root')).includes('example'));
await my.locator('button', { hasText: 'Explore an example register' }).first().click();
await my.waitForSelector('.my-nav-item');
await my.locator('.my-nav-item', { hasText: 'Accounts' }).click();
const exampleRows = await my.locator('#my-root table tbody tr, #my-root .my-account-row').count();
check('my: example register renders rows read-only', exampleRows >= 8
  && await my.evaluate(() => localStorage.getItem('freestack:v1:my') === null));
check('my: risk chips present in example', await my.locator('.my-chip').count() >= 3);
const myMobile = await browser.newPage({ viewport: { width: 375, height: 812 } });
await myMobile.route(/^(?!.*localhost).*$/, (route) => route.abort());
await myMobile.goto(`${base}/my`);
await myMobile.waitForSelector('#my-root:not([hidden])');
check('my: no horizontal scroll at 375px', await myMobile.evaluate(() => document.documentElement.scrollWidth) <= 375);
await myMobile.close();
await my.close();

/* --- dark mode and exports (batch E surface) ------------------------------- */
await page.goto(`${base}/x`);
await page.waitForSelector('.tools-table');
await page.click('text=Deselect all');
const exportButtons = page.locator('.cur-exports button, [class*=export] button');
const exportCount = await exportButtons.count();
let disabledCount = 0;
for (let i = 0; i < exportCount; i++) if (await exportButtons.nth(i).isDisabled()) disabledCount++;
check('curator: four export buttons, disabled with empty selection', exportCount === 4 && disabledCount === 4, `count=${exportCount} disabled=${disabledCount}`);
await page.locator('tbody input[type=checkbox]').first().check();
let enabledCount = 0;
for (let i = 0; i < exportCount; i++) if (!(await exportButtons.nth(i).isDisabled())) enabledCount++;
check('curator: export buttons enable with a selection', enabledCount === 4, `enabled=${enabledCount}`);

const themeBtn = page.locator('.theme-toggle').first();
await themeBtn.click();
// Wave 14.2: the flip now runs inside the guarded View Transition helper
// (motion inventory item 6), whose update callback is not invoked
// synchronously with the click (confirmed empirically: one to two
// animation frames later, but not a fixed bound under load). Polled with
// waitForFunction rather than a fixed-timeout guess, so this never flakes
// under a slower CI run the way a short sleep can.
await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
const darkSet = await page.evaluate(() => document.documentElement.dataset.theme);
await page.reload();
await page.waitForSelector('.tools-table');
const darkPersists = await page.evaluate(() => document.documentElement.dataset.theme);
check('curator: theme toggle flips to dark and persists across reload', darkSet === 'dark' && darkPersists === 'dark');
await page.locator('.theme-toggle').first().click(); // restore light for later checks
await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
await page.evaluate(() => { try { localStorage.removeItem('freestack:v1:theme'); } catch {} });

await page.goto(`${base}/?t=0,2`);
await page.waitForSelector('.tool-card');
check('client: theme toggle present in no-print toolbar', await page.locator('.no-print .theme-toggle, .cli-toolbar .theme-toggle').count() >= 1);

/* --- Phase 11.5, batch A: CSP hash drift gate (pure Node, no browser) ------
   The two inline boot scripts on the whole site (index.html's, reused byte
   for byte by why-register.html, and embed.html's own) are allow-listed in
   netlify.toml by sha256 hash instead of 'unsafe-inline' (PRD-REGISTER
   section 10). A future edit to either script that forgets to recompute the
   hash does not fail loudly in a browser, it just silently blocks the
   script; this is the check that catches that before it ships. */
// PRD section 18, "Smoke-gate exclusion for JSON-LD": a
// type="application/ld+json" block is a non-executable data block, CSP's
// script-src never applies to it, so it has no hash to allow-list and this
// gate has nothing to protect by hashing it. Skipping it here is a legitimate
// narrowing of what the gate checks, not a loosening of what it protects:
// every OTHER inline <script> (no src=, no ld+json type) still needs its
// hash allow-listed below, including a planted executable one, which the
// dedicated check further down proves.
function extractInlineScripts(html) {
  const scripts = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (/\bsrc\s*=/i.test(m[1])) continue; // external scripts carry no inline body to hash
    if (/\btype\s*=\s*["']?application\/ld\+json["']?/i.test(m[1])) continue; // data block, not executable
    scripts.push(m[2]);
  }
  return scripts;
}
function sha256Base64(text) {
  return createHash('sha256').update(text, 'utf8').digest('base64');
}
const embedHtml = (await readFile(join(ROOT, 'embed.html'))).toString('utf8');
const whyRegisterHtml = (await readFile(join(ROOT, 'why-register.html'))).toString('utf8');
// Phase 14.3: faq.html reuses index.html's theme-boot script byte for byte,
// the same pattern why-register.html already uses, so its inline script
// must resolve to a hash already in the CSP allow-list rather than needing
// a new entry (PRD section 18: "a third distinct script would need a
// netlify.toml hash which section 18 forbids adding").
const faqHtml = (await readFile(join(ROOT, 'faq.html'))).toString('utf8');
// Phase 15: privacy.html and contact.html join the why-register.html /
// faq.html mould, reusing the same byte-for-byte boot script so neither
// needs a new CSP hash entry.
const privacyHtml = (await readFile(join(ROOT, 'privacy.html'))).toString('utf8');
const contactHtml = (await readFile(join(ROOT, 'contact.html'))).toString('utf8');
const netlifyToml = (await readFile(join(ROOT, 'netlify.toml'))).toString('utf8');

const indexInline = extractInlineScripts(rawHtml);
const embedInline = extractInlineScripts(embedHtml);
const whyInline = extractInlineScripts(whyRegisterHtml);
const faqInline = extractInlineScripts(faqHtml);
const privacyInline = extractInlineScripts(privacyHtml);
const contactInline = extractInlineScripts(contactHtml);
const currentHashes = new Set([...indexInline, ...embedInline, ...whyInline, ...faqInline, ...privacyInline, ...contactInline].map(sha256Base64));

const cspScriptSrcLine = netlifyToml.split('\n').find((l) => l.includes('Content-Security-Policy') && l.includes('script-src'));
const cspHashes = new Set([...(cspScriptSrcLine || '').matchAll(/'sha256-([A-Za-z0-9+/]+=*)'/g)].map((m) => m[1]));

const missingFromCsp = [...currentHashes].filter((h) => !cspHashes.has(h));
const staleInCsp = [...cspHashes].filter((h) => !currentHashes.has(h));
check('csp: every inline boot script hash is allow-listed in netlify.toml', missingFromCsp.length === 0, `missing=${missingFromCsp.join(',')}`);
check('csp: no stale hash in netlify.toml matching no current script', staleInCsp.length === 0, `stale=${staleInCsp.join(',')}`);
check('csp: why-register.html boot script is byte identical to index.html',
  indexInline.length === 1 && whyInline.length === 1 && sha256Base64(indexInline[0]) === sha256Base64(whyInline[0]));
check('csp: faq.html boot script is byte identical to index.html (Phase 14.3, no third hash needed)',
  indexInline.length === 1 && faqInline.length === 1 && sha256Base64(indexInline[0]) === sha256Base64(faqInline[0]));
check('csp: privacy.html boot script is byte identical to index.html (Phase 15, no third hash needed)',
  indexInline.length === 1 && privacyInline.length === 1 && sha256Base64(indexInline[0]) === sha256Base64(privacyInline[0]));
check('csp: contact.html boot script is byte identical to index.html (Phase 15, no third hash needed)',
  indexInline.length === 1 && contactInline.length === 1 && sha256Base64(indexInline[0]) === sha256Base64(contactInline[0]));
check('csp: privacy.html and contact.html introduce no additional inline script beyond the shared boot script',
  privacyInline.length === 1 && contactInline.length === 1);

// Regression guard for the JSON-LD exclusion itself (PRD section 18,
// "Smoke-gate exclusion for JSON-LD"): a type="application/ld+json" block
// must never be counted by extractInlineScripts (proven directly, not just
// implied by the hash checks above passing), and a planted EXECUTABLE
// inline script with no matching CSP hash must still fail the gate, so the
// exclusion is narrow rather than accidentally swallowing real scripts too.
{
  const ldOnly = '<script type="application/ld+json">{"a":1}</script>';
  check('csp: extractInlineScripts skips application/ld+json blocks entirely', extractInlineScripts(ldOnly).length === 0);

  const plantedExecutable = `${rawHtml}\n<script>window.__planted = true;</script>`;
  const plantedHashes = new Set(extractInlineScripts(plantedExecutable).map(sha256Base64));
  const plantedMissing = [...plantedHashes].filter((h) => !cspHashes.has(h));
  check('csp: a planted executable inline script with no CSP hash is still caught as missing',
    plantedMissing.length > 0, `missing=${plantedMissing.length}`);
}

/* --- Phase 14.3: Answer Engine and Search Visibility (PRD section 18) -----
   Raw-HTML crawler simulation (no JS: a plain fetch of the served files,
   exactly what GPTBot/ClaudeBot/PerplexityBot see), the faq.html content,
   sitemap/robots/llms.txt, the static block's hide-on-boot behaviour, and
   the generator's own drift and determinism guarantees. how-we-choose.html
   is intentionally absent throughout: BUILD-PLAN 14.3 gates its publication
   on Rocky's copy sign-off, which has not landed (see TODO.md), so the
   sitemap and llms.txt ship without it and this suite asserts that absence
   rather than its presence. */
{
  // A tool name or category can legitimately contain "&" (id 7, "Stock
  // Music & Fonts"), which the generator HTML-escapes when writing the
  // static block (PRD section 18's untrusted-string discipline: every
  // string from tools.json is escaped before it reaches a static file). The
  // same escaping is applied here before searching the raw markup, rather
  // than loosening what the generator itself is required to do.
  const escapeHtmlForCheck = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const activeToolNames = active.map((t) => t.name);

  // Raw fetch, no JS: exactly what a non-rendering crawler receives. Uses
  // this suite's own local server (mirrors the SPA fallback and serves real
  // files first), not the Playwright page.
  const rawRootRes = await fetch(`${base}/`);
  const rawRootHtml = await rawRootRes.text();
  const missingToolNames = activeToolNames.filter((name) => !rawRootHtml.includes(escapeHtmlForCheck(name)));
  check('aeo: raw (no-JS) fetch of / contains every active tool name',
    missingToolNames.length === 0, `missing=${missingToolNames.slice(0, 5).join(' | ')}${missingToolNames.length ? ` (+${missingToolNames.length - 5} more)` : ''}`);
  check('aeo: raw fetch of / contains the category headings',
    [...new Set(active.map((t) => t.category))].every((cat) => rawRootHtml.includes(escapeHtmlForCheck(cat))));
  check('aeo: raw fetch of / contains the trust lines and a link to /faq.html',
    rawRootHtml.includes('No affiliates, no sponsors, no paid placement.')
    && rawRootHtml.includes(`${active.length} free tool`)
    && /href="\/faq\.html"/.test(rawRootHtml));
  // Per-tool question, tool 0 specifically (PRD section 18, per-tool
  // questions, and the section 4 id law: id 0 is a real tool and must never
  // be dropped by a truthiness check anywhere in this pipeline).
  check('aeo: raw fetch of / contains tool 0\'s generated question',
    rawRootHtml.includes('Are Claude Free / ChatGPT Free / Gemini free for a small business?')
    || rawRootHtml.includes('Is Claude Free / ChatGPT Free / Gemini actually free for a small business?'));

  // The static block is real markup inside #static-root, not something JS
  // has to build: confirm it is present in the raw HTML and only hidden,
  // never removed, once a JS-capable browser boots the app (visible-text
  // duplication check: booted page shows the rendered app, not both).
  const staticRootMatch = rawRootHtml.match(/<div id="static-root">([\s\S]*?)<!--\s*seo-static:end\s*-->/);
  check('aeo: raw HTML carries a real #static-root block between the seo-static markers',
    !!staticRootMatch && !rawRootHtml.match(/<div id="static-root"[^>]*\bhidden\b/));

  const staticRootBooted = await page.evaluate(() => {
    const node = document.getElementById('static-root');
    return { present: !!node, hidden: node ? node.hasAttribute('hidden') : null };
  });
  check('aeo: #static-root is hidden once the app has booted (JS-capable visit)',
    staticRootBooted.present && staticRootBooted.hidden === true, JSON.stringify(staticRootBooted));
  const staticRootVisibleText = await page.locator('#static-root').isVisible().catch(() => false);
  check('aeo: the static block is not visibly duplicated once the app has rendered',
    staticRootVisibleText === false);

  // faq.html: the ten canonical questions as visible text, indexable (no
  // robots meta), FAQPage JSON-LD whose strings match the visible copy.
  const faqRes = await fetch(`${base}/faq.html`);
  const faqRawHtml = await faqRes.text();
  const CANONICAL_QUESTIONS = [
    'What software stack is free for a new founder?',
    'What is the best free accounting software for a UK small business?',
    'How much would this software cost if I paid for it?',
    'Is there a free CRM good enough for a small business?',
    'What free email marketing tools actually work?',
    'What can I use instead of Photoshop for free?',
    'Do these free tools stay free, or is there a catch?',
    'Does this directory earn commission on the tools it lists?',
    'What free tools help a local shop get found online?',
    'What free security tools should a small business start with?',
  ];
  check('aeo: /faq.html serves all ten canonical questions as raw HTML text',
    CANONICAL_QUESTIONS.every((q) => faqRawHtml.includes(q)));
  check('aeo: /faq.html carries no robots meta tag (indexable, unlike /x, /my and client links)',
    !/<meta\s+name="robots"/i.test(faqRawHtml));

  await page.goto(`${base}/faq.html`);
  await page.waitForSelector('.faq-item');
  const faqVisibleQuestions = await page.locator('.faq-item h2').allTextContents();
  check('aeo: faq.html renders all ten questions as visible text (not JS-injected)',
    CANONICAL_QUESTIONS.every((q) => faqVisibleQuestions.includes(q)));
  const faqLdMatch = faqRawHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  let faqLd = null;
  try { faqLd = JSON.parse(faqLdMatch?.[1] ?? 'null'); } catch { /* left null, checked below */ }
  check('aeo: faq.html JSON-LD parses and is a FAQPage with exactly ten questions, matching visible copy',
    faqLd?.['@type'] === 'FAQPage'
    && Array.isArray(faqLd.mainEntity)
    && faqLd.mainEntity.length === 10
    && faqLd.mainEntity.every((q, i) => q['@type'] === 'Question' && q.name === faqVisibleQuestions[i]));

  const faqMobile = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await faqMobile.route(/^(?!.*localhost).*$/, (route) => route.abort());
  await faqMobile.goto(`${base}/faq.html`);
  await faqMobile.waitForSelector('.faq-item');
  const faqScrollW = await faqMobile.evaluate(() => document.documentElement.scrollWidth);
  check('aeo: faq.html has no horizontal scroll at 375px', faqScrollW <= 375, `scrollWidth=${faqScrollW}`);
  await faqMobile.close();

  // index.html head JSON-LD: Organization, WebSite, ItemList, valid JSON,
  // expected @types, ItemList length equals the active count (id 0 counted:
  // no truthiness filter anywhere in this pipeline could silently drop it).
  const headJsonLdBlocks = [...rawHtml.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((m) => { try { return JSON.parse(m[1]); } catch { return null; } });
  const orgLd = headJsonLdBlocks.find((b) => b?.['@type'] === 'Organization');
  const websiteLd = headJsonLdBlocks.find((b) => b?.['@type'] === 'WebSite');
  const itemListLd = headJsonLdBlocks.find((b) => b?.['@type'] === 'ItemList');
  check('aeo: index.html head carries valid Organization, WebSite and ItemList JSON-LD',
    orgLd?.name === 'Kaipability Ltd'
    && websiteLd?.name === 'Free Stack'
    && Array.isArray(itemListLd?.itemListElement)
    && itemListLd.itemListElement.length === active.length);
  const tool0Name = active.find((t) => t.id === 0)?.name;
  const itemListHasTool0 = itemListLd?.itemListElement.some((li) => li.item?.name === tool0Name);
  check('aeo: ItemList JSON-LD includes tool 0', itemListHasTool0 === true);

  // Title and meta description carry the live count; OG tag set unchanged
  // (already exercised above by the "meta: og tags present" check; this
  // extends it with the section 18 title/description content).
  const titleMatch = rawHtml.match(/<title>([\s\S]*?)<\/title>/);
  const descMatch = rawHtml.match(/<meta name="description" content="([^"]*)">/);
  check('aeo: title carries the live active tool count',
    titleMatch?.[1].includes(String(active.length)) && titleMatch[1].includes('Free Stack by Kaipability'), titleMatch?.[1]);
  check('aeo: meta description carries the live active tool count',
    descMatch?.[1].includes(String(active.length)), descMatch?.[1]);
  check('aeo: OG tag set unchanged (og:title still the client-mode-facing copy)',
    rawHtml.includes('<meta property="og:title" content="Your Free Software Stack">'));

  // sitemap.xml: exactly the permitted URLs, nothing noindexed, no
  // how-we-choose.html until Rocky's sign-off lands. Phase 15 (PRD section
  // 16 amended) adds privacy.html and contact.html to this list.
  const sitemapRes = await fetch(`${base}/sitemap.xml`);
  const sitemapXml = await sitemapRes.text();
  const sitemapUrls = [...sitemapXml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
  check('aeo: sitemap.xml lists exactly /, /faq.html, /privacy.html and /contact.html, nothing else',
    sitemapRes.status === 200
    && sitemapUrls.length === 4
    && sitemapUrls.includes('https://tools.airl.io/')
    && sitemapUrls.includes('https://tools.airl.io/faq.html')
    && sitemapUrls.includes('https://tools.airl.io/privacy.html')
    && sitemapUrls.includes('https://tools.airl.io/contact.html'));

  // robots.txt: Sitemap line present, still no disallow anywhere (a
  // disallow for /x would advertise the hidden staff path).
  const robotsRes = await fetch(`${base}/robots.txt`);
  const robotsTxt = await robotsRes.text();
  check('aeo: robots.txt carries the Sitemap line and no Disallow',
    robotsRes.status === 200
    && robotsTxt.includes('Sitemap: https://tools.airl.io/sitemap.xml')
    && !/Disallow:/i.test(robotsTxt));

  // llms.txt: served, points at the machine-readable dataset, the FAQ and
  // (Phase 15) the contact page.
  const llmsRes = await fetch(`${base}/llms.txt`);
  const llmsTxt = await llmsRes.text();
  check('aeo: llms.txt is served and points at /data/tools.json, /faq.html and /contact.html',
    llmsRes.status === 200
    && llmsTxt.includes('/data/tools.json')
    && llmsTxt.includes('/faq.html')
    && llmsTxt.includes('/contact.html'));

  /* --- Wave 14.3b: data/faq.json as the single source of truth, and its two
     runtime surfacing points (homepage FAQ slot in js/public.js, ?tool=
     permalink Q&A in js/client.js) ------------------------------------- */
  const faqJsonRes = await fetch(`${base}/data/faq.json`);
  const faqJsonBody = await faqJsonRes.json();
  check('aeo: data/faq.json is served and parses with exactly ten site entries and one entry per active tool',
    faqJsonRes.status === 200
    && Array.isArray(faqJsonBody.site) && faqJsonBody.site.length === 10
    && faqJsonBody.tools && Object.keys(faqJsonBody.tools).length === active.length);
  check('aeo: data/faq.json carries tool 0 under the string key "0" (id law: 0 is a real key)',
    typeof faqJsonBody.tools['0']?.q === 'string' && typeof faqJsonBody.tools['0']?.a === 'string');

  // PRD section 18 as amended (31 Jul): answers aim for 40-80 words with
  // hard bounds of 30-100, because free_limit is quoted verbatim and
  // truncating it to hit a cosmetic target would cost honesty. The hard
  // bounds are the tested contract.
  const faqWordBoundBreaches = Object.entries(faqJsonBody.tools)
    .map(([id, entry]) => [id, entry.a.trim().split(/\s+/).length])
    .filter(([, words]) => words < 30 || words > 100);
  check('aeo: every per-tool answer sits within the 30-100 word hard bounds',
    faqWordBoundBreaches.length === 0,
    faqWordBoundBreaches.map(([id, words]) => `${id}:${words}`).join(',') || 'all within bounds');

  // Homepage FAQ slot (js/public.js, PRD section 16 item 5): ten native
  // <details>/<summary> items, text matching data/faq.json byte for byte,
  // never re-derived at runtime. The FAQ section sits below the shelf band,
  // so no shelf needs expanding to find it.
  await page.goto(`${base}/`);
  await page.waitForSelector('#public-root .tool-card', { state: 'attached' });
  await page.waitForSelector('.pub-faq-item');
  const homeFaqQuestions = await page.locator('.pub-faq-summary').allTextContents();
  const homeFaqAnswers = await page.locator('.pub-faq-answer').allTextContents();
  check('aeo: homepage FAQ slot renders exactly ten details items matching data/faq.json byte for byte',
    homeFaqQuestions.length === 10 && homeFaqAnswers.length === 10
    && faqJsonBody.site.every((entry, i) => entry.q === homeFaqQuestions[i] && entry.a === homeFaqAnswers[i]),
    `questions=${homeFaqQuestions.length} answers=${homeFaqAnswers.length}`);
  const homeFaqOpenCount = await page.locator('.pub-faq-item[open]').count();
  check('aeo: homepage FAQ items are closed by default (content in the DOM regardless, native details/summary)',
    homeFaqOpenCount === 0);
  const homeFaqSummaryHeights = await page.locator('.pub-faq-summary').evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().height));
  check('aeo: homepage FAQ summaries are at least 44px tall', homeFaqSummaryHeights.every((h) => h >= 44), JSON.stringify(homeFaqSummaryHeights));

  // Re-measure the 14.1 fold and page-height budgets now that the FAQ slot
  // is genuinely visible (collapsed, but no longer `hidden`), rather than
  // assuming it stays within budget: "they will not, but assert it" per the
  // coordinator's brief.
  for (const [width, budget] of [[375, 3200], [1280, 2200]]) {
    const faqBudgetPage = await browser.newPage({ viewport: { width, height: 900 } });
    await faqBudgetPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
    await faqBudgetPage.goto(`${base}/`);
    await faqBudgetPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
    await faqBudgetPage.waitForSelector('.pub-faq-item');
    await faqBudgetPage.waitForTimeout(300);
    const faqPageHeight = await faqBudgetPage.evaluate(() => document.documentElement.scrollHeight);
    check(`aeo: page height at ${width}px is still within the ${budget}px budget with the FAQ slot visible`,
      faqPageHeight <= budget, `height=${faqPageHeight}`);
    await faqBudgetPage.close();
  }
  const faqFoldPage = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await faqFoldPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
  await faqFoldPage.goto(`${base}/`);
  await faqFoldPage.waitForSelector('#public-root .tool-card', { state: 'attached' });
  await faqFoldPage.waitForSelector('.pub-shelf-header');
  await faqFoldPage.waitForSelector('.pub-faq-item');
  await faqFoldPage.waitForTimeout(300);
  const faqFoldFirstShelfBox = await faqFoldPage.locator('.pub-shelf-header').first().boundingBox();
  const faqFoldFirstShelfTop = faqFoldFirstShelfBox?.y ?? null;
  check('aeo: the pinned 880px first-shelf budget is unaffected by the now-visible FAQ slot (which sits below the shelves)',
    faqFoldFirstShelfTop !== null && faqFoldFirstShelfTop <= 880, `firstShelfHeaderTop=${faqFoldFirstShelfTop}`);
  await faqFoldPage.close();

  // ?tool= permalink Q&A (js/client.js, PRD section 18 per-tool surfacing):
  // tool 0 specifically, matching data/faq.json byte for byte, and matching
  // the static crawler block's own tool-0 text (both trace to the same
  // data/faq.json, so they can never disagree).
  const toolFaqPage = await browser.newPage();
  await toolFaqPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
  await toolFaqPage.goto(`${base}/?tool=0`);
  await toolFaqPage.waitForSelector('.cli-tool-faq h2');
  const toolFaqQ = await toolFaqPage.locator('.cli-tool-faq h2').textContent();
  const toolFaqA = await toolFaqPage.locator('.cli-tool-faq p').textContent();
  check('aeo: ?tool=0 permalink renders its question and answer matching data/faq.json byte for byte',
    toolFaqQ === faqJsonBody.tools['0'].q && toolFaqA === faqJsonBody.tools['0'].a,
    JSON.stringify({ toolFaqQ, expectedQ: faqJsonBody.tools['0'].q }));
  check("aeo: the ?tool=0 answer matches the static crawler block's tool-0 text exactly (both trace to data/faq.json)",
    rawRootHtml.includes(escapeHtmlForCheck(faqJsonBody.tools['0'].a)));
  await toolFaqPage.close();

  // Scoped strictly to renderSingleTool, per the coordinator's brief:
  // multi-tool client pages carry no per-tool FAQ section at all.
  const multiToolFaqPage = await browser.newPage();
  await multiToolFaqPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
  await multiToolFaqPage.goto(`${base}/?t=0,2`);
  await multiToolFaqPage.waitForSelector('.tool-card');
  const multiToolFaqCount = await multiToolFaqPage.locator('.cli-tool-faq').count();
  check('aeo: multi-tool client pages carry no .cli-tool-faq section (scoped to the single-tool permalink only)',
    multiToolFaqCount === 0);
  await multiToolFaqPage.close();

  // Noindex boundaries unmoved: /x, client-mode links and /my keep their
  // JS-injected noindex; why-register.html keeps its static one; faq.html
  // (new this wave) carries none, since it is meant to be indexed. Each of
  // these is already exercised by its own dedicated check elsewhere in this
  // suite (search this file for "noindex"); this is the single consolidated
  // assertion that all of them still hold true in the same run as the new
  // AEO surface, so a future regression in one area cannot hide behind the
  // others' tests having run in an earlier, unrelated part of the suite.
  const noindexCurator = await (async () => {
    const p = await browser.newPage();
    await p.route(/^(?!.*localhost).*$/, (route) => route.abort());
    await p.goto(`${base}/x`);
    await p.waitForSelector('.tools-table');
    const n = await p.locator('meta[name=robots][content=noindex]').count();
    await p.close();
    return n;
  })();
  const noindexClient = await (async () => {
    const p = await browser.newPage();
    await p.route(/^(?!.*localhost).*$/, (route) => route.abort());
    await p.goto(`${base}/?t=0`);
    await p.waitForSelector('.tool-card');
    const n = await p.locator('meta[name=robots][content=noindex]').count();
    await p.close();
    return n;
  })();
  const noindexMy = await (async () => {
    const p = await browser.newPage();
    await p.route(/^(?!.*localhost).*$/, (route) => route.abort());
    await p.goto(`${base}/my`);
    await p.waitForSelector('#my-root:not([hidden])');
    const n = await p.locator('meta[name=robots][content=noindex]').count();
    await p.close();
    return n;
  })();
  const whyNoindexStatic = /<meta name="robots" content="noindex">/.test(whyRegisterHtml);
  check('aeo: noindex boundaries unmoved (curator /x, client ?t=, /my all noindexed; why-register.html statically noindexed; faq.html indexable)',
    noindexCurator === 1 && noindexClient === 1 && noindexMy === 1 && whyNoindexStatic === true
    && !/<meta\s+name="robots"/i.test(faqRawHtml));

  // Generator drift and determinism: run build-seo.mjs fresh (child process,
  // not imported: it has top-level side effects, this is a full CLI
  // invocation exactly like CI's drift step) and diff every artefact it
  // touches against the currently committed/working-tree copies. Run twice
  // to prove byte-identical output between successive runs, the same proof
  // BUILD-PLAN 14.3 asks for; CI's own drift step (added this wave) is the
  // authority for gating a real commit, this is the in-suite corroboration
  // that regenerating right now changes nothing already on disk.
  const { execFileSync } = await import('node:child_process');
  // 'data/faq.json' (wave 14.3b): the same drift proof now covers the JSON
  // source of truth every runtime surface fetches, not only the HTML/XML/
  // text artefacts. .github/workflows/ci.yml's own drift step diffs this
  // exact path list too, so a real CI run and this in-suite corroboration
  // can never disagree about what "covered by the drift gate" means.
  const artefacts = ['index.html', 'faq.html', 'sitemap.xml', 'llms.txt', 'robots.txt', join('data', 'faq.json')];
  const before = Object.fromEntries(await Promise.all(artefacts.map(async (f) => [f, await readFile(join(ROOT, f), 'utf8')])));
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'build-seo.mjs')], { cwd: ROOT });
  const afterFirstRun = Object.fromEntries(await Promise.all(artefacts.map(async (f) => [f, await readFile(join(ROOT, f), 'utf8')])));
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'build-seo.mjs')], { cwd: ROOT });
  const afterSecondRun = Object.fromEntries(await Promise.all(artefacts.map(async (f) => [f, await readFile(join(ROOT, f), 'utf8')])));
  const driftAgainstCommitted = artefacts.filter((f) => before[f] !== afterFirstRun[f]);
  const driftBetweenRuns = artefacts.filter((f) => afterFirstRun[f] !== afterSecondRun[f]);
  check('aeo: regenerating build-seo.mjs against the current data produces no drift from the committed artefacts',
    driftAgainstCommitted.length === 0, `drifted=${driftAgainstCommitted.join(',')}`);
  check('aeo: running build-seo.mjs twice in a row is byte-identical (determinism)',
    driftBetweenRuns.length === 0, `drifted=${driftBetweenRuns.join(',')}`);

  // No em dashes anywhere the generator writes (PRD section 10 house style,
  // extended by section 18 to every generated file).
  const emDashFiles = artefacts.filter((f) => afterSecondRun[f].includes('—'));
  check('aeo: no em dashes in any generated file', emDashFiles.length === 0, emDashFiles.join(','));
}

/* --- security.txt, served through this suite's own local server (which
   mirrors the SPA fallback), as the real file per RFC 9116 (PRD-REGISTER
   section 10) ----------------------------------------------------------- */
const secTxtRes = await fetch(`${base}/.well-known/security.txt`);
const secTxtBody = await secTxtRes.text();
const expiresMatch = secTxtBody.match(/Expires:\s*(\S+)/);
const expiresDate = expiresMatch ? new Date(expiresMatch[1]) : null;
check('security.txt: real file served with Contact and a future Expires',
  secTxtRes.status === 200
  && !secTxtBody.includes('<!DOCTYPE html>') // proves the real file was served, not the SPA fallback
  && secTxtBody.includes('Contact:')
  && !!expiresDate && !Number.isNaN(expiresDate.getTime()) && expiresDate.getTime() > Date.now(),
  `status=${secTxtRes.status}`);

/* --- why-register.html: the awareness page (PRD-REGISTER section 12) ------ */
await page.goto(`${base}/why-register.html`);
await page.waitForSelector('#awareness-root');
check('why-register: noindex robots meta present', await page.locator('meta[name=robots][content=noindex]').count() === 1);
const awarenessText = await page.textContent('#awareness-root');
check('why-register: privacy notice renders verbatim', awarenessText.includes(PRIVACY_NOTICE.slice(0, 60)));
const whyMobile = await browser.newPage({ viewport: { width: 375, height: 812 } });
await whyMobile.route(/^(?!.*localhost).*$/, (route) => route.abort());
await whyMobile.goto(`${base}/why-register.html`);
await whyMobile.waitForSelector('#awareness-root');
const whyScrollW = await whyMobile.evaluate(() => document.documentElement.scrollWidth);
check('why-register: no horizontal scroll at 375px', whyScrollW <= 375, `scrollWidth=${whyScrollW}`);
await whyMobile.close();

/* --- Phase 15: privacy.html and contact.html (PRD section 16 amended,
   layout item 6) -------------------------------------------------------
   Unlike why-register.html, these two are indexable: served with 200, no
   noindex meta, no horizontal scroll at 375px, and no em dashes anywhere in
   their copy (house style, PRD section 10). */
for (const [slug, needle] of [['privacy', 'Company No. 15772934'], ['contact', 'info@kaipability.com']]) {
  const res = await fetch(`${base}/${slug}.html`);
  const body = await res.text();
  check(`${slug}.html: served locally with 200 and carries expected content`,
    res.status === 200 && body.includes(needle), `status=${res.status}`);
  check(`${slug}.html: no noindex meta (indexable, unlike why-register.html)`,
    !/<meta\s+name="robots"/i.test(body));
  check(`${slug}.html: no em dashes in the page copy`, !body.includes('—'));

  const mobile = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await mobile.route(/^(?!.*localhost).*$/, (route) => route.abort());
  await mobile.goto(`${base}/${slug}.html`);
  await mobile.waitForSelector('.legal-body');
  const scrollW = await mobile.evaluate(() => document.documentElement.scrollWidth);
  check(`${slug}.html: no horizontal scroll at 375px`, scrollW <= 375, `scrollWidth=${scrollW}`);
  await mobile.close();
}

/* --- Phase 11.5, batch D: /my DoD mechanics (PRD-REGISTER section 15) -----
   Plaintext path only throughout: encryption is deliberately never enabled
   here (PBKDF2 at 600,000 iterations is too slow for a smoke suite, and
   scripts/register-vectors.mjs already gates the crypto envelope itself).
   Runs in its own browser context so tab B below genuinely shares storage
   with tab A rather than starting from a fresh, isolated one, the way a
   plain browser.newPage() call would (see the batch I "staff device" note
   above for the same distinction in reverse). */
const myCtx = await browser.newContext();
await myCtx.route(/^(?!.*localhost).*$/, (route) => route.abort());
const myFlow = await myCtx.newPage();

async function waitForAccountsScreen(pg) { await pg.waitForSelector('.my-accounts-actions'); }
async function waitForCompleteness(pg, text) {
  await pg.waitForFunction((t) => {
    const el = document.querySelector('.my-acc-completeness');
    return el && el.textContent.includes(t);
  }, text);
}
function daysAgoIso(n) { return new Date(Date.now() - n * 86400000).toISOString(); }
async function setBackupMeta(pg, meta) {
  await pg.evaluate((m) => localStorage.setItem('freestack:v1:my:meta', JSON.stringify(m)), meta);
}
/* store.js is the single write choke-point (CLAUDE.md); reading its result
   through the module itself, rather than parsing localStorage by hand, is
   the seam the task instructions call out as an acceptable non-UI check. */
async function diskDoc(pg) {
  return pg.evaluate(async () => { const s = await import('/js/my/store.js'); return s.load(); });
}
async function completeHeadlessSetup(pg, business) {
  await pg.locator('button', { hasText: 'Start your own register' }).first().click();
  await pg.waitForSelector('.my-setup-panel');
  await pg.locator('.my-setup-panel input[type=text]').first().fill(business);
  await pg.locator('button', { hasText: 'Continue' }).first().click();
  await pg.waitForSelector('.my-setup-panel');
  await pg.locator('button', { hasText: 'Continue' }).first().click(); // review step: no templates ticked
  await pg.waitForSelector('.my-setup-panel');
  await pg.locator('button', { hasText: 'Not now' }).first().click(); // no encryption on the plaintext path
  await pg.waitForSelector('button:has-text("Download your register file")', { timeout: 15000 });
  await Promise.all([
    pg.waitForEvent('download', { timeout: 5000 }).catch(() => null),
    pg.locator('button', { hasText: 'Download your register file' }).click(),
  ]);
  await pg.locator('button', { hasText: 'Finish setup' }).click();
  await pg.waitForSelector('.my-nav-item');
}

/* 15.1: full first-run setup completes headlessly and lands on Overview. */
await myFlow.goto(`${base}/my`);
await myFlow.waitForSelector('#my-root:not([hidden])');
await completeHeadlessSetup(myFlow, 'Acme Test Ltd');
check('my: first-run setup completes headlessly and lands on Overview',
  (await myFlow.locator('.my-topbar-name').textContent()).includes('Acme Test Ltd')
  && (await myFlow.locator('.my-screen h2').first().textContent()).trim() === 'Overview');
const setupDoc = await diskDoc(myFlow);
check('my: verified export leaves a real plaintext register on disk', !!setupDoc && setupDoc.business === 'Acme Test Ltd');

/* 15.9 (part 1): account CRUD round trip, each mutation checked across a
   real reload so it is IndexedDB doing the remembering, not in-memory state. */
await myFlow.locator('.my-nav-item', { hasText: 'Accounts' }).click();
await waitForAccountsScreen(myFlow);
const countBeforeAdd = await myFlow.locator('.my-acc-row').count();
await myFlow.locator('button', { hasText: 'Add account' }).first().click();
await myFlow.waitForSelector('.my-acc-drawer');
check('my: add account creates a row', await myFlow.locator('.my-acc-row').count() === countBeforeAdd + 1);

const serviceInput = myFlow.locator('.my-acc-service .my-acc-input').first();
await serviceInput.fill('Google Workspace');
await serviceInput.dispatchEvent('change');
await waitForCompleteness(myFlow, '1 of 8');
const ownerInput = myFlow.locator('.my-acc-owner .my-acc-input').first();
await ownerInput.fill('Priya Patel');
await ownerInput.dispatchEvent('change');
await waitForCompleteness(myFlow, '2 of 8');

await myFlow.reload();
await myFlow.waitForSelector('.my-nav-item');
await myFlow.locator('.my-nav-item', { hasText: 'Accounts' }).click();
await waitForAccountsScreen(myFlow);
const serviceValAfterReload = await myFlow.locator('.my-acc-service .my-acc-input').first().inputValue();
const ownerValAfterReload = await myFlow.locator('.my-acc-owner .my-acc-input').first().inputValue();
check('my: account edit survives reload (IndexedDB persistence)',
  serviceValAfterReload === 'Google Workspace' && ownerValAfterReload === 'Priya Patel',
  `service=${serviceValAfterReload} owner=${ownerValAfterReload}`);

await myFlow.locator('.my-acc-actions button', { hasText: 'Delete' }).first().click();
await myFlow.waitForFunction((n) => document.querySelectorAll('.my-acc-row').length === n, countBeforeAdd);
await myFlow.reload();
await myFlow.waitForSelector('.my-nav-item');
await myFlow.locator('.my-nav-item', { hasText: 'Accounts' }).click();
await waitForAccountsScreen(myFlow);
check('my: deleted account stays gone after reload', await myFlow.locator('.my-acc-row').count() === countBeforeAdd);

/* 15.9 (part 2): two-tab conflict refusal. Tab B loads while it still
   agrees with tab A's revision, tab A then saves (bumping the on-disk
   revision), and tab B's own attempted save is refused: store.js's
   ConflictError surfaces in the UI as the reload banner, per the module
   comment on mutateDoc(), and the stale write never reaches disk. */
const tabB = await myCtx.newPage();
await tabB.goto(`${base}/my`);
await tabB.waitForSelector('.my-nav-item');
await tabB.locator('.my-nav-item', { hasText: 'Accounts' }).click();
await waitForAccountsScreen(tabB);

await myFlow.locator('button', { hasText: 'Add account' }).first().click();
await myFlow.waitForSelector('.my-acc-drawer');

await tabB.locator('button', { hasText: 'Add account' }).first().click();
await tabB.waitForSelector('.my-banner-reload', { timeout: 5000 });
const bannerTxt = await tabB.locator('.my-banner-reload').textContent();
check('my: two-tab conflict shows the reload banner in the stale tab', bannerTxt.includes('changed in another tab'), bannerTxt);
const diskAfterConflict = await diskDoc(myFlow);
check('my: two-tab conflict refusal never persists the stale write', diskAfterConflict.accounts.length === countBeforeAdd + 1, `len=${diskAfterConflict.accounts.length}`);
await tabB.close();

/* 15.8: export then re-import round trip. Captured through store.js
   directly (module comment above), since a real anchor download plus a
   fresh setup's own download is already exercised twice by
   completeHeadlessSetup() above without needing a third. Wipe via the
   Backup screen's typed-confirmation flow, set up a disposable throwaway
   register so Backup is reachable again, then import the original bytes
   back through the real file-picker input and confirm the data returns. */
const exportedText = await myFlow.evaluate(async () => {
  const s = await import('/js/my/store.js');
  const { blob } = await s.exportBlob();
  return blob.text();
});
const originalAccountCount = countBeforeAdd + 1;

await myFlow.locator('.my-nav-item', { hasText: 'Backup' }).click();
await myFlow.waitForSelector('.my-backup-wipe');
await myFlow.locator('.my-backup-wipe input[type=text]').fill('Acme Test Ltd');
await myFlow.locator('.my-backup-wipe button', { hasText: 'Wipe this workspace' }).click();
await myFlow.waitForSelector('.my-firstrun');

await completeHeadlessSetup(myFlow, 'Temp Wipe Test');
await myFlow.locator('.my-nav-item', { hasText: 'Backup' }).click();
await myFlow.waitForSelector('.my-import-file-input');
await myFlow.locator('.my-import-file-input').setInputFiles({
  name: 'mystack-register-acme-test-ltd.fsr.json',
  mimeType: 'application/json',
  buffer: Buffer.from(exportedText, 'utf8'),
});
await myFlow.waitForSelector('.my-import-preview');
const previewText = await myFlow.locator('.my-import-preview').textContent();
check('my: import preview shows the original business and account count',
  previewText.includes('Acme Test Ltd') && previewText.includes(String(originalAccountCount)), previewText);
await myFlow.locator('.my-import-preview button', { hasText: 'Replace this register' }).click();
await myFlow.waitForFunction(() => document.querySelector('.my-topbar-name')?.textContent.includes('Acme Test Ltd'));
await myFlow.locator('.my-nav-item', { hasText: 'Accounts' }).click();
await waitForAccountsScreen(myFlow);
check('my: export then re-import round trip restores the original data', await myFlow.locator('.my-acc-row').count() === originalAccountCount);

/* 15.8: backup-age escalation. backupAgeInfo() in workspace.js is not
   exported (unlike risks.js's pure helpers), so per the task's own fallback
   this is driven through the UI: writing the meta record store.js itself
   reads status() from, then reloading and reading the sidebar's age chip,
   the same one screenOverview()'s tile and screenBackup()'s row both quote. */
await setBackupMeta(myFlow, { lastExportAt: daysAgoIso(5), savesSinceExport: 0 });
await myFlow.reload();
await myFlow.waitForSelector('.my-age-chip');
check('my: backup-age quiet under 30 days', await myFlow.locator('.my-age-chip.my-age-chip-ok').count() === 1);

await setBackupMeta(myFlow, { lastExportAt: daysAgoIso(31), savesSinceExport: 0 });
await myFlow.reload();
await myFlow.waitForSelector('.my-age-chip');
check('my: backup-age amber past 30 days', await myFlow.locator('.my-age-chip.my-age-chip-amber').count() === 1);

await setBackupMeta(myFlow, { lastExportAt: daysAgoIso(61), savesSinceExport: 0 });
await myFlow.reload();
await myFlow.waitForSelector('.my-age-chip');
check('my: backup-age red past 60 days', await myFlow.locator('.my-age-chip.my-age-chip-red').count() === 1);

await setBackupMeta(myFlow, { lastExportAt: daysAgoIso(5), savesSinceExport: 10 });
await myFlow.reload();
await myFlow.waitForSelector('.my-age-chip');
check('my: backup-age red after 10 or more saves since export', await myFlow.locator('.my-age-chip.my-age-chip-red').count() === 1);

/* Rocky's 28 Jul phone find: the backup-age tile rendered its whole status
   sentence at the 34px stat-numeral size. Long (textual) tile values must
   drop to the body register; numeric tiles keep the big numerals. */
await setBackupMeta(myFlow, { lastExportAt: daysAgoIso(2), savesSinceExport: 11 });
await myFlow.reload();
await myFlow.waitForSelector('.my-tiles');
const backupTileValue = myFlow.locator('.my-tile-value--text').first();
check('my: backup-age tile sentence renders at body scale, not the stat-numeral size',
  await backupTileValue.count() === 1
  && await backupTileValue.evaluate((n) => getComputedStyle(n).fontSize) === '16px',
  await backupTileValue.count() ? await backupTileValue.evaluate((n) => getComputedStyle(n).fontSize) : 'missing');
const numericTileValue = myFlow.locator('.my-tile-value:not(.my-tile-value--text)').first();
check('my: numeric tiles keep the stat-numeral size',
  parseInt(await numericTileValue.evaluate((n) => getComputedStyle(n).fontSize), 10) >= 30);

await myFlow.close();
await myCtx.close();

/* --- Phase 12.4 (BUILD-PLAN 12.4, PRD-REGISTER sections 16 and 19): planned
   status end to end and the Discover arrival (?from=/?have=). Each URL
   variant gets its own fresh browser context, since each is a first-run
   register of its own; plaintext throughout, same reasoning as the batch D
   suite above (PBKDF2 is too slow to spend on a smoke gate). ------------- */
async function completeHeadlessStackSetup(pg, business) {
  await pg.locator('button', { hasText: 'Start from your stack' }).first().click();
  await pg.waitForSelector('.my-setup-panel');
  await pg.locator('.my-setup-panel input[type=text]').first().fill(business);
  await pg.locator('button', { hasText: 'Continue' }).first().click();
  await pg.waitForSelector('.my-setup-panel');
  await pg.locator('button', { hasText: 'Continue' }).first().click(); // review step: no templates ticked
  await pg.waitForSelector('.my-setup-panel');
  await pg.locator('button', { hasText: 'Not now' }).first().click(); // no encryption on the plaintext path
  await pg.waitForSelector('button:has-text("Download your register file")', { timeout: 15000 });
  await Promise.all([
    pg.waitForEvent('download', { timeout: 5000 }).catch(() => null),
    pg.locator('button', { hasText: 'Download your register file' }).click(),
  ]);
  await pg.locator('button', { hasText: 'Finish setup' }).click();
  await pg.waitForSelector('.my-nav-item');
}

/* /my?have=0 (section 19): tool 0 (id 0 discipline, named smoke check per
   the task) commits as exactly one active row, in exactly one revision. */
{
  const ctx = await browser.newContext();
  await ctx.route(/^(?!.*localhost).*$/, (route) => route.abort());
  const pg = await ctx.newPage();
  await pg.goto(`${base}/my?have=0`);
  await pg.waitForSelector('#my-root:not([hidden])');
  await completeHeadlessStackSetup(pg, 'Have Zero Test');
  const savedDoc = await diskDoc(pg);
  check('my: /my?have=0 commits tool 0 as one active row, revision 1',
    !!savedDoc && savedDoc.revision === 1 && savedDoc.accounts.length === 1
    && savedDoc.accounts[0].toolId === 0 && savedDoc.accounts[0].status === 'active',
    JSON.stringify(savedDoc && { revision: savedDoc.revision, accounts: savedDoc.accounts.map((a) => [a.toolId, a.status]) }));
  await pg.close();
  await ctx.close();
}

/* /my?from=2,5&have=0 (section 19): the arrival marker (have=, present at
   all) flips the from= group's default to planned; have= itself is always
   active. */
{
  const ctx = await browser.newContext();
  await ctx.route(/^(?!.*localhost).*$/, (route) => route.abort());
  const pg = await ctx.newPage();
  await pg.goto(`${base}/my?from=2,5&have=0`);
  await pg.waitForSelector('#my-root:not([hidden])');
  await completeHeadlessStackSetup(pg, 'Discover Arrival Test');
  const savedDoc = await diskDoc(pg);
  const byTool = new Map((savedDoc?.accounts || []).map((a) => [a.toolId, a.status]));
  check('my: /my?from=2,5&have=0 defaults 2 and 5 to planned, 0 to active',
    savedDoc && savedDoc.accounts.length === 3 && byTool.get(2) === 'planned' && byTool.get(5) === 'planned' && byTool.get(0) === 'active',
    JSON.stringify([...byTool.entries()]));
  await pg.close();
  await ctx.close();
}

/* /my?from=t:0,2,5 WITHOUT have= (section 19): the arrival marker is wholly
   absent, so behaviour matches every client-page link sent before this
   phase existed, rows defaulting active, "t:" prefix stripped as ever. */
{
  const ctx = await browser.newContext();
  await ctx.route(/^(?!.*localhost).*$/, (route) => route.abort());
  const pg = await ctx.newPage();
  await pg.goto(`${base}/my?from=t:0,2,5`);
  await pg.waitForSelector('#my-root:not([hidden])');
  await completeHeadlessStackSetup(pg, 'Legacy From Test');
  const savedDoc = await diskDoc(pg);
  const statuses = (savedDoc?.accounts || []).map((a) => a.status);
  check('my: /my?from=t:0,2,5 without have= matches pre-phase behaviour (all active)',
    savedDoc && savedDoc.accounts.length === 3 && statuses.every((s) => s === 'active'),
    JSON.stringify(statuses));
  await pg.close();
  await ctx.close();
}

/* A raw from= value over the 512-character cap (section 19) is treated as
   wholly absent: no import offer on first-run, and no crash getting there. */
{
  const ctx = await browser.newContext();
  await ctx.route(/^(?!.*localhost).*$/, (route) => route.abort());
  const pg = await ctx.newPage();
  const longErrors = [];
  pg.on('pageerror', (e) => longErrors.push(String(e)));
  await pg.goto(`${base}/my?from=${'1'.repeat(600)}`);
  await pg.waitForSelector('#my-root:not([hidden])');
  await pg.waitForSelector('.my-firstrun');
  const stackButtonCount = await pg.locator('button', { hasText: 'Start from your stack' }).count();
  check('my: a 600-char from= value is ignored (no import offer, no crash)',
    stackButtonCount === 0 && longErrors.length === 0, `stackButtons=${stackButtonCount} errors=${longErrors.join(' | ')}`);
  await pg.close();
  await ctx.close();
}

/* Grep gate (section 19, law restated in the changelog): no js/my/* module
   may read the Discover deck's freestack:v1:discover key. The deck's own
   js/discover.js is the one owner of that key and is deliberately excluded
   from this scan. */
{
  const myDir = join(ROOT, 'js', 'my');
  const files = (await readdir(myDir, { recursive: true }))
    .filter((f) => f.endsWith('.js'))
    .map((f) => join(myDir, f));
  const offenders = [];
  for (const file of files) {
    const text = (await readFile(file)).toString('utf8');
    if (text.includes('freestack:v1:discover')) offenders.push(file);
  }
  check('grep: no js/my/* module references freestack:v1:discover', offenders.length === 0, offenders.join(', '));
}

/* A planned row is excluded from the Overview risk tiles and renders inside
   the Accounts screen's "To sign up" group with its quiet chip, while an
   otherwise-identical active row IS counted: constructed directly through
   store.js (the one write choke-point), one save, so this is a true
   equivalence check rather than two separately-built registers. */
{
  const ctx = await browser.newContext();
  await ctx.route(/^(?!.*localhost).*$/, (route) => route.abort());
  const pg = await ctx.newPage();
  await pg.goto(`${base}/my`);
  await pg.waitForSelector('#my-root:not([hidden])');
  await completeHeadlessSetup(pg, 'Planned Risk Test');
  await pg.evaluate(async () => {
    const s = await import('/js/my/store.js');
    const doc = await s.load();
    doc.accounts.push(
      {
        id: 'planned-risk-1', service: 'Planned Tool', url: '', toolId: null,
        identity: 'owner@gmail.com', owner: '', admin: 'unknown', mfa: 'none',
        plan: '', renewal: null, monthlyCost: null, status: 'planned', notes: '', shared: false,
      },
      {
        id: 'active-risk-1', service: 'Active Tool', url: '', toolId: null,
        identity: 'owner2@gmail.com', owner: '', admin: 'unknown', mfa: 'none',
        plan: '', renewal: null, monthlyCost: null, status: 'active', notes: '', shared: false,
      },
    );
    await s.save(doc, doc.revision);
  });
  await pg.reload();
  await pg.waitForSelector('.my-nav-item');
  const personalTileText = (await pg.locator('.my-tile', { hasText: 'On personal email' }).textContent()).trim();
  const mfaTileText = (await pg.locator('.my-tile', { hasText: 'No 2FA recorded' }).textContent()).trim();
  check('my: planned row excluded from the personal-email risk tile (only the active twin counts)',
    personalTileText.startsWith('1'), personalTileText);
  check('my: planned row excluded from the no-2FA risk tile (only the active twin counts)',
    mfaTileText.startsWith('1'), mfaTileText);

  await pg.locator('.my-nav-item', { hasText: 'Accounts' }).click();
  await waitForAccountsScreen(pg);
  const accountsText = await pg.textContent('.my-screen');
  check('my: "To sign up" group renders for a planned row', accountsText.includes('To sign up'));
  check('my: planned row carries the quiet "Planned" chip',
    await pg.locator('.my-signup-group .my-chip-quiet', { hasText: 'Planned' }).count() === 1);
  await pg.close();
  await ctx.close();
}

/* Fix round (BUILD-PLAN 12.4, verifier defect, 27 Jul): an owner whose only
   footprint is planned rows must not appear in the Leavers dropdown (they
   are a future account holder, not a leaver candidate); typing that name
   free-text must still work (a real person's mailbox and identity-provider
   account exist regardless of what the register recorded) but the checklist
   must say plainly that phases 1 and 5 are then generic, nothing here drawn
   from the register; and a planned row's monthlyCost must not move the
   Costs total, only an otherwise-identical active row's cost should. */
{
  const ctx = await browser.newContext();
  await ctx.route(/^(?!.*localhost).*$/, (route) => route.abort());
  const pg = await ctx.newPage();
  await pg.goto(`${base}/my`);
  await pg.waitForSelector('#my-root:not([hidden])');
  await completeHeadlessSetup(pg, 'Leavers Costs Fix Test');
  await pg.evaluate(async () => {
    const s = await import('/js/my/store.js');
    const doc = await s.load();
    doc.accounts.push(
      {
        id: 'fix-active-owner', service: 'Xero', url: '', toolId: null,
        identity: '', owner: 'Active Person', admin: 'unknown', mfa: 'unknown',
        plan: '', renewal: null, monthlyCost: 50, status: 'active', notes: '', shared: false,
      },
      {
        id: 'fix-planned-owner', service: 'Future Tool', url: '', toolId: null,
        identity: '', owner: 'Planned Only Person', admin: 'unknown', mfa: 'unknown',
        plan: '', renewal: null, monthlyCost: 50, status: 'planned', notes: '', shared: false,
      },
    );
    await s.save(doc, doc.revision);
  });
  await pg.reload();
  await pg.waitForSelector('.my-nav-item');

  await pg.locator('.my-nav-item', { hasText: 'Leavers' }).click();
  await pg.waitForSelector('.my-leaver-picker select');
  const dropdownOptions = await pg.locator('.my-leaver-picker select option').allTextContents();
  check('my: an owner of only planned rows is absent from the Leavers dropdown, an active owner is present',
    dropdownOptions.includes('Active Person') && !dropdownOptions.includes('Planned Only Person'),
    dropdownOptions.join(' | '));

  await pg.locator('.my-leaver-picker input[type=text]').fill('Planned Only Person');
  await pg.locator('button', { hasText: 'Generate checklist' }).click();
  await pg.waitForSelector('.my-leaver-checklist');
  const honestyText = await pg.locator('.my-leaver-honesty').textContent().catch(() => null);
  check('my: typing a planned-only owner free-text still generates a checklist, with the honest "no live accounts" line',
    honestyText !== null && honestyText.includes('no live accounts recorded') && honestyText.includes('Planned Only Person'),
    honestyText);
  const phase1Text = await pg.locator('.my-leaver-phase').first().textContent();
  check('my: phase 1 (identity) still renders its generic step for a planned-only name',
    phase1Text.includes('Disable'), phase1Text.trim().slice(0, 80));

  await pg.locator('.my-nav-item', { hasText: 'Costs' }).click();
  await pg.waitForSelector('.my-costs-figure');
  const costsFigureText = (await pg.locator('.my-costs-figure').textContent()).trim();
  check("my: a planned row's monthlyCost does not move the Costs total, only the active twin's does",
    costsFigureText.includes('50') && !costsFigureText.includes('100'), costsFigureText);

  await pg.close();
  await ctx.close();
}

/* --- Phase 12.5 (BUILD-PLAN 12.5, PRD-REGISTER sections 17, 18, 20): batch
   add, the sign-up generator, and reading-copy exports. Plaintext throughout
   (PBKDF2 at 600,000 iterations is too slow for a smoke gate, same
   reasoning as every /my suite above); the "locked register" check below is
   therefore deliberately the PLAINTEXT-PATH CONTROL VISIBILITY check only
   (its own comment says so), with the true encrypted/locked absence of
   these controls driven instead through a real passphrase in the scratch
   Playwright session outside this suite, per the task's own fallback for a
   check that would otherwise need a slow KDF to set up. ------------------ */

/* Batch add (section 17): one catalogue tool, one sovereign template and one
   free-text name, mixed in a single batch, commit in exactly one
   store.save(), so the on-disk revision increments by exactly 1, never 3. */
{
  const ctx = await browser.newContext();
  await ctx.route(/^(?!.*localhost).*$/, (route) => route.abort());
  const pg = await ctx.newPage();
  await pg.goto(`${base}/my`);
  await pg.waitForSelector('#my-root:not([hidden])');
  await completeHeadlessSetup(pg, 'Batch Add Test');
  await pg.locator('.my-nav-item', { hasText: 'Accounts' }).click();
  await waitForAccountsScreen(pg);
  const revisionBefore = (await diskDoc(pg)).revision;

  await pg.locator('button', { hasText: 'Add several at once' }).click();
  await pg.waitForSelector('.my-batch-sheet');
  // One catalogue tool, found by search-as-you-type (section 17).
  await pg.locator('.my-batch-sheet input[type=search]').fill('Canva');
  await pg.waitForTimeout(150);
  await pg.locator('.my-batch-sheet .my-batch-picklist label', { hasText: 'Canva' }).first().locator('input[type=checkbox]').check();
  // One sovereign template, mixed in with the catalogue pick.
  await pg.locator('.my-batch-sheet .my-template-row', { hasText: 'HMRC Government Gateway' }).locator('input[type=checkbox]').check();
  // One free-text name, mixed in with both of the above (section 17:
  // "mixable in one batch").
  await pg.locator('.my-batch-sheet input[type=text]').fill('A Handwritten Tool');
  await pg.locator('.my-batch-sheet button', { hasText: 'Add name' }).click();
  const tickedText = await pg.locator('.my-batch-sheet button', { hasText: 'Continue (' }).textContent();
  check('my: batch add ticked count reflects three mixed picks (catalogue + template + free text)',
    tickedText.includes('3 ticked'), tickedText);
  await pg.locator('.my-batch-sheet button', { hasText: 'Continue (' }).click();

  await pg.waitForSelector('.my-batch-sheet');
  const identityFields = pg.locator('.my-batch-sheet input[type=text]');
  await identityFields.nth(0).fill('accounts@gmail.com'); // a personal domain, deliberately
  await identityFields.nth(1).fill('Priya Patel');
  const personalChipCount = await pg.locator('.my-batch-sheet .my-chip-risk', { hasText: 'Personal email' }).count();
  check('my: batch shared-identity personal-email detection fires once, at step 2', personalChipCount === 1, `chips=${personalChipCount}`);
  await pg.locator('.my-batch-sheet button', { hasText: 'Continue' }).click();

  await pg.waitForSelector('.my-batch-sheet');
  const reviewRows = await pg.locator('.my-batch-sheet .my-attention-list li').count();
  check('my: batch review lists one row per ticked service', reviewRows === 3, `rows=${reviewRows}`);
  await pg.locator('.my-batch-sheet button', { hasText: 'Add 3 account' }).click();
  await pg.waitForSelector('.my-batch-sheet', { state: 'detached' });

  const docAfterBatch = await diskDoc(pg);
  check('my: a batch of 3 increments revision by exactly 1',
    docAfterBatch.revision === revisionBefore + 1, `before=${revisionBefore} after=${docAfterBatch.revision}`);
  check('my: a batch of 3 adds exactly 3 accounts in one commit',
    docAfterBatch.accounts.length === 3, `accounts=${docAfterBatch.accounts.length}`);
  check('my: every batch row carries the shared identity/owner entered once',
    docAfterBatch.accounts.every((a) => a.identity === 'accounts@gmail.com' && a.owner === 'Priya Patel'),
    JSON.stringify(docAfterBatch.accounts.map((a) => [a.identity, a.owner])));

  // Per-row override afterwards, through the existing drawer (section 17:
  // "the batch form deliberately carries no per-row fields"). Service names
  // live inside an <input value>, not a text node, so the row is found by
  // that input's value rather than the row's (input-blind) textContent.
  await waitForAccountsScreen(pg);
  const canvaRow = pg.locator('.my-acc-row').filter({ has: pg.locator('input[value="Canva Free"]') }).first();
  await canvaRow.locator('.my-acc-details-btn').click();
  await pg.waitForSelector('.my-acc-drawer');
  const planField = pg.locator('.my-acc-drawer label', { hasText: 'Plan' }).locator('input');
  await planField.fill('Pro');
  await planField.dispatchEvent('change');
  await pg.waitForFunction(async () => {
    const s = await import('/js/my/store.js');
    const d = await s.load();
    const row = d.accounts.find((a) => a.service === 'Canva Free');
    return !!row && row.plan === 'Pro';
  });
  const docAfterOverride = await diskDoc(pg);
  const canvaAccountRow = docAfterOverride.accounts.find((a) => a.service === 'Canva Free');
  check('my: a per-row override after batch commit only changes that one row',
    !!canvaAccountRow && canvaAccountRow.plan === 'Pro' && canvaAccountRow.identity === 'accounts@gmail.com',
    JSON.stringify(canvaAccountRow));
  await pg.close();
  await ctx.close();
}

/* Sign-up generator (section 18): a planned row linked to tool id 0 (id 0
   discipline, and this catalogue tool genuinely carries a free_limit
   sentence) produces a checklist whose on-screen sheet includes that
   sentence verbatim, and stays within the section 11 Cyber Essentials
   wording law. Fed through a Discover arrival (?from=0&have=), the same
   "want to try" mechanic Wave D already covers, then the "Generate sign-up
   list" bulk action over the resulting "To sign up" group (section 18's
   first reach point, from Accounts). */
{
  const ctx = await browser.newContext();
  await ctx.route(/^(?!.*localhost).*$/, (route) => route.abort());
  const pg = await ctx.newPage();
  await pg.goto(`${base}/my?from=0&have=`);
  await pg.waitForSelector('#my-root:not([hidden])');
  await completeHeadlessStackSetup(pg, 'Generator FreeLimit Test');
  await pg.locator('.my-nav-item', { hasText: 'Accounts' }).click();
  await waitForAccountsScreen(pg);

  /* Wave 12.5 fix round: the bulk bar's buttons (including the new
     "Sign-up list for N") must meet the 44px floor at phone width. The
     original wave shipped them at 28px because .my-bulk-bar .btn was
     missing from the mobile rule, and no earlier check measured real
     pixels here. */
  await pg.setViewportSize({ width: 375, height: 812 });
  await pg.locator('.my-acc-check input[type=checkbox]').first().check();
  await pg.waitForSelector('.my-bulk-bar');
  const bulkHeights = [];
  for (const b of await pg.locator('.my-bulk-bar .btn').all()) {
    const box = await b.boundingBox();
    if (box) bulkHeights.push(Math.round(box.height));
  }
  check('my: bulk-bar buttons meet the 44px floor at 375px',
    bulkHeights.length > 0 && bulkHeights.every((h) => h >= 44), bulkHeights.join(','));
  await pg.locator('.my-acc-check input[type=checkbox]').first().uncheck();
  await pg.setViewportSize({ width: 1280, height: 900 });

  await pg.locator('button', { hasText: 'Generate sign-up list' }).first().click();
  await pg.waitForSelector('.my-generator-sheet');
  const sheetText = await pg.locator('.my-generator-sheet').textContent();
  const freeLimitSentence = 'Each provider gives a daily message allowance on an older or smaller model with no memory of past chats between sessions; the roughly £16/month Pro/Plus tier per provider removes the daily cap and unlocks the top model.';
  check('my: generator output contains the free_limit sentence verbatim for a tool that has one',
    sheetText.includes(freeLimitSentence), sheetText.slice(0, 200));
  check('my: generator stays within the Cyber Essentials wording law (prepares for, never certified/compliant)',
    sheetText.includes('helps you prepare for Cyber Essentials') && sheetText.includes('does not make you certified'),
    sheetText.slice(0, 400));
  await pg.close();
  await ctx.close();
}

/* Pre-seed dedupe (section 18): reached from the import review (the merge
   banner's want-list, section 18's second reach point), over tool id 1, on
   a register that does NOT yet have that tool. First pre-seed creates
   exactly one planned row; reopening the same generator over the same
   want-list id a second time offers no pre-seed control at all (the tool
   is now already registered), and the on-disk row count for that toolId
   never exceeds one. */
{
  const ctx = await browser.newContext();
  await ctx.route(/^(?!.*localhost).*$/, (route) => route.abort());
  const pg = await ctx.newPage();
  await pg.goto(`${base}/my`);
  await pg.waitForSelector('#my-root:not([hidden])');
  await completeHeadlessSetup(pg, 'PreSeed Dedup Test');

  await pg.goto(`${base}/my?from=1&have=`);
  await pg.waitForSelector('.my-banner-merge');
  await pg.locator('.my-banner-merge button', { hasText: 'Review' }).click();
  await pg.waitForSelector('.my-banner-merge-open');
  await pg.locator('.my-banner-merge-open button', { hasText: 'Sign-up list for these' }).click();
  await pg.waitForSelector('.my-generator-sheet');
  check('my: pre-seed control offered the first time (tool not yet in the register)',
    await pg.locator('.my-generator-preseed').count() === 1);
  await pg.locator('.my-generator-preseed input[type=checkbox]').check();
  await pg.locator('.my-generator-preseed button', { hasText: 'Add' }).click();
  await pg.waitForSelector('.my-generator-preseed', { state: 'detached' });

  const docAfterFirstSeed = await diskDoc(pg);
  const firstSeedCount = docAfterFirstSeed.accounts.filter((a) => a.toolId === 1).length;
  check('my: pre-seed creates exactly one planned row for the tool', firstSeedCount === 1, `count=${firstSeedCount}`);

  await pg.locator('.my-generator-sheet button', { hasText: 'Close' }).click();
  await pg.locator('.my-banner-merge-open button', { hasText: 'Sign-up list for these' }).click();
  await pg.waitForSelector('.my-generator-sheet');
  check('my: pre-seeding a second time offers no pre-seed control (tool already registered)',
    await pg.locator('.my-generator-preseed').count() === 0);
  const docAfterSecondAttempt = await diskDoc(pg);
  const secondAttemptCount = docAfterSecondAttempt.accounts.filter((a) => a.toolId === 1).length;
  check('my: pre-seeding twice yields no duplicate toolId rows', secondAttemptCount === 1, `count=${secondAttemptCount}`);
  await pg.close();
  await ctx.close();
}

/* Pre-seed dedupe, tool id 0 twin of the block above. Tool 0 is a real
   catalogue entry and every id-keyed lookup in this codebase must use
   Number.isInteger/strict equality rather than a truthiness test, or id 0
   silently behaves like "no tool id" and vanishes. This same dedupe path
   (accounts.filter((a) => a.toolId === 0)) would pass even if the id-0 row
   never got created at all, if it were written with `a.toolId` alone as a
   truthy check, since 0 rows also filter to nothing: the count assertion
   below is only meaningful because the first-seed check above it confirms
   the row actually exists before the count is read. */
{
  const ctx = await browser.newContext();
  await ctx.route(/^(?!.*localhost).*$/, (route) => route.abort());
  const pg = await ctx.newPage();
  await pg.goto(`${base}/my`);
  await pg.waitForSelector('#my-root:not([hidden])');
  await completeHeadlessSetup(pg, 'PreSeed Dedup Test Zero');

  await pg.goto(`${base}/my?from=0&have=`);
  await pg.waitForSelector('.my-banner-merge');
  await pg.locator('.my-banner-merge button', { hasText: 'Review' }).click();
  await pg.waitForSelector('.my-banner-merge-open');
  await pg.locator('.my-banner-merge-open button', { hasText: 'Sign-up list for these' }).click();
  await pg.waitForSelector('.my-generator-sheet');
  check('my: tool 0 pre-seed control offered the first time (tool not yet in the register)',
    await pg.locator('.my-generator-preseed').count() === 1);
  await pg.locator('.my-generator-preseed input[type=checkbox]').check();
  await pg.locator('.my-generator-preseed button', { hasText: 'Add' }).click();
  await pg.waitForSelector('.my-generator-preseed', { state: 'detached' });

  const docAfterFirstSeedZero = await diskDoc(pg);
  const firstSeedCountZero = docAfterFirstSeedZero.accounts.filter((a) => a.toolId === 0).length;
  check('my: tool 0 pre-seed creates exactly one planned row', firstSeedCountZero === 1, `count=${firstSeedCountZero}`);

  await pg.locator('.my-generator-sheet button', { hasText: 'Close' }).click();
  await pg.locator('.my-banner-merge-open button', { hasText: 'Sign-up list for these' }).click();
  await pg.waitForSelector('.my-generator-sheet');
  check('my: tool 0 pre-seeding a second time offers no pre-seed control (tool already registered)',
    await pg.locator('.my-generator-preseed').count() === 0);
  const docAfterSecondAttemptZero = await diskDoc(pg);
  const secondAttemptCountZero = docAfterSecondAttemptZero.accounts.filter((a) => a.toolId === 0).length;
  check('my: tool 0 pre-seeding twice yields no duplicate toolId rows', secondAttemptCountZero === 1, `count=${secondAttemptCountZero}`);
  await pg.close();
  await ctx.close();
}

/* Reading-copy exports (section 20): CSV formula-injection escaping, CRLF,
   the section 4.2 field header, and the savesSinceExport/backup-age
   invariant (producing a reading copy is never a save and never an
   export). Also the plaintext-path control-visibility check the module
   comment above explains. */
{
  const ctx = await browser.newContext();
  await ctx.route(/^(?!.*localhost).*$/, (route) => route.abort());
  const pg = await ctx.newPage();
  await pg.goto(`${base}/my`);
  await pg.waitForSelector('#my-root:not([hidden])');
  await completeHeadlessSetup(pg, 'CSV Escape Test');
  await pg.evaluate(async () => {
    const s = await import('/js/my/store.js');
    const doc = await s.load();
    doc.accounts.push({
      id: 'csv-hostile-1', service: '=2+5', url: '', toolId: null,
      identity: '', owner: '', admin: 'unknown', mfa: 'unknown',
      plan: '', renewal: null, monthlyCost: null, status: 'active', notes: '', shared: false,
    });
    await s.save(doc, doc.revision);
  });
  // A known, distinct savesSinceExport, set directly (module comment on
  // setBackupMeta above), so producing a reading copy afterwards can be
  // shown to leave it untouched rather than merely unchanged by accident.
  await setBackupMeta(pg, { lastExportAt: daysAgoIso(5), savesSinceExport: 4 });
  await pg.reload();
  await pg.waitForSelector('.my-nav-item');
  await pg.locator('.my-nav-item', { hasText: 'Backup' }).click();
  await pg.waitForSelector('.my-reading-copy-section');

  const buttonLabels = await pg.locator('.my-reading-copy-section button').allTextContents();
  check('my: reading-copy controls (CSV, text, print) are visible on the plaintext/unlocked path '
    + '(the true encrypted/locked absence is checked in the scratch drive; PBKDF2 is too slow for this suite)',
    buttonLabels.some((t) => t.includes('CSV')) && buttonLabels.some((t) => t.includes('text')) && buttonLabels.some((t) => t.includes('Print')),
    buttonLabels.join(' | '));
  check('my: reading-copy section carries the "cannot be imported back" line, JSON register presented first',
    (await pg.locator('.my-reading-copy-section').textContent()).includes('cannot be imported back into My Stack'));

  const [csvDownload] = await Promise.all([
    pg.waitForEvent('download'),
    pg.locator('.my-reading-copy-section button', { hasText: 'Download as CSV' }).click(),
  ]);
  const csvText = await readFile(await csvDownload.path(), 'utf8');
  const csvLines = csvText.split('\r\n').filter(Boolean);
  check('my: CSV uses CRLF line endings', csvText.includes('\r\n'), JSON.stringify(csvText.slice(0, 30)));
  check('my: CSV header is exactly the section 4.2 field list',
    csvLines[0] === '"id","service","url","toolId","identity","owner","admin","mfa","plan","renewal","monthlyCost","status","notes"',
    csvLines[0]);
  check('my: a CSV cell of "=2+5" gains a leading apostrophe and stays quoted',
    csvLines.some((line) => line.includes('"\'=2+5"')), csvLines.find((l) => l.includes('2+5')));

  const statusAfterCsv = await pg.evaluate(async () => { const s = await import('/js/my/store.js'); return s.status(); });
  check('my: producing a CSV leaves savesSinceExport unchanged', statusAfterCsv.savesSinceExport === 4, `savesSinceExport=${statusAfterCsv.savesSinceExport}`);
  check('my: producing a CSV leaves the backup-age (lastExportAt) untouched, never counted as a verified export',
    statusAfterCsv.lastExportAt && new Date(statusAfterCsv.lastExportAt).toISOString().slice(0, 10) === daysAgoIso(5).slice(0, 10));

  const [txtDownload] = await Promise.all([
    pg.waitForEvent('download'),
    pg.locator('.my-reading-copy-section button', { hasText: 'Download as text' }).click(),
  ]);
  const txtText = await readFile(await txtDownload.path(), 'utf8');
  check('my: TXT is grouped like the register table (a status heading, then the hostile-named row)',
    txtText.includes('Active (') && txtText.includes('=2+5'), txtText.slice(0, 200));
  const statusAfterTxt = await pg.evaluate(async () => { const s = await import('/js/my/store.js'); return s.status(); });
  check('my: producing a TXT listing leaves savesSinceExport unchanged too', statusAfterTxt.savesSinceExport === 4, `savesSinceExport=${statusAfterTxt.savesSinceExport}`);

  const combinedOutputText = `${csvText}\n${txtText}`;
  check('grep: neither reading-copy output contains a password-shaped field or value',
    !/password/i.test(combinedOutputText));

  await pg.close();
  await ctx.close();
}

/* Grep gate (section 21 item 8, extended over this wave's own surfaces):
   no password field anywhere in the batch form, the generator, or any of
   the three reading-copy outputs. Every type=password input in
   workspace.js is required to carry a genuine passphrase autocomplete hint
   (new-password/current-password), which the batch form and the generator
   never do, since neither introduces a type=password input at all; and the
   reading-copy field list itself is checked directly against the source. */
{
  const src = (await readFile(join(ROOT, 'js', 'my', 'workspace.js'))).toString('utf8');
  const passwordInputs = [...src.matchAll(/el\('input',\s*\{[^}]*type:\s*'password'[^}]*\}/gs)];
  const offenders = passwordInputs.filter((m) => !/autocomplete:\s*'(new|current)-password'/.test(m[0]));
  check('grep: every type=password input in workspace.js is a genuine passphrase field (batch/generator/exports introduce none)',
    offenders.length === 0, offenders.map((m) => m[0]).join(' | '));
  check('grep: the reading-copy CSV/TXT field list never includes a password-shaped field',
    !/REGISTER_FIELDS\s*=\s*\[[^\]]*password/i.test(src));
}

check('no page errors across all loads', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));

await browser.close();
server.close();
console.log(failures.length ? `\n${failures.length} FAILURES` : '\nALL PASS');
process.exit(failures.length ? 1 : 0);
