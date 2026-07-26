/**
 * public.js: the public directory, per BUILD-PLAN item 10.12 (Rocky's 24 Jul
 * public/staff split). Mounted at #public-root by data-loader's boot() for
 * every path that is not client mode, curator mode or the /x staff entry.
 * Read-only, indexable (no robots meta), no summary bar and no cost chart:
 * those belong to a curated selection, not the open catalogue. Cards reuse
 * client.js's card()/categoryIcon()/buildCardSections() rather than
 * duplicating the markup, with the checklist toggle suppressed throughout.
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

export function renderPublic(root, tools) {
  // Archived tools are retired: the public directory shows only what a
  // reader could actually adopt today, same rule the curator table follows.
  const active = tools.filter((t) => !t.archived);
  let plainMode = readPlainMode();
  let searchTerm = '';

  /* --- header -------------------------------------------------------------- */
  const header = el('header', { class: 'panel pub-header' },
    el('img', { class: 'logo', src: 'design-system/assets/kaipability-logo-lockup.png', alt: 'Kaipability' }),
    el('h1', {}, 'Free Stack'),
    el('p', { class: 'subtitle' }, 'Curated free software for small business'),
    el('p', { class: 'trust-line' }, 'No affiliates, no sponsors, no paid placement.'),
  );

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

  const toolbar = el('div', { class: 'pub-toolbar' }, searchInput, plainBtn, themeToggleButton('btn-ghost btn-lg'));

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

  function draw() {
    const filtered = active.filter((t) => matchesSearch(t, searchTerm, plainMode));
    if (!filtered.length) {
      listWrap.replaceChildren(el('p', { class: 'pub-empty' }, 'No tools match your search.'));
      return;
    }
    listWrap.replaceChildren(...buildCardSections(filtered, { plainMode, showToggle: false }));
  }

  draw();
  root.replaceChildren(header, toolbar, changelogSection, listWrap, footer);
  document.title = 'Free Stack · Kaipability';
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
