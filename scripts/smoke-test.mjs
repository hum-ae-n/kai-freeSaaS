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
    res.writeHead(404); res.end('not found');
  }
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
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

/* --- curator mode -------------------------------------------------------- */
await page.goto(`${base}/`);
await page.waitForSelector('.tools-table');
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

await page.goto(`${base}/`);
await page.waitForSelector('.tools-table');
check('curator: no robots meta injected', await page.locator('meta[name=robots]').count() === 0);
check('curator: trust line present', (await page.locator('.trust-line').textContent()).includes('No affiliates'));

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
await page.goto(`${base}/`);
await page.waitForSelector('.tools-table');
check('curator: archived tool excluded from table', await page.locator('.tools-table tbody tr').count() === active.length - 1);
await page.goto(`${base}/?t=0,2`);
await page.waitForSelector('.tool-card');
check('client: archived tool renders retirement card, not silence',
  await page.locator('.tool-card-archived').count() === 1
  && (await page.locator('.tool-card-archived').textContent()).includes('No longer recommended'));
archiveIds = null;

check('no page errors across all loads', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));

await browser.close();
server.close();
console.log(failures.length ? `\n${failures.length} FAILURES` : '\nALL PASS');
process.exit(failures.length ? 1 : 0);
