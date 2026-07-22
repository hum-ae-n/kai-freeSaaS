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

const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const file = normalize(join(ROOT, path === '/' ? 'index.html' : path));
  try {
    const body = await readFile(file);
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

const browser = await chromium.launch();
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/net::|Failed to load resource/.test(m.text())) pageErrors.push(m.text()); });
await page.route(/^(?!.*localhost).*$/, (route) => route.abort());

/* --- curator mode -------------------------------------------------------- */
await page.goto(`${base}/`);
await page.waitForSelector('.tools-table');
check('curator: 85 rows', await page.locator('.tools-table tbody tr').count() === 85);
check('curator: 15 core pre-checked', await page.locator('tbody input[type=checkbox]:checked').count() === 15);
check('curator: category dropdown has 15 + All', await page.locator('select >> nth=1 >> option').count() === 16);

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
check('client: 15 cards for 15 core tools', await page.locator('.tool-card').count() === 15);
check('client: prepared-for shows name', (await page.locator('.prepared-for').textContent()).includes('Acme Ltd'));
check('client: summary shows count', (await page.locator('.cli-summary').textContent()).includes('15'));
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

check('no page errors across all loads', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));

await browser.close();
server.close();
console.log(failures.length ? `\n${failures.length} FAILURES` : '\nALL PASS');
process.exit(failures.length ? 1 : 0);
