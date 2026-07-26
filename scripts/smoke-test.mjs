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
import { readFile } from 'node:fs/promises';
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
await page.goto(`${base}/`);
await page.waitForSelector('#public-root .tool-card');
check(`public: all ${active.length} active tools as cards`, await page.locator('#public-root .tool-card').count() === active.length);
check('public: indexable, no robots meta', await page.locator('meta[name=robots]').count() === 0);
check('public: trust line and CTA present',
  (await page.textContent('#public-root')).includes('No affiliates')
  && (await page.textContent('#public-root')).includes('Talk to Kaipability'));
await page.fill('#public-root input[type=search]', 'canva');
await page.waitForTimeout(200);
const publicFiltered = await page.locator('#public-root .tool-card:visible').count();
check('public: search filters cards', publicFiltered > 0 && publicFiltered < active.length, `visible=${publicFiltered}`);
check('public: recently-updated strip renders', await page.locator('.pub-changelog, [class*=changelog]').count() >= 1);
await page.fill('#public-root input[type=search]', '');

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

const entryHeadings = await page.locator('.pub-entry-item h2').allTextContents();
check('homepage: three entry paths present, Discover first',
  entryHeadings.length === 3
  && entryHeadings[0] === 'Discover'
  && entryHeadings[1] === 'Persona packs'
  && entryHeadings[2] === 'Browse all',
  entryHeadings.join(' | '));

const beforeScrollY = await page.evaluate(() => window.scrollY);
await page.locator('[data-discover-entry]').click();
await page.waitForTimeout(300);
const afterDiscoverScrollY = await page.evaluate(() => window.scrollY);
check('homepage: Discover stub scrolls to the browse list instead of dead-ending',
  afterDiscoverScrollY > beforeScrollY, `before=${beforeScrollY} after=${afterDiscoverScrollY}`);
await page.evaluate(() => window.scrollTo(0, 0));

await page.waitForSelector('.pub-persona-chip');
const chipCountBefore = await page.locator('#public-root .tool-card').count();
await page.locator('.pub-persona-chip').first().click();
await page.waitForTimeout(150);
const chipFilteredCount = await page.locator('#public-root .tool-card').count();
check('homepage: a persona chip filters the browse list',
  chipFilteredCount > 0 && chipFilteredCount < chipCountBefore, `before=${chipCountBefore} after=${chipFilteredCount}`);
await page.locator('.pub-persona-chip').first().click(); // toggle back off
await page.waitForTimeout(150);
const chipClearedCount = await page.locator('#public-root .tool-card').count();
check('homepage: a second click on the active persona chip clears the filter',
  chipClearedCount === active.length, `visible=${chipClearedCount}`);

const homeMobile = await browser.newPage({ viewport: { width: 375, height: 812 } });
await homeMobile.route(/^(?!.*localhost).*$/, (route) => route.abort());
await homeMobile.goto(`${base}/`);
await homeMobile.waitForSelector('#public-root .tool-card');
const homeMobileScrollW = await homeMobile.evaluate(() => document.documentElement.scrollWidth);
check('homepage: no horizontal scroll at 375px', homeMobileScrollW <= 375, `scrollWidth=${homeMobileScrollW}`);
const homeMobileHeadings = await homeMobile.locator('.pub-entry-item h2').allTextContents();
check('homepage: entry paths still Discover-first at 375px',
  homeMobileHeadings[0] === 'Discover' && homeMobileHeadings[1] === 'Persona packs' && homeMobileHeadings[2] === 'Browse all',
  homeMobileHeadings.join(' | '));
await homeMobile.close();

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
await hoverPage.waitForSelector('#public-root .tool-card');
await hoverPage.waitForTimeout(700); // let the entrance animation finish first
const firstCardLi = hoverPage.locator('#public-root .card-grid > li').first();

// Regression guard: revealFirstPaint used to leave its inline entrance
// transition-delay set forever, which (transition-delay being a single CSS
// property, not scoped to the reveal transition alone) also delayed the
// hover-lift transition on this same element by however many milliseconds
// the entrance stagger had assigned it. Once the entrance transition has
// had time to finish, the inline delay must be gone.
const leftoverDelay = await firstCardLi.evaluate((n) => ({
  inline: n.style.transitionDelay,
  computed: getComputedStyle(n).transitionDelay,
}));
check('homepage: entrance stagger leaves no residual inline transition-delay',
  leftoverDelay.inline === '' && /^(0s(, 0s)*)$/.test(leftoverDelay.computed), JSON.stringify(leftoverDelay));

