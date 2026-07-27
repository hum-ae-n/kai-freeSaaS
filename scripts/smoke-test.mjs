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
await seedCoachDoneBeforeLoad(escPage); // otherwise the first Escape only dismisses the coach
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
const scrollRacePage = await browser.newPage({ viewport: { width: 375, height: 812 } });
await scrollRacePage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await seedCoachDoneBeforeLoad(scrollRacePage); // otherwise the zero-delay click only dismisses the coach
await scrollRacePage.goto(`${base}/`, { waitUntil: 'load' });
await scrollRacePage.waitForSelector('#public-root .tool-card');
await scrollRacePage.locator('[data-discover-entry]').click();
await scrollRacePage.waitForSelector('.discover-card');
await scrollRacePage.locator('.discover-btn-have').click(); // zero delay: the reproduced race window
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
  await pg.waitForSelector('#public-root .tool-card');
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
await coachFirstPage.waitForSelector('#public-root .tool-card');
await coachFirstPage.evaluate(() => localStorage.removeItem('freestack:v1:discover')); // genuinely first-ever
await coachFirstPage.reload();
await coachFirstPage.waitForSelector('#public-root .tool-card');
await coachFirstPage.locator('[data-discover-entry]').click();
await coachFirstPage.waitForSelector('.discover-card');
check('discover: the coach overlay appears on a genuinely first-ever deck open',
  (await coachFirstPage.locator('.discover-coach').count()) === 1);
check('discover: judge buttons are disabled while the coach overlay is up',
  await coachFirstPage.locator('.discover-btn-have').isDisabled());

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
await coachJudgedPage.waitForSelector('#public-root .tool-card');
await coachJudgedPage.evaluate(() => localStorage.setItem('freestack:v1:discover', JSON.stringify({
  v: 1, lastVisit: new Date().toISOString(), seenIds: [0], decisions: { 0: { d: 'have', t: Date.now() } },
})));
await coachJudgedPage.reload();
await coachJudgedPage.waitForSelector('#public-root .tool-card');
await coachJudgedPage.locator('[data-discover-entry]').click();
await coachJudgedPage.waitForSelector('.discover-card');
check('discover: the coach overlay does not appear once any judgement already exists',
  (await coachJudgedPage.locator('.discover-coach').count()) === 0);
await coachJudgedPage.close();

// Auto-dismiss within roughly 6 seconds, no interaction at all.
const coachTimeoutPage = await browser.newPage({ viewport: { width: 375, height: 812 } });
await coachTimeoutPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await coachTimeoutPage.goto(`${base}/`);
await coachTimeoutPage.waitForSelector('#public-root .tool-card');
await coachTimeoutPage.evaluate(() => localStorage.removeItem('freestack:v1:discover'));
await coachTimeoutPage.reload();
await coachTimeoutPage.waitForSelector('#public-root .tool-card');
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
await parityPage.waitForSelector('#public-root .tool-card');
await parityPage.locator('[data-discover-entry]').click();
await parityPage.waitForSelector('.discover-card');
const parityFirstId = await parityPage.locator('.discover-card').getAttribute('data-id');
await parityPage.locator('.discover-panel').press('ArrowLeft'); // have
await parityPage.waitForTimeout(400);
await parityPage.locator('.discover-close').click();
await parityPage.waitForTimeout(300); // let the judgement-parity bootstrap import/decorate settle

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
await finePage.waitForSelector('#public-root .tool-card');
await finePage.evaluate(() => localStorage.removeItem('freestack:v1:discover'));
await finePage.reload();
await finePage.waitForSelector('#public-root .tool-card');
await finePage.waitForTimeout(400); // let the discover.js dynamic import resolve
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
await coarsePage.waitForSelector('#public-root .tool-card');
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
await parity375.waitForSelector('#public-root .tool-card');
await parity375.locator('[data-discover-entry]').click();
await parity375.waitForSelector('.discover-card');
await parity375.locator('.discover-panel').press('ArrowLeft');
await parity375.waitForTimeout(400);
await parity375.locator('.discover-close').click();
await parity375.waitForTimeout(300);
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

