/**
 * curator.js — curator mode per PRD section 6.
 * Owns the .cur- classes and the tools table. DOM contract in data-loader.js.
 */
import { el, favicon, extLink, money, showToast, shareUrl } from './data-loader.js';

const TYPE_LABEL = { core: 'CORE', noncore: 'NON-CORE', m365: 'M365', sector: 'SECTOR' };

export function renderCurator(root, allTools) {
  // Archived tools are retired: hidden from the table, counts and select-all
  // actions, but never deleted from data/tools.json (§4 ID permanence). An
  // old client link to one still resolves via client.js, just not from here.
  const tools = allTools.filter((t) => !t.archived);
  const selected = new Set(tools.filter((t) => t.type === 'core').map((t) => t.id));
  const filters = { type: 'all', category: 'all', search: '' };
  const categories = [...new Set(tools.map((t) => t.category))].sort();

  /* --- header ------------------------------------------------------------ */
  const header = el('header', { class: 'cur-header' },
    el('img', { class: 'logo', src: 'design-system/assets/kaipability-logo-lockup.png', alt: 'Kaipability' }),
    el('div', {},
      el('h1', {}, 'Free Stack'),
      el('p', { class: 'subtitle' }, 'Curated free software for small business'),
      el('p', { class: 'trust-line' }, 'No affiliates, no sponsors, no paid placement.'),
    ),
    el('p', { class: 'tool-count' }, `${tools.length} tools in the catalogue`),
  );

  /* --- link generator ---------------------------------------------------- */
  const nameInput = el('input', {
    class: 'input', type: 'text', id: 'client-name',
    placeholder: 'Client or recipient name (optional)',
    'aria-label': 'Client or recipient name',
  });
  const resultBox = el('div', { class: 'linkgen-result', hidden: true });

  const buildUrl = () => {
    const ids = tools.filter((t) => selected.has(t.id)).map((t) => t.id); // data order
    const params = new URLSearchParams();
    params.set('t', ids.join(','));
    const name = nameInput.value.trim();
    if (name) params.set('client', name);
    // keep commas readable per PRD section 5 (%2C decodes identically)
    return `${location.origin}${location.pathname}?${params.toString().replace(/%2C/g, ',')}`;
  };

  const generateBtn = el('button', { class: 'btn btn-primary', type: 'button' }, 'Generate link');
  generateBtn.addEventListener('click', () => {
    if (!selected.size) return showToast('Select at least one tool first', 'error');
    const url = buildUrl();
    resultBox.replaceChildren(
      el('span', { class: 'generated-url' }, url),
      copyButton('Copy', () => url),
      shareButton(() => url),
    );
    resultBox.hidden = false;
  });

  const previewBtn = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Preview client view');
  previewBtn.addEventListener('click', () => {
    if (!selected.size) return showToast('Select at least one tool first', 'error');
    window.open(buildUrl(), '_blank', 'noopener');
  });

  const linkgen = el('section', { class: 'panel linkgen', 'aria-label': 'Link generator' },
    el('span', { class: 'eyebrow' }, 'Link generator'),
    el('h2', {}, 'Share a stack'),
    el('div', { class: 'linkgen-controls' }, nameInput, generateBtn, previewBtn),
    resultBox,
  );

  /* --- filters ----------------------------------------------------------- */
  const typeSelect = el('select', { class: 'select', 'aria-label': 'Filter by type' },
    option('all', 'All types'), option('core', 'Core'), option('noncore', 'Non-core'),
    option('m365', 'M365'), option('sector', 'Sector'), option('checked', 'Checked only'),
  );
  const catSelect = el('select', { class: 'select', 'aria-label': 'Filter by category' },
    option('all', 'All categories'),
    categories.map((c) => option(c, c)),
  );
  const searchInput = el('input', {
    class: 'input', type: 'search', placeholder: 'Search tools, descriptions, alternatives…',
    'aria-label': 'Search tools',
  });
  typeSelect.addEventListener('change', () => { filters.type = typeSelect.value; update(); });
  catSelect.addEventListener('change', () => { filters.category = catSelect.value; update(); });
  searchInput.addEventListener('input', () => { filters.search = searchInput.value.trim().toLowerCase(); update(); });

  const toolbar = el('div', { class: 'cur-toolbar' }, typeSelect, catSelect, searchInput);

  /* --- stats + legend ---------------------------------------------------- */
  const statSelected = el('span', {}, el('strong', {}, '0'), ' selected');
  const statValue = el('span', { class: 'stat-value' }, el('strong', {}, '£0'), ' total value equivalent');
  const statShowing = el('span', {}, el('strong', {}, String(tools.length)), ' showing');
  const stats = el('div', { class: 'cur-stats', role: 'status' }, statSelected, statValue, statShowing);

  const legend = el('div', { class: 'legend', 'aria-hidden': 'true' },
    Object.entries(TYPE_LABEL).map(([type, label]) =>
      el('span', { class: `badge badge-${type}` }, label)),
    el('span', {}, 'Core tools are pre-selected'),
  );

  /* --- table ------------------------------------------------------------- */
  const tbody = el('tbody', {});
  const rows = new Map(); // id → {tr, checkbox, haystack}

  for (const tool of tools) {
    const checkbox = el('input', {
      type: 'checkbox', 'aria-label': `Select ${tool.name}`,
      dataset: { id: String(tool.id) },
    });
    checkbox.checked = selected.has(tool.id);

    const tr = el('tr', { class: `row-${tool.type}` },
      el('td', {}, checkbox),
      el('td', { class: 'cell-name' },
        tool.name,
        el('div', { class: 'tool-urls' },
          tool.urls.map((u) => el('a', {
            href: `https://${u.domain}`, target: '_blank', rel: 'noopener noreferrer',
          }, favicon(u.domain), u.label)),
        ),
      ),
      el('td', {}, tool.category),
      el('td', {}, el('span', { class: `badge badge-${tool.type}` }, TYPE_LABEL[tool.type] ?? tool.type)),
      el('td', { class: 'cell-desc' }, tool.description),
      el('td', { class: 'cell-links' }, tool.alternatives.map((a) => extLink(a.url, a.name, false))),
      el('td', { class: 'cell-links' }, tool.training.map((t) => extLink(t.url, t.name, false))),
      el('td', { class: 'cell-value' }, `~${money(tool.value)}/yr`),
      el('td', { class: 'cell-when' }, tool.when),
    );

    const haystack = [
      tool.name, tool.category, tool.description,
      ...tool.alternatives.map((a) => a.name),
      ...tool.training.map((t) => t.name),
    ].join(' ').toLowerCase();

    rows.set(tool.id, { tr, checkbox, haystack, tool });
    tbody.append(tr);
  }

  tbody.addEventListener('change', (event) => {
    const box = event.target;
    if (box.type !== 'checkbox') return;
    const id = Number(box.dataset.id);
    box.checked ? selected.add(id) : selected.delete(id);
    update();
  });

  const table = el('table', { class: 'tools-table' },
    el('thead', {}, el('tr', {},
      ['✓', 'Tool', 'Category', 'Type', 'Description', 'Alternatives', 'Training', 'Value', 'Include When']
        .map((h) => el('th', { scope: 'col' }, h)),
    )),
    tbody,
  );

  /* --- actions ----------------------------------------------------------- */
  const actions = el('div', { class: 'cur-actions' },
    copyButton('Copy selected → tab-separated', () => copyPayload(), 'btn-secondary'),
    actionBtn('Select all CORE', () => setSelection(tools.filter((t) => t.type === 'core').map((t) => t.id))),
    actionBtn('Select all visible', () => {
      for (const { tr, tool } of rows.values()) if (tr.style.display !== 'none') selected.add(tool.id);
      syncCheckboxes();
    }),
    actionBtn('Deselect all', () => setSelection([])),
  );

  function setSelection(ids) {
    selected.clear();
    ids.forEach((id) => selected.add(id));
    syncCheckboxes();
  }
  function syncCheckboxes() {
    for (const { checkbox, tool } of rows.values()) checkbox.checked = selected.has(tool.id);
    update();
  }

  function copyPayload() {
    const picked = tools.filter((t) => selected.has(t.id));
    if (!picked.length) return null;
    const lines = [['Tool / Resource', 'What It Does', 'Value Equivalent'].join('\t')];
    for (const t of picked) {
      const name = `${t.name} (${t.urls.map((u) => u.label).join(', ')})`;
      const desc = `${t.description} Alternatives: ${t.alternatives.map((a) => a.name).join(', ')}. `
        + `Training: ${t.training.map((r) => r.name).join(', ')}.`;
      lines.push([name, desc, `~${money(t.value)}/yr`].join('\t'));
    }
    const total = picked.reduce((sum, t) => sum + t.value, 0);
    lines.push(['TOTAL FREE VALUE', `${picked.length} tools available at zero cost`, `~${money(total)}/yr`].join('\t'));
    return lines.join('\n');
  }

  /* --- filtering + stats ------------------------------------------------- */
  function update() {
    let showing = 0;
    for (const { tr, tool, haystack } of rows.values()) {
      const typeOk = filters.type === 'all'
        || (filters.type === 'checked' ? selected.has(tool.id) : tool.type === filters.type);
      const catOk = filters.category === 'all' || tool.category === filters.category;
      const searchOk = !filters.search || haystack.includes(filters.search);
      const visible = typeOk && catOk && searchOk;
      tr.style.display = visible ? '' : 'none';
      if (visible) showing += 1;
    }
    const picked = tools.filter((t) => selected.has(t.id));
    statSelected.firstChild.textContent = String(picked.length);
    statValue.firstChild.textContent = money(picked.reduce((sum, t) => sum + t.value, 0));
    statShowing.firstChild.textContent = String(showing);
  }

  root.replaceChildren(
    header, linkgen, toolbar, stats, legend,
    el('div', { class: 'table-wrap' }, table),
    actions,
  );
  update();

  // Stats bar sticks beneath the sticky table header once measured (item 8).
  // Falls back to the CSS default if the table has no rows to measure yet.
  const syncStickyOffset = () => {
    const theadHeight = table.querySelector('thead')?.getBoundingClientRect().height;
    if (theadHeight) stats.style.setProperty('--thead-h', `${theadHeight}px`);
  };
  requestAnimationFrame(syncStickyOffset);
  window.addEventListener('resize', syncStickyOffset);
}

/* --- small helpers ------------------------------------------------------- */
function option(value, label) {
  return el('option', { value }, label);
}
function actionBtn(label, onClick) {
  const btn = el('button', { class: 'btn btn-ghost', type: 'button' }, label);
  btn.addEventListener('click', onClick);
  return btn;
}
function copyButton(label, getText, extraClass = 'btn-ghost btn-sm') {
  const btn = el('button', { class: `btn ${extraClass}`, type: 'button' }, label);
  btn.addEventListener('click', async () => {
    const text = typeof getText === 'function' ? getText() : getText;
    if (!text) return showToast('Nothing selected to copy', 'error');
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copied to clipboard');
    } catch {
      showToast('Copy failed: your browser blocked clipboard access', 'error');
    }
  });
  return btn;
}
function shareButton(getUrl, extraClass = 'btn-ghost btn-sm') {
  const btn = el('button', { class: `btn ${extraClass}`, type: 'button' }, 'Share');
  btn.addEventListener('click', () => shareUrl(getUrl(), 'Your free software stack from Kaipability'));
  return btn;
}