await firstCardLi.scrollIntoViewIfNeeded();
await firstCardLi.hover();
await hoverPage.waitForTimeout(300);
const hoverTransform = await firstCardLi.evaluate((n) => getComputedStyle(n).transform);
check('homepage: hover lift actually translates the card (not silently blocked by the entrance animation)',
  hoverTransform !== 'none' && hoverTransform !== 'matrix(1, 0, 0, 1, 0, 0)', hoverTransform);
await hoverPage.close();

/* --- Phase 12.1 regression: reveal must not refire on every draw -----------
   revealSections used to call revealOnIntersect unconditionally for every
   category past the first on every draw(), including redraws triggered by
   search keystrokes and persona-chip clicks. A freshly rebuilt heading that
   was already on screen got handed a brand new IntersectionObserver, which
   fired immediately and re-ran the entrance (opacity 1 -> 0 -> back to 1)
   on every keystroke. This reproduces that scenario directly: scroll a
   below-fold section into view, type into search, and poll the heading's
   opacity through the window a re-fired transition would occupy. */
const categoryOrder = [];
for (const t of active) { if (!categoryOrder.includes(t.category)) categoryOrder.push(t.category); }
const targetCategory = categoryOrder[1] ?? categoryOrder[0];

const noRefirePage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await noRefirePage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await noRefirePage.goto(`${base}/`);
await noRefirePage.waitForSelector('#public-root .tool-card');
await noRefirePage.locator('.cli-category', { hasText: targetCategory }).first().scrollIntoViewIfNeeded();
await noRefirePage.waitForTimeout(500); // let its own once-only, intended reveal finish
const opacityBeforeTyping = await noRefirePage.locator('.cli-category', { hasText: targetCategory }).first()
  .evaluate((n) => getComputedStyle(n).opacity);
check('regression: below-fold section fully visible before typing (sanity)', opacityBeforeTyping === '1', opacityBeforeTyping);

// The search term must be broad, deliberately. Typing the category's own
// name collapses the list to that single section, which becomes the FIRST
// section of the redraw, and the original bug lived only in the non-first
// branch: the focused re-verify proved a full-name variant of this check
// passed on the buggy code. A single common letter keeps many categories
// in the result set, so the watched heading stays a non-first section.
await noRefirePage.locator('#public-root input[type=search]').pressSequentially('a', { delay: 20 });
let minOpacitySeen = 1;
const pollUntil = Date.now() + 400;
while (Date.now() < pollUntil) {
  const heading = noRefirePage.locator('.cli-category', { hasText: targetCategory }).first();
  if (await heading.count()) {
    const opacityNow = Number(await heading.evaluate((n) => getComputedStyle(n).opacity));
    minOpacitySeen = Math.min(minOpacitySeen, opacityNow);
  }
  await noRefirePage.waitForTimeout(20);
}
check('homepage: typing into search never dips a visible non-first section below opacity 1',
  minOpacitySeen >= 0.99, `min=${minOpacitySeen} category="${targetCategory}"`);

// Same assertion for the persona-chip redraw path, which the original check
// set did not cover at all: toggling a pack on and off rebuilds the list
// both times, and the returning sections must render fully visible.
await noRefirePage.locator('#public-root input[type=search]').fill('');
await noRefirePage.waitForTimeout(200);
const chip = noRefirePage.locator('.pub-persona-chip-row button').first();
let minOpacityChip = 1;
if (await chip.count()) {
  await chip.click();
  await noRefirePage.waitForTimeout(150);
  await chip.click(); // clear the pack: the full list DOM is rebuilt again
  const chipPollUntil = Date.now() + 400;
  while (Date.now() < chipPollUntil) {
    const heading = noRefirePage.locator('.cli-category', { hasText: targetCategory }).first();
    if (await heading.count()) {
      const opacityNow = Number(await heading.evaluate((n) => getComputedStyle(n).opacity));
      minOpacityChip = Math.min(minOpacityChip, opacityNow);
    }
    await noRefirePage.waitForTimeout(20);
  }
}
check('homepage: persona-chip toggle never dips a rebuilt section below opacity 1',
  minOpacityChip >= 0.99, `min=${minOpacityChip}`);
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
await reducedMotionPage.close();

/* --- Phase 12.2: Discover deck engine (PRD section 17) ---------------------
   js/discover.js is dynamically imported by the Discover entry path's click
   handler (js/public.js), so every check below opens the deck the same way
   a reader would: click [data-discover-entry], wait for the first card. The
   default seed deals unjudged core tools first (data/tools.json's first
   core id is 0), which is what the tool-0 checks below rely on rather than
   any special-cased test hook. */
