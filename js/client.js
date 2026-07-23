/**
 * client.js — client mode per PRD section 7. A read-only deliverable.
 * Owns the .cli- and .tool-card classes. DOM contract in data-loader.js.
 * Client name comes from the URL: it is ALWAYS inserted via textContent (el()).
 */
import { el, favicon, extLink, getDomain, money, shareUrl } from './data-loader.js';

const MAX_STAGGER = 8; // entrance stagger caps at 8 cards, per item 6a

export function renderClient(root, tools, selection, clientName) {
  const byId = new Map(tools.map((t) => [t.id, t]));
  const picked = selection.map((id) => byId.get(id)).filter((t) => t !== undefined);

  if (!picked.length) {
    root.replaceChildren(
      el('div', { class: 'app-message' },
        'This link contains no tools. Ask whoever sent it for a fresh one, or ',
        el('a', { href: location.pathname }, 'open the full directory'),
        '.',
      ),
    );
    return;
  }

  // Archived tools carry no value claim (§4, item 12c): the card points at
  // alternatives instead of standing behind a figure for a retired product.
  const totalValue = picked.reduce((sum, t) => sum + (t.archived ? 0 : t.value), 0);
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  /* --- header ------------------------------------------------------------ */
  const header = el('header', { class: 'panel cli-header' },
    el('img', { class: 'logo', src: 'design-system/assets/kaipability-logo-lockup.png', alt: 'Kaipability' }),
    el('h1', {}, 'Your Free Software Stack'),
    clientName ? el('p', { class: 'prepared-for eyebrow' }, `Prepared for ${clientName}`) : null,
    el('p', { class: 'curated-by' },
      clientName ? `Curated for ${clientName} by Kaipability` : 'Curated by Kaipability'),
    el('p', { class: 'cli-date' }, today),
    el('p', { class: 'cli-context' },
      'Free tools selected for your business. Every tool includes alternatives and training resources to get started.'),
  );

  /* --- share + print, screen-only chrome ---------------------------------- */
  const shareBtn = el('button', { class: 'btn btn-ghost btn-lg', type: 'button' }, 'Share this page');
  shareBtn.addEventListener('click', () => shareUrl(location.href, 'Your free software stack from Kaipability'));

  const printBtn = el('button', { class: 'btn btn-secondary btn-lg', type: 'button' }, 'Print or save as PDF');
  printBtn.addEventListener('click', () => window.print());

  const toolbar = el('div', { class: 'cli-toolbar no-print' }, shareBtn, printBtn);

  /* --- summary ----------------------------------------------------------- */
  const valueFigure = el('span', { class: 'num' }, money(0));
  const summary = el('section', { class: 'cli-summary', 'aria-label': 'Summary' },
    el('div', {},
      el('span', { class: 'num' }, String(picked.length)),
      el('span', { class: 'lbl' }, picked.length === 1 ? 'tool selected' : 'tools selected'),
    ),
    el('div', {},
      valueFigure,
      el('span', { class: 'lbl' }, `replaces roughly ${money(totalValue)}/yr of software, at zero cost`),
    ),
  );

  /* --- cards grouped by category (data order preserved) ------------------ */
  const groups = new Map();
  for (const tool of picked) {
    if (!groups.has(tool.category)) groups.set(tool.category, []);
    groups.get(tool.category).push(tool);
  }

  let cardIndex = 0;
  const sections = [];
  for (const [category, groupTools] of groups) {
    sections.push(el('h2', { class: 'cli-category' }, category));
    const items = groupTools.map((tool) => el('li', {}, card(tool, cardIndex++)));
    if (items.length === 1) items[0].classList.add('card-solo');
    sections.push(el('ul', { class: 'card-grid' }, items));
  }

  /* --- footer ------------------------------------------------------------ */
  const footer = el('footer', { class: 'cli-footer' },
    el('img', { class: 'logo', src: 'design-system/assets/kaipability-logo-lockup.png', alt: '' }),
    el('span', {},
      'Curated by ',
      el('a', { href: 'https://kaipability.com', target: '_blank', rel: 'noopener noreferrer' }, 'Kaipability Ltd'),
      '. No affiliate links, no sponsored placements.',
    ),
  );

  root.replaceChildren(header, toolbar, summary, ...sections, footer);
  document.title = clientName ? `Free Software Stack · ${clientName}` : 'Your Free Software Stack';

  countUp(valueFigure, totalValue, (n) => `~${money(n)}/yr`);
}

/** rAF count-up on the summary value, triggered once on scroll into view.
    Instant when the reader has asked for reduced motion, since CSS media
    queries don't govern requestAnimationFrame. */
function countUp(target, endValue, format) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) { target.textContent = format(endValue); return; }

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      const duration = 700;
      const start = performance.now();
      const step = (now) => {
        const t = Math.min((now - start) / duration, 1);
        const eased = 1 - (1 - t) ** 3;
        target.textContent = format(Math.round(endValue * eased));
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  }, { threshold: 0.5 });
  observer.observe(target);
}

function formatVerified(dateStr) {
  if (!dateStr) return null;
  const parsed = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function card(tool, i) {
  const style = `--i: ${Math.min(i, MAX_STAGGER)}`;
  if (tool.archived) return archivedCard(tool, style);

  const verified = formatVerified(tool.last_verified);

  return el('article', { class: 'panel tool-card', style },
    el('div', { class: 'card-top' },
      el('h3', {}, favicon(tool.urls[0]?.domain), tool.name),
      el('span', { class: 'card-value' }, `~${money(tool.value)}/yr`),
    ),
    el('div', { class: 'card-domains' },
      tool.urls.map((u) => el('a', {
        href: `https://${u.domain}`, target: '_blank', rel: 'noopener noreferrer',
      }, u.label)),
    ),
    el('p', { class: 'card-desc' }, tool.description),

    el('p', { class: 'card-section-label' }, 'Alternatives'),
    el('div', { class: 'card-links' },
      tool.alternatives.map((a) => extLink(a.url, a.name, true)),
    ),

    el('p', { class: 'card-section-label' }, 'Get started'),
    el('div', { class: 'card-links' },
      tool.training.map((t) => extLink(t.url, t.name, true)),
    ),

    tool.notes?.length
      ? el('div', { class: 'card-notes' }, tool.notes.map((n) => el('p', {}, n)))
      : null,

    verified ? el('p', { class: 'card-verified' }, `Verified ${verified}`) : null,
  );
}

/** Archived tools never silently disappear (§4 ID permanence). An old link
    still resolves, but the card is compact and points only at alternatives:
    no training block, no value claim for a product no longer recommended. */
function archivedCard(tool, style) {
  return el('article', { class: 'panel tool-card tool-card-archived', style },
    el('div', { class: 'card-top' },
      el('h3', {}, tool.name),
    ),
    el('p', { class: 'card-archived-note' }, 'No longer recommended. Consider the alternatives below.'),
    el('p', { class: 'card-section-label' }, 'Alternatives'),
    el('div', { class: 'card-links' },
      tool.alternatives.map((a) => extLink(a.url, a.name, true)),
    ),
  );
}
