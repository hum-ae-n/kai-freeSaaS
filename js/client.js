/**
 * client.js — client mode per PRD section 7. A read-only deliverable.
 * Owns the .cli- and .tool-card classes. DOM contract in data-loader.js.
 * Client name comes from the URL: it is ALWAYS inserted via textContent (el()).
 */
import { el, favicon, extLink, getDomain, money } from './data-loader.js';

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

  const totalValue = picked.reduce((sum, t) => sum + t.value, 0);
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  /* --- header ------------------------------------------------------------ */
  const header = el('header', { class: 'panel cli-header' },
    el('img', { class: 'logo', src: 'design-system/assets/kaipability-logo-lockup.png', alt: 'Kaipability' }),
    el('h1', {}, 'Your Free Software Stack'),
    clientName ? el('p', { class: 'prepared-for eyebrow' }, `Prepared for ${clientName}`) : null,
    el('p', { class: 'cli-date' }, today),
    el('p', { class: 'cli-context' },
      'Free tools selected for your business. Every tool includes alternatives and training resources to get started.'),
  );

  /* --- summary ----------------------------------------------------------- */
  const summary = el('section', { class: 'cli-summary', 'aria-label': 'Summary' },
    el('div', {},
      el('span', { class: 'num' }, String(picked.length)),
      el('span', { class: 'lbl' }, picked.length === 1 ? 'tool selected' : 'tools selected'),
    ),
    el('div', {},
      el('span', { class: 'num' }, `~${money(totalValue)}/yr`),
      el('span', { class: 'lbl' }, 'value equivalent, at zero cost'),
    ),
  );

  /* --- cards grouped by category (data order preserved) ------------------ */
  const groups = new Map();
  for (const tool of picked) {
    if (!groups.has(tool.category)) groups.set(tool.category, []);
    groups.get(tool.category).push(tool);
  }

  const sections = [];
  for (const [category, groupTools] of groups) {
    sections.push(el('h2', { class: 'cli-category' }, category));
    sections.push(el('div', { class: 'card-grid' }, groupTools.map(card)));
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

  root.replaceChildren(header, summary, ...sections, footer);
  document.title = clientName ? `Free Software Stack · ${clientName}` : 'Your Free Software Stack';
}

function card(tool) {
  return el('article', { class: 'panel tool-card' },
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
  );
}