async function openDiscoverDeck(pg) {
  await pg.goto(`${base}/`);
  await pg.waitForSelector('#public-root .tool-card');
  await pg.locator('[data-discover-entry]').click();
  await pg.waitForSelector('.discover-card');
}
async function clearDiscoverStorage(pg) {
  await pg.evaluate(() => localStorage.removeItem('freestack:v1:discover'));
}

const discoverPage = await browser.newPage();
await discoverPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await openDiscoverDeck(discoverPage);
await clearDiscoverStorage(discoverPage);
await discoverPage.reload();
await discoverPage.waitForSelector('#public-root .tool-card');
await discoverPage.locator('[data-discover-entry]').click();
await discoverPage.waitForSelector('.discover-card');

const firstDealtId = await discoverPage.locator('.discover-card').getAttribute('data-id');
await discoverPage.locator('.discover-panel').press('ArrowLeft'); // keyboard: got it
await discoverPage.waitForTimeout(400);
const decisionsAfterKeyboard = await discoverPage.evaluate(() => JSON.parse(localStorage.getItem('freestack:v1:discover')).decisions);
check('discover: keyboard-judged tool 0 recorded as have',
  firstDealtId === '0' && decisionsAfterKeyboard['0']?.d === 'have', `firstDealtId=${firstDealtId} decisions=${JSON.stringify(decisionsAfterKeyboard)}`);

await discoverPage.reload();
await discoverPage.waitForSelector('#public-root .tool-card');
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
await dragPage.waitForSelector('#public-root .tool-card');
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
await dragPage.close();

// Escape restores focus to the opener button.
const escPage = await browser.newPage();
await escPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await escPage.goto(`${base}/`);
await escPage.waitForSelector('#public-root .tool-card');
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
await handoffPage.waitForSelector('#public-root .tool-card');
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
await blockedPage.waitForSelector('#public-root .tool-card');
await blockedPage.locator('[data-discover-entry]').click();
await blockedPage.waitForSelector('.discover-card');
check('discover: blocked localStorage still deals a card', (await blockedPage.locator('.discover-card').count()) === 1);
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
await doubleJudgePage.waitForSelector('#public-root .tool-card');
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
const darkSet = await page.evaluate(() => document.documentElement.dataset.theme);
await page.reload();
await page.waitForSelector('.tools-table');
const darkPersists = await page.evaluate(() => document.documentElement.dataset.theme);
check('curator: theme toggle flips to dark and persists across reload', darkSet === 'dark' && darkPersists === 'dark');
await page.locator('.theme-toggle').first().click(); // restore light for later checks
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
function extractInlineScripts(html) {
  const scripts = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (/\bsrc\s*=/i.test(m[1])) continue; // external scripts carry no inline body to hash
    scripts.push(m[2]);
  }
  return scripts;
}
function sha256Base64(text) {
  return createHash('sha256').update(text, 'utf8').digest('base64');
}
const embedHtml = (await readFile(join(ROOT, 'embed.html'))).toString('utf8');
const whyRegisterHtml = (await readFile(join(ROOT, 'why-register.html'))).toString('utf8');
const netlifyToml = (await readFile(join(ROOT, 'netlify.toml'))).toString('utf8');

const indexInline = extractInlineScripts(rawHtml);
const embedInline = extractInlineScripts(embedHtml);
const whyInline = extractInlineScripts(whyRegisterHtml);
const currentHashes = new Set([...indexInline, ...embedInline, ...whyInline].map(sha256Base64));

const cspScriptSrcLine = netlifyToml.split('\n').find((l) => l.includes('Content-Security-Policy') && l.includes('script-src'));
const cspHashes = new Set([...(cspScriptSrcLine || '').matchAll(/'sha256-([A-Za-z0-9+/]+=*)'/g)].map((m) => m[1]));

const missingFromCsp = [...currentHashes].filter((h) => !cspHashes.has(h));
const staleInCsp = [...cspHashes].filter((h) => !currentHashes.has(h));
check('csp: every inline boot script hash is allow-listed in netlify.toml', missingFromCsp.length === 0, `missing=${missingFromCsp.join(',')}`);
check('csp: no stale hash in netlify.toml matching no current script', staleInCsp.length === 0, `stale=${staleInCsp.join(',')}`);
check('csp: why-register.html boot script is byte identical to index.html',
  indexInline.length === 1 && whyInline.length === 1 && sha256Base64(indexInline[0]) === sha256Base64(whyInline[0]));

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

await myFlow.close();
await myCtx.close();

check('no page errors across all loads', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));

await browser.close();
server.close();
console.log(failures.length ? `\n${failures.length} FAILURES` : '\nALL PASS');
process.exit(failures.length ? 1 : 0);
