#!/usr/bin/env node
/**
 * build-seo.mjs: the Answer Engine and Search Visibility generator (PRD
 * section 18). Dev-time Node, same category as validate-data.mjs and
 * register-vectors.mjs, permitted under the scripts/ exception to the
 * no-Node law (CLAUDE.md). Run: node scripts/build-seo.mjs
 *
 * Reads data/tools.json, data/presets.json (imported for parity with the
 * rest of the generator family; not currently consumed by any emitted
 * artefact, kept as a read for forward compatibility with a future
 * persona-aware crawler block) and data/category-intros.json, and emits or
 * refreshes:
 *   - the static crawler content block in index.html, between
 *     <!-- seo-static:start --> / <!-- seo-static:end --> markers inside
 *     <div id="static-root">
 *   - the title tag and meta description in index.html
 *   - Organization/WebSite/ItemList JSON-LD in index.html's <head>, between
 *     <!-- seo-jsonld:start --> / <!-- seo-jsonld:end --> markers
 *   - faq.html (static, indexable, the ten canonical Q&As plus FAQPage
 *     JSON-LD)
 *   - sitemap.xml
 *   - llms.txt
 *
 * Determinism: no timestamps, no randomness, no reliance on file mtimes or
 * process.env. Every date that appears anywhere in the output comes from a
 * tool's own `last_verified` field or is omitted outright, so running this
 * script twice against the same data/*.json produces byte-identical files.
 * This is what lets CI's drift gate (.github/workflows/ci.yml) simply diff
 * the committed artefacts against a fresh run.
 *
 * Security (PRD section 7, extended to dev-time generation by section 18):
 * every string sourced from data/tools.json or data/category-intros.json is
 * untrusted content written by a non-developer curator, so every one of them
 * is HTML-escaped before being written into a static file. This script is
 * not the el()/textContent runtime discipline (there is no DOM at generation
 * time), but the same threat model applies: an unescaped `<` or `&` in a
 * tool's description would corrupt the page for every visitor, JS or not.
 *
 * ID discipline (PRD section 4): every place below that touches a tool's id
 * interpolates it into a string or a Set/Map key, never tests it as a
 * boolean. Number.isInteger is used wherever an id needs validating, never
 * `if (tool.id)`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE_URL = 'https://tools.airl.io';

/* --- shared helpers -------------------------------------------------------- */

/** HTML-escape any string interpolated into generated markup. Every field
    read from data/tools.json or data/category-intros.json passes through
    this before it reaches a template string. */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** JSON-LD is embedded inside a <script type="application/ld+json"> element,
    so a literal "</script>" inside a string value (a tool description could
    plausibly contain "</" in prose, however unlikely) would terminate the
    tag early. Escaping the forward slash after "<" is the standard mitigation
    and does not change the parsed JSON value. */
