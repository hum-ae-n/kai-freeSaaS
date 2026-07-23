/**
 * curator.js: curator mode per PRD section 6.
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

  // Starter pack state: which chip (if any) was last applied, so a later
  // manual edit can be flagged "modified" instead of silently reverting
  // the chip to its unpressed look.
  let activeChip = null;

  // "Start here" need chip state, separate from starter packs: a need chip
  // sets a filter, not a selection, so it tracks independently of activeChip.
  let activeNeedChip = null;
  // True only while a chip click is itself dispatching the change/input
  // event on catSelect/searchInput, so that synthetic event does not read
  // as a manual edit and immediately clear the very chip that caused it.
  let chipDrivenChange = false;

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
  const noteInput = el('input', {
    class: 'input', type: 'text', id: 'client-note', maxlength: '280',
    placeholder: 'Personal note (optional)',
    'aria-label': 'Personal note',
  });
  const resultBox = el('div', { class: 'linkgen-result', hidden: true });

  const buildUrl = () => {
    const ids = tools.filter((t) => selected.has(t.id)).map((t) => t.id); // data order
    const params = new URLSearchParams();
    params.set('t', ids.join(','));
    const name = nameInput.value.trim();
    if (name) params.set('client', name);
    const note = noteInput.value.trim().slice(0, 280);
    if (note) params.set('note', note);
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
    el('div', { class: 'linkgen-controls' }, nameInput, noteInput, generateBtn, previewBtn),
    resultBox,
  );

  /* --- starter packs (presets) --------------------------------------------
     Fetched separately from tools.json, non-blocking: a missing or broken
     data/presets.json must never stop the rest of curator mode rendering. */
  const chipRow = el('div', { class: 'cur-chip-row' });
  const presetsRow = el('div', { class: 'cur-presets', hidden: true },
    el('span', { class: 'eyebrow cur-presets-label' }, 'Starter packs'),
    chipRow,
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
  typeSelect.addEventListener('change', () => { filters.type = typeSelect.value; clearNeedChipIfManual(); update(); });
  catSelect.addEventListener('change', () => { filters.category = catSelect.value; clearNeedChipIfManual(); update(); });
  searchInput.addEventListener('input', () => { filters.search = searchInput.value.trim().toLowerCase(); clearNeedChipIfManual(); update(); });

  const toolbar = el('div', { class: 'cur-toolbar' }, typeSelect, catSelect, searchInput);

  /* --- "Start here" need chips ---------------------------------------------
     For someone who does not know tool names yet: each chip applies a filter
     (category or search), never a selection, so it is a thin layer on top of
     the existing filter state and reuses the same change/input listeners a
     person driving the controls by hand would trigger. Categories are looked
     up against this dataset's actual categories at render time: a need whose
     category is not present in the current catalogue is simply not offered,
     rather than filtering to an empty table. */
  const NEEDS = [
    { label: 'Build a website', kind: 'search', value: 'website hosting builder' },
    { label: 'Look professional', kind: 'category', value: 'Design & Images' },
    { label: 'Get customers', kind: 'category', value: 'Marketing & CRM' },
    { label: 'Be found on Google', kind: 'category', value: 'SEO & Analytics' },
    { label: 'Get paid and keep the books', kind: 'category', value: 'Finance' },
    { label: 'Run the day to day', kind: 'category', value: 'Business Operations' },
    { label: 'Stay secure', kind: 'category', value: 'Security & Compliance' },
    { label: 'Make content and video', kind: 'category', value: 'Video & Audio' },
  ];
  const availableNeeds = NEEDS.filter((n) => n.kind === 'search' || categories.includes(n.value));
  const needsChipRow = el('div', { class: 'cur-chip-row' });
  const needsRow = el('div', { class: 'cur-needs', hidden: !availableNeeds.length },
    el('span', { class: 'eyebrow cur-needs-label' }, 'Start here: what do you need?'),
    needsChipRow,
  );
  for (const need of availableNeeds) {
    const chip = el('button', {
      class: 'cur-chip cur-chip-ghost', type: 'button', 'aria-pressed': 'false',
    }, need.label);
    chip.addEventListener('click', () => toggleNeedChip(need, chip));
    needsChipRow.append(chip);
  }

  function setDropdown(select, value) {
    select.value = value;
    chipDrivenChange = true;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    chipDrivenChange = false;
  }
  function setSearch(value) {
    searchInput.value = value;
    chipDrivenChange = true;
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    chipDrivenChange = false;
  }

  function toggleNeedChip(need, chip) {
    const wasActive = chip === activeNeedChip;
    if (activeNeedChip) {
      activeNeedChip.classList.remove('is-active');
      activeNeedChip.setAttribute('aria-pressed', 'false');
      activeNeedChip = null;
    }
    // Clearing both dimensions before (re)applying keeps only one need's
    // filter live at a time, regardless of which one the previous chip used.
    setDropdown(catSelect, 'all');
    setSearch('');
    if (wasActive) return; // second click on the active chip: back to All
    if (need.kind === 'category') setDropdown(catSelect, need.value);
    else setSearch(need.value);
    chip.classList.add('is-active');
    chip.setAttribute('aria-pressed', 'true');
    activeNeedChip = chip;
  }

  // A manual edit to any filter control, including one made mid chip-driven
  // update, unpicks the active need chip: the chip only ever reflects an
  // exact, current filter state, never a stale one.
  function clearNeedChipIfManual() {
    if (chipDrivenChange || !activeNeedChip) return;
    activeNeedChip.classList.remove('is-active');
    activeNeedChip.setAttribute('aria-pressed', 'false');
    activeNeedChip = null;
  }

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
    // Wrapping label gives the checkbox a >=44px tap target on the mobile
    // card layout without resizing it in the desktop table.
    const checkboxLabel = el('label', { class: 'cur-check-label' }, checkbox);

    const tr = el('tr', { class: `row-${tool.type}` },
      el('td', { class: 'cell-check' }, checkboxLabel),
      el('td', { class: 'cell-name' },
        tool.name,
        el('div', { class: 'tool-urls' },
          tool.urls.map((u) => el('a', {
            href: `https://${u.domain}`, target: '_blank', rel: 'noopener noreferrer',
          }, favicon(u.domain), u.label)),
        ),
      ),
      el('td', { class: 'cell-category' }, tool.category),
      el('td', { class: 'cell-type' }, el('span', { class: `badge badge-${tool.type}` }, TYPE_LABEL[tool.type] ?? tool.type)),
      el('td', { class: 'cell-desc' }, tool.description),
      el('td', { class: 'cell-links' }, tool.alternatives.map((a) => extLink(a.url, a.name, false))),
      el('td', { class: 'cell-links' }, tool.training.map((t) => extLink(t.url, t.name, false))),
      el('td', { class: 'cell-value' }, `~${money(tool.value)}/yr`),
      el('td', { class: 'cell-when' }, tool.when),
      // Mobile-only column: same alternatives/training/when data, grouped
      // into a native <details> "More" disclosure. Desktop hides this cell
      // entirely and keeps the three columns above instead (see CURATOR
      // mobile block in styles.css); it is a duplicate DOM node rather than
      // a shared one because a <details> cannot also serve as three
      // independent table columns.
      el('td', { class: 'cell-more' }, buildMoreDetails(tool)),
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
    noteManualSelectionChange();
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
    actionBtn('Select all CORE', () => {
      setSelection(tools.filter((t) => t.type === 'core').map((t) => t.id));
      noteManualSelectionChange();
    }),
    actionBtn('Select all visible', () => {
      for (const { tr, tool } of rows.values()) if (tr.style.display !== 'none') selected.add(tool.id);
      syncCheckboxes();
      noteManualSelectionChange();
    }),
    actionBtn('Deselect all', () => {
      setSelection([]);
      noteManualSelectionChange();
    }),
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

  /* --- starter packs: apply, and flag manual edits afterwards ------------- */
  function applyPreset(preset, chip, label) {
    // rows is keyed by real tool ids, id 0 included: Map#has is a membership
    // test, never a truthiness test, so tool 0 survives this filter.
    const validIds = preset.ids.filter((id) => rows.has(id));
    setSelection(validIds);

    if (activeChip && activeChip !== chip) {
      activeChip.setAttribute('aria-pressed', 'false');
      activeChip.classList.remove('is-active', 'is-modified');
      activeChip.textContent = activeChip.dataset.baseLabel;
    }
    chip.dataset.baseLabel = label;
    chip.textContent = label;
    chip.setAttribute('aria-pressed', 'true');
    chip.classList.add('is-active');
    chip.classList.remove('is-modified');
    activeChip = chip;

    scrollFirstSelected(validIds);
  }

  function scrollFirstSelected(ids) {
    for (const id of ids) {
      const row = rows.get(id);
      if (!row) continue;
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      row.tr.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
      return;
    }
  }

  // A manual edit after a preset was applied does not snap the chip back to
  // unpressed: it stays the active, selected pack, just visibly modified.
  function noteManualSelectionChange() {
    if (!activeChip) return;
    activeChip.classList.add('is-modified');
    if (!activeChip.textContent.endsWith(' *')) {
      activeChip.textContent = `${activeChip.dataset.baseLabel} *`;
    }
  }

  async function loadPresets() {
    let presets;
    try {
      const res = await fetch('data/presets.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      presets = await res.json();
    } catch (cause) {
      console.warn('Starter packs unavailable, continuing without them:', cause);
      return;
    }
    if (!Array.isArray(presets) || !presets.length) return;

    for (const preset of presets) {
      const validIds = preset.ids.filter((id) => rows.has(id));
      const label = `${preset.name} (${validIds.length} tools)`;
      const chip = el('button', {
        class: 'cur-chip', type: 'button', 'aria-pressed': 'false', title: preset.description,
      }, label);
      chip.dataset.baseLabel = label;
      chip.addEventListener('click', () => applyPreset(preset, chip, label));
      chipRow.append(chip);
    }
    presetsRow.hidden = false;
  }

  root.replaceChildren(
    header, linkgen, needsRow, presetsRow, toolbar, stats, legend,
    el('div', { class: 'table-wrap' }, table),
    actions,
  );
  update();
  loadPresets();

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
function buildMoreDetails(tool) {
  const sections = [];
  if (tool.alternatives.length) {
    sections.push(el('div', { class: 'cur-more-section' },
      el('span', { class: 'cur-more-label' }, 'Alternatives'),
      el('div', { class: 'cell-links' }, tool.alternatives.map((a) => extLink(a.url, a.name, false))),
    ));
  }
  if (tool.training.length) {
    sections.push(el('div', { class: 'cur-more-section' },
      el('span', { class: 'cur-more-label' }, 'Training'),
      el('div', { class: 'cell-links' }, tool.training.map((t) => extLink(t.url, t.name, false))),
    ));
  }
  if (tool.when) {
    sections.push(el('div', { class: 'cur-more-section' },
      el('span', { class: 'cur-more-label' }, 'Include when'),
      el('p', { class: 'cur-more-when' }, tool.when),
    ));
  }
  return el('details', { class: 'cur-more' }, el('summary', {}, 'More'), sections);
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