// Reveal-once law extended to this redraw path: opening or acting on the
// chooser must never dip an already-settled, below-fold section's opacity,
// the same regression class 12.1's fix round hardened for search/persona
// redraws.
const parityRevealPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await parityRevealPage.route(/^(?!.*localhost).*$/, (route) => route.abort());
await openDiscoverDeck(parityRevealPage);
await clearDiscoverStorage(parityRevealPage);
await parityRevealPage.reload();
await parityRevealPage.waitForSelector('#public-root .tool-card');
await parityRevealPage.waitForTimeout(700); // let the first-screen entrance reveal finish
await parityRevealPage.locator('[data-discover-entry]').click();
await parityRevealPage.waitForSelector('.discover-card');
await parityRevealPage.locator('.discover-panel').press('ArrowLeft');
await parityRevealPage.waitForTimeout(400);
await parityRevealPage.locator('.discover-close').click();
await parityRevealPage.waitForTimeout(300);
const parityCategoryOrder = [];
for (const t of active) { if (!parityCategoryOrder.includes(t.category)) parityCategoryOrder.push(t.category); }
const parityTargetCategory = parityCategoryOrder[1] ?? parityCategoryOrder[0];
const parityHeading = parityRevealPage.locator('.cli-category', { hasText: parityTargetCategory }).first();
await parityHeading.scrollIntoViewIfNeeded();
await parityRevealPage.waitForTimeout(400);
const parityToolNameForReveal = await toolNameFor(parityRevealPage, '0');
const parityRevealCard = browseCardFor(parityRevealPage, parityToolNameForReveal);
await parityRevealCard.scrollIntoViewIfNeeded();
await parityRevealCard.locator('.pub-judge-chip').click();
let parityMinOpacity = 1;
const parityPollUntil = Date.now() + 500;
while (Date.now() < parityPollUntil) {
  if (await parityHeading.count()) {
    const op = Number(await parityHeading.evaluate((n) => getComputedStyle(n).opacity));
    parityMinOpacity = Math.min(parityMinOpacity, op);
  }
  await parityRevealPage.waitForTimeout(20);
}
await parityRevealCard.locator('.pub-judge-chooser button', { hasText: 'Clear' }).click();
const parityPollUntil2 = Date.now() + 500;
while (Date.now() < parityPollUntil2) {
  if (await parityHeading.count()) {
    const op = Number(await parityHeading.evaluate((n) => getComputedStyle(n).opacity));
    parityMinOpacity = Math.min(parityMinOpacity, op);
  }
  await parityRevealPage.waitForTimeout(20);
}
check('parity: opening and acting on the chooser never dips a settled section below opacity 1',
  parityMinOpacity >= 0.99, `min=${parityMinOpacity} category="${parityTargetCategory}"`);
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
await countsPage.waitForSelector('#public-root .tool-card');
await countsPage.locator('[data-discover-entry]').click();
await countsPage.waitForSelector('.discover-card');
let countsGuard = 0;
while ((await countsPage.locator('.discover-completion').count()) === 0 && countsGuard < 14) {
  await countsPage.locator('.discover-panel').press(countsGuard % 2 === 0 ? 'ArrowLeft' : 'ArrowRight');
  await countsPage.waitForTimeout(300);
  countsGuard++;
}
await countsPage.waitForSelector('.discover-completion');
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
await keyboardPage.waitForSelector('#public-root .tool-card');
await keyboardPage.locator('[data-discover-entry]').click();
await keyboardPage.waitForSelector('.discover-card');
await keyboardPage.locator('.discover-panel').press('ArrowLeft');
await keyboardPage.waitForTimeout(400);
await keyboardPage.locator('.discover-close').click();
await keyboardPage.waitForTimeout(300);
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
await outsideClickPage.waitForSelector('#public-root .tool-card');
await outsideClickPage.locator('[data-discover-entry]').click();
await outsideClickPage.waitForSelector('.discover-card');
await outsideClickPage.locator('.discover-panel').press('ArrowLeft');
await outsideClickPage.waitForTimeout(400);
await outsideClickPage.locator('.discover-close').click();
await outsideClickPage.waitForTimeout(300);
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
await escapeFromChipPage.waitForSelector('#public-root .tool-card');
await escapeFromChipPage.locator('[data-discover-entry]').click();
await escapeFromChipPage.waitForSelector('.discover-card');
await escapeFromChipPage.locator('.discover-panel').press('ArrowLeft');
await escapeFromChipPage.waitForTimeout(400);
await escapeFromChipPage.locator('.discover-close').click();
await escapeFromChipPage.waitForTimeout(300);
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
await railOverlapPage.waitForSelector('#public-root .tool-card');
await railOverlapPage.waitForTimeout(400); // let discover.js resolve so the rail actually renders
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
  await widthPage.waitForSelector('#public-root .tool-card');
  await widthPage.waitForTimeout(400); // settled load
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
await resizePage.waitForSelector('#public-root .tool-card');
await resizePage.waitForTimeout(400);
await resizePage.setViewportSize({ width: 1280, height: 900 });
await resizePage.waitForTimeout(150);
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
await discoverBlockedPage.waitForSelector('#public-root .tool-card');
await discoverBlockedPage.waitForTimeout(500); // give the aborted dynamic import time to settle
check('parity: with js/discover.js blocked, every active card still renders',
  await discoverBlockedPage.locator('#public-root .tool-card').count() === active.length);
check('parity: with js/discover.js blocked, no judgement chips render (nothing to read a decision from)',
  await discoverBlockedPage.locator('.pub-judge-chip').count() === 0);
check('parity: with js/discover.js blocked, no page/console errors', discoverBlockedErrors.length === 0, discoverBlockedErrors.join(' | ').slice(0, 300));
await discoverBlockedPage.close();

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