function jsonLdScript(data) {
  const json = JSON.stringify(data, null, 2).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">\n${json}\n</script>`;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replaces the content between two marker comments, or inserts a brand new
    marker-delimited block via `insert` when the markers are not present yet
    (first run). `insert` receives the current html and the full
    marker-wrapped block and returns the new html. */
function upsertBetweenMarkers(html, startMarker, endMarker, innerHtml, insert) {
  const block = `${startMarker}\n${innerHtml}\n${endMarker}`;
  const markerRe = new RegExp(`${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}`);
  // Function-form replacement throughout this file, never a bare string: a
  // tool description or free_limit sentence containing a literal "$" (a
  // dollar price, "$10 million") would otherwise be reinterpreted by
  // String.replace's special patterns ($1, $&, $`, $', $$) when passed as a
  // plain string replacement, corrupting the output. A function's return
  // value is inserted verbatim with no such reinterpretation.
  if (markerRe.test(html)) return html.replace(markerRe, () => block);
  return insert(html, block);
}

/** Category name to a URL-safe fragment, identical to js/public.js's own
    slugify: lower-cased, non-alphanumerics collapsed to a single hyphen,
    trimmed. Kept as a separate copy rather than an import because this
    script runs under Node with no bundler and js/public.js is a browser ES
    module with browser-only imports; duplicating four lines of pure string
    logic is cheaper and safer than reaching across that boundary. */
function slugify(text) {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Groups tools by category, first-appearance order preserved. Mirrors
    js/public.js's groupByCategory so the static block's category order
    matches the rendered app's shelf order. */
function groupByCategory(list) {
  const map = new Map();
  for (const tool of list) {
    if (!map.has(tool.category)) map.set(tool.category, []);
    map.get(tool.category).push(tool);
  }
  return map;
}

/* --- per-tool question and answer (PRD section 18, "Per-tool questions") --
   Derived mechanically from existing fields, never hand-maintained: the
   question from the tool's name, the answer assembled from free_limit
   (verbatim where present), description, paid_from and up to two
   alternatives by name. A tool without free_limit gets the description-led
   variant. Nothing here invents a claim absent from the source fields. */
function deriveQuestion(tool) {
  // Grouped names ("Claude Free / ChatGPT Free / Gemini") read oddly with a
  // singular "Is": the sensible variant is a plural "Are".
  return tool.name.includes(' / ')
    ? `Are ${tool.name} free for a small business?`
    : `Is ${tool.name} actually free for a small business?`;
}

function deriveAnswer(tool) {
  const parts = [];
  // free_limit is already an honest, human-written sentence about exactly
  // where the free tier stops; used verbatim, never paraphrased, per the
  // section 4 honesty bar it shares with `value`. Section 18 lists free_limit
  // and description as two separate ingredients the answer is "assembled
  // from", not an either/or choice, so both are included when free_limit
  // exists (this is also what keeps answers in the spec's 40-80 word range;
  // free_limit alone skews short). "A tool without free_limit gets the
  // description-led variant" describes what is left when there is no
  // free_limit sentence to lead with, not a rule against using both.
  if (tool.free_limit) {
    parts.push(tool.free_limit);
    parts.push(tool.description);
  } else {
    parts.push(tool.description);
  }

  // paid_from is optional; Number.isInteger, never a truthiness test, since
  // 0 (genuinely free forever, nothing to outgrow) is a meaningful value.
  if (Number.isInteger(tool.paid_from)) {
    parts.push(tool.paid_from === 0
      ? 'There is no paid tier to outgrow.'
      : `Paid plans start from £${tool.paid_from} a month.`);
  }

  const altNames = (tool.alternatives ?? [])
    .filter((a) => a?.name && a?.url)
    .slice(0, 2)
    .map((a) => a.name);
  if (altNames.length === 1) parts.push(`An alternative is ${altNames[0]}.`);
  else if (altNames.length > 1) parts.push(`Alternatives include ${altNames.join(' and ')}.`);

  return parts.join(' ');
}

/* --- static crawler content block (PRD section 18) ------------------------- */

function buildToolEntryHtml(tool) {
  const question = deriveQuestion(tool);
  const answer = deriveAnswer(tool);
  const links = (tool.urls ?? [])
    .map((u) => `<a href="https://${escapeHtml(u.domain)}">${escapeHtml(u.label)}</a>`)
    .join(', ');
  const freeLimitLine = tool.free_limit
    ? `      <p><strong>Free tier:</strong> ${escapeHtml(tool.free_limit)}</p>\n`
    : '';
  // "seo-tool-", the same disjoint-ID-space reasoning as the category
  // section id just below: nothing currently uses a bare "tool-<id>" id, but
  // keeping every id this generator writes in its own namespace means a
  // future app-side id never has to check the static block for a clash.
  return (
    `    <li id="seo-tool-${tool.id}">\n`
    + `      <h4>${escapeHtml(tool.name)}</h4>\n`
    + `      <p>${escapeHtml(tool.description)}</p>\n`
    + freeLimitLine
    + `      <h5>${escapeHtml(question)}</h5>\n`
    + `      <p>${escapeHtml(answer)}</p>\n`
    + `      <p>Links: ${links}</p>\n`
    + `    </li>`
  );
}

function buildCategorySectionHtml(category, toolsInCategory, intros) {
  const slug = slugify(category);
  const intro = intros[category];
  const introHtml = intro
    ? `    <p>${escapeHtml(intro)}</p>\n`
    : '';
  const entries = toolsInCategory.map(buildToolEntryHtml).join('\n');
  // "seo-cat-", not "cat-": js/public.js gives each live shelf <section> the
  // id `cat-${slug}` for the #cat-<slug> deep link (PRD section 16). Reusing
  // that id here would collide once the app boots and both sections sit in
  // the same document (the static block is hidden, not removed), so
  // document.getElementById('cat-<slug>') would resolve to whichever section
  // happens to come first in source order rather than the live shelf,
  // breaking the deep link silently. A distinct prefix keeps the two ID
  // spaces disjoint for as long as #static-root remains in the DOM.
  return (
    `  <section id="seo-cat-${slug}">\n`
    + `    <h2>${escapeHtml(category)}</h2>\n`
    + introHtml
    + `    <ul>\n${entries}\n    </ul>\n`
    + `  </section>`
  );
}

function buildStaticBlockHtml(active, intros) {
  const grouped = groupByCategory(active);
  const sections = [...grouped.entries()]
    .map(([category, toolsInCategory]) => buildCategorySectionHtml(category, toolsInCategory, intros))
    .join('\n');

  const heroHtml = (
    '  <header>\n'
    + '    <p class="eyebrow">Free Stack</p>\n'
    + '    <h1>Curated free software for small business</h1>\n'
    + `    <p>${active.length} free tool${active.length === 1 ? '' : 's'} in the directory.</p>\n`
    + '    <p>No affiliates, no sponsors, no paid placement.</p>\n'
    + '    <p>Curated by <a href="https://kaipability.com">Kaipability Ltd</a>.</p>\n'
    + '  </header>'
  );

  const faqLinkHtml = '  <p><a href="/faq.html">Frequently asked questions</a></p>';

  return `${heroHtml}\n${sections}\n${faqLinkHtml}`;
}

/* --- title, meta description and JSON-LD (PRD section 18) ------------------ */

function buildTitle(count) {
  return `Free software for UK small businesses: ${count} curated tools | Free Stack by Kaipability`;
}

function buildMetaDescription(count) {
  return `A free, curated directory of ${count} genuinely free software tools for UK small businesses: accounting, CRM, design, marketing and security. No affiliate links, no sponsors. Every tool lists its real free-tier limits and alternatives.`;
}

function buildJsonLdBlock(active) {
  const organization = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Kaipability Ltd',
    url: 'https://kaipability.com',
    logo: `${SITE_URL}/design-system/assets/kaipability-logo-lockup.png`,
  };
  const website = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Free Stack',
    url: `${SITE_URL}/`,
    publisher: { '@type': 'Organization', name: 'Kaipability Ltd' },
  };
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: active.map((tool, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: {
        '@type': 'SoftwareApplication',
        name: tool.name,
        description: tool.description,
        url: tool.urls?.[0]?.domain ? `https://${tool.urls[0].domain}` : undefined,
      },
    })),
  };
  return [organization, website, itemList].map(jsonLdScript).join('\n');
}

/* --- faq.html (PRD section 18) ---------------------------------------------
   The ten canonical Q&As, quoted verbatim from PRD.md section 18. The
   question text below strips the "Q1." style numbering, which is document
   formatting, not part of the question itself; every word of the question
   and answer text is otherwise unchanged. */
const FAQ_ITEMS = [
  {
    question: 'What software stack is free for a new founder?',
    answer: "A genuinely free day-one stack: a free AI assistant (Claude, ChatGPT or Gemini), Canva Free for design, Unsplash or Pexels for images, Google Business Profile so customers can find you, WhatsApp Business for customer contact, Bitwarden Free as a password manager and Google Drive for files. All are free tiers with published limits, not trials. This directory lists each one with its real limits and alternatives.",
  },
  {
    question: 'What is the best free accounting software for a UK small business?',
    answer: "Two credible options. Wave Accounting is free indefinitely for invoicing and manual bookkeeping, though automatic bank feeds sit in its paid tier. FreeAgent, a full UK accounting package, is free while you hold an active Mettle or NatWest business account. Which suits you depends on your bank; both are listed here with their exact free-tier edges.",
  },
  {
    question: 'How much would this software cost if I paid for it?',
    answer: "The 89 active tools in this directory represent roughly £11,600 a year in commercial-equivalent value. That figure is deliberately conservative: it is what you would pay a commercial provider for the same capability, never the tool's own paid-tier price, and never inflated. Every tool shows its individual value and a last-verified date so you can challenge the numbers.",
  },
  {
    question: 'Is there a free CRM good enough for a small business?',
    answer: "Yes. HubSpot CRM Free supports up to 2 users and around 1,000 contacts, free forever, with HubSpot branding on some assets. Zoho's free ecosystem gives a CRM for up to 3 users plus free booking, invoicing and forms tools. Both limits are real edges you should know before committing, and both entries here list alternatives.",
  },
  {
    question: 'What free email marketing tools actually work?',
    answer: "MailerLite Free gives 250 subscribers and 2,500 emails a month, the most generous mainstream free tier. Mailchimp Free allows 250 contacts and 500 emails a month, and Brevo takes a different approach with daily send limits. For a small list, any of the three does the job; the caps above are where each one starts charging.",
  },
  {
    question: 'What can I use instead of Photoshop for free?',
    answer: "GIMP is free, open source and permanently free with no paid tier. Photopea runs a Photoshop-like editor in the browser, free with ads, and opens PSD files. For template-based design rather than photo editing, Canva Free and Adobe Express Free cover most small-business needs. None of these is a trial; all are listed here with their limits.",
  },
  {
    question: 'Do these free tools stay free, or is there a catch?',
    answer: "Every entry states in plain English what the free tier genuinely includes and exactly where it stops: the user limit, the storage cap or the feature gate. Each tool carries a last-verified date. When a tool stops being free or stops being good, it is archived and marked as no longer recommended, pointing at its alternatives, never silently deleted.",
  },
  {
    question: 'Does this directory earn commission on the tools it lists?',
    answer: "No. There are no affiliate links, no sponsorships and no paid placements anywhere in this directory. Every link pays Kaipability nothing when you click it or sign up, and removing a tool costs nothing either. Tools are listed on merit, used on real client work, and every one carries at least two alternatives so you are never funnelled to a single vendor.",
  },
  {
    question: 'What free tools help a local shop get found online?',
    answer: "Start with Google Business Profile, free forever and the single biggest factor in local search visibility. Add Bing Places for Business, Meta Business Suite for managing Facebook and Instagram, and WhatsApp Business for customer messaging. All four are permanently free products, not trials, and each is listed here with setup training links.",
  },
  {
    question: 'What free security tools should a small business start with?',
    answer: "Bitwarden Free gives unlimited passwords across unlimited devices, including a free two-person sharing option. Have I Been Pwned checks whether your email addresses appear in known data breaches, free for individual lookups. Google Password Checkup flags reused or compromised passwords at no cost. These three cover the basics before you spend anything on security.",
  },
];

/* Byte-identical to index.html's, per netlify.toml's comment: kept identical
   on purpose so the CSP script-src hash already allow-listed for index.html
   covers this page too, without a third hash entry. Do not edit without
   also updating index.html and netlify.toml in the same commit. */
const THEME_BOOT_SCRIPT = `  <script>
    try {
      var t = localStorage.getItem('freestack:v1:theme');
      if (t !== 'light' && t !== 'dark') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', t);
    } catch (e) {}
  </script>`;

function buildFaqHtml() {
  const itemsHtml = FAQ_ITEMS.map(({ question, answer }) => (
    '    <article class="faq-item">\n'
    + `      <h2>${escapeHtml(question)}</h2>\n`
    + `      <p>${escapeHtml(answer)}</p>\n`
    + '    </article>'
  )).join('\n');

  const faqPageJsonLd = jsonLdScript({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_ITEMS.map(({ question, answer }) => ({
      '@type': 'Question',
      name: question,
      acceptedAnswer: { '@type': 'Answer', text: answer },
    })),
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Frequently asked questions · Free Stack by Kaipability</title>
  <meta name="description" content="Answers to the questions people and AI assistants ask most about free software for UK small businesses: cost, CRM, accounting, security and whether the free tiers stay free.">
  <link rel="canonical" href="${SITE_URL}/faq.html">
  <link rel="icon" type="image/png" href="design-system/assets/kaipability-mark.png">

  <!-- No-flash-of-wrong-theme boot script, byte-identical to index.html's:
       kept identical on purpose so the CSP script-src hash already
       allow-listed for index.html's boot script covers this page too,
       without a second hash entry in netlify.toml (why-register.html does
       the same). If this ever needs to diverge from index.html's copy, it
       must get its own hash there. -->
${THEME_BOOT_SCRIPT}
  <link rel="stylesheet" href="css/styles.css">

  <!-- Page-specific layout only: colours, type and spacing tokens all come
       from design-system/colors_and_type.css via css/styles.css, unedited
       by this generator. style-src already allows 'unsafe-inline' in
       netlify.toml's CSP (PRD-REGISTER section 10), so this inline block
       needs no hash entry and changes the CSP value not at all. -->
  <style>
    .faq-wrap { max-width: var(--content-max); margin: 0 auto; padding: var(--s-8) var(--s-6) var(--s-24); }
    .faq-back { font-size: var(--fs-14); display: inline-block; margin-bottom: var(--s-6); }
    .faq-header { padding: var(--s-8) var(--s-6); margin-bottom: var(--s-10); }
    .faq-header .logo { height: 32px; width: auto; margin-bottom: var(--s-6); display: block; }
    .faq-items { display: flex; flex-direction: column; gap: var(--s-10); max-width: var(--measure); }
    .faq-item h2 { font-size: var(--fs-34); line-height: var(--lh-34); margin-bottom: var(--s-3); }
    .faq-footer { display: flex; align-items: center; gap: var(--s-4); flex-wrap: wrap; padding-top: var(--s-8); margin-top: var(--s-16); border-top: var(--border); }
    .faq-footer .logo { height: 26px; width: auto; }
  </style>
</head>
<body>
  <noscript>
    <div class="app-message">This page needs no JavaScript to read, but the theme toggle and site chrome need it enabled.</div>
  </noscript>

  <div class="faq-wrap">
    <a class="faq-back" href="/">&larr; Free Stack</a>
    <header class="panel faq-header">
      <img class="logo" src="design-system/assets/kaipability-logo-lockup.png" alt="Kaipability">
      <p class="eyebrow">Free Stack</p>
      <h1>Frequently asked questions</h1>
      <p class="t-lede">What people, and the AI assistants they ask, want to know about free software for UK small businesses.</p>
    </header>
    <div class="faq-items">
${itemsHtml}
    </div>
    <footer class="faq-footer">
      <img class="logo" src="design-system/assets/kaipability-logo-lockup.png" alt="">
      <span class="t-meta">Curated by Kaipability Ltd. No affiliate links, no sponsored placements.</span>
    </footer>
  </div>

${faqPageJsonLd}
</body>
</html>
`;
}

/* --- sitemap.xml (PRD section 18) -------------------------------------------
   Lists only /, /faq.html and (once published) /how-we-choose.html.
   docs/how-we-choose.md exists but has not received Rocky's copy sign-off
   (BUILD-PLAN 14.3's conditional clause), so it ships without a sitemap
   entry until that sign-off lands; see TODO.md for the tracked gap. */
function buildSitemapXml() {
  const urls = [`${SITE_URL}/`, `${SITE_URL}/faq.html`];
  const entries = urls.map((u) => `  <url>\n    <loc>${escapeHtml(u)}</loc>\n  </url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

/* --- llms.txt (PRD section 18) ---------------------------------------------- */
function buildLlmsTxt(active) {
  return `# Free Stack by Kaipability

> A free, curated directory of ${active.length} genuinely free software tools for UK small businesses. No affiliate links, no sponsored placements, no paid tiers to unlock a listing.

Kaipability Ltd maintains this directory from real client work. Every tool lists its true free-tier limits, at least two alternatives (including open source or self-hosted where they exist), and training resources.

## Trust rules

- No affiliate links, no sponsorships, no paid placements anywhere in this directory.
- Every tool carries at least two alternatives with live URLs.
- Free-tier limits and last-verified dates are stated honestly, never inflated.

## Resources

- Full machine-readable dataset: ${SITE_URL}/data/tools.json
- Frequently asked questions: ${SITE_URL}/faq.html

## Note on this file

Crawler pickup of llms.txt is thin and Google does not support it. This file ships because the payload above already exists elsewhere on the site and costs near zero to publish; it is a cheap bet, not a strategy.
`;
}

/* --- index.html mutation ----------------------------------------------------
   Title and meta description are singleton tags, matched and replaced
   directly; the static block and JSON-LD are marker-delimited so repeated
   runs are idempotent. Neither of the two inline boot scripts is ever
   touched: no regex in this function matches inside a <script> tag. */
function buildIndexHtml(rawHtml, active, intros) {
  let html = rawHtml;

  // Function-form replacements throughout (see upsertBetweenMarkers's own
  // comment): title, meta description and the static block's tool text can
  // all legitimately contain a literal "$", which a string-form replacement
  // would misinterpret as a backreference.
  const count = active.length;
  const titleHtml = `<title>${escapeHtml(buildTitle(count))}</title>`;
  html = html.replace(/<title>[\s\S]*?<\/title>/, () => titleHtml);
  const metaDescHtml = `<meta name="description" content="${escapeHtml(buildMetaDescription(count))}">`;
  html = html.replace(/<meta name="description" content="[^"]*">/, () => metaDescHtml);

  html = upsertBetweenMarkers(
    html,
    '<!-- seo-jsonld:start -->',
    '<!-- seo-jsonld:end -->',
    buildJsonLdBlock(active),
    (h, block) => h.replace('</head>', () => `${block}\n</head>`),
  );

  const staticInner = buildStaticBlockHtml(active, intros);
  html = upsertBetweenMarkers(
    html,
    '<!-- seo-static:start -->',
    '<!-- seo-static:end -->',
    staticInner,
    (h, block) => h.replace(
      /\s*<div id="loading"/,
      (match) => `\n  <div id="static-root">\n${block}\n  </div>\n${match}`,
    ),
  );

  return html;
}

/* --- robots.txt (PRD section 18) --------------------------------------------
   Adds exactly one line, per section 18: "robots.txt gains one line". The
   existing "User-agent: * / Allow: /" content is preserved unchanged; no
   disallow line is ever added (a disallow for /x would advertise the path,
   the Phase 10.12 law this section explicitly reaffirms). */
function buildRobotsTxt(existing) {
  const sitemapLine = `Sitemap: ${SITE_URL}/sitemap.xml`;
  if (existing.includes('Sitemap:')) {
    return existing.replace(/Sitemap:.*(\r?\n)?/, () => `${sitemapLine}\n`);
  }
  const trimmed = existing.replace(/\s+$/, '');
  return `${trimmed}\n${sitemapLine}\n`;
}

/* --- main -------------------------------------------------------------------- */
function main() {
  const tools = JSON.parse(readFileSync(join(ROOT, 'data', 'tools.json'), 'utf8'));
  // Read for parity with the generator family and forward compatibility
  // (see file banner); not consumed by any artefact emitted today.
  JSON.parse(readFileSync(join(ROOT, 'data', 'presets.json'), 'utf8'));
  const intros = JSON.parse(readFileSync(join(ROOT, 'data', 'category-intros.json'), 'utf8'));

  const active = tools.filter((t) => !t.archived);

  const indexPath = join(ROOT, 'index.html');
  const rawIndexHtml = readFileSync(indexPath, 'utf8');
  const newIndexHtml = buildIndexHtml(rawIndexHtml, active, intros);
  writeFileSync(indexPath, newIndexHtml);

  writeFileSync(join(ROOT, 'faq.html'), buildFaqHtml());
  writeFileSync(join(ROOT, 'sitemap.xml'), buildSitemapXml());
  writeFileSync(join(ROOT, 'llms.txt'), buildLlmsTxt(active));

  const robotsPath = join(ROOT, 'robots.txt');
  const rawRobotsTxt = readFileSync(robotsPath, 'utf8');
  writeFileSync(robotsPath, buildRobotsTxt(rawRobotsTxt));

  console.log(`build-seo: ${active.length} active tools, ${new Set(active.map((t) => t.category)).size} categories`);
  console.log('build-seo: wrote index.html, faq.html, sitemap.xml, llms.txt, robots.txt');
}

main();
