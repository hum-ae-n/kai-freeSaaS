/**
 * workspace.js: the /my surface (PRD-REGISTER, Wave A per BUILD-PLAN 11.1;
 * Accounts CRUD, risk engine wiring, Overview tiles, stack import/merge and
 * sovereign templates added Wave B per BUILD-PLAN 11.2). Mounted at #my-root
 * by js/data-loader.js's boot(). Owns everything under that mount point:
 * first-run gates, setup, lock screen and the app shell. The only module
 * besides js/my/store.js allowed to know the shape of a workspace document;
 * every mutation still flows through store.js's six methods, this module
 * never touches storage directly. js/my/risks.js and js/my/templates.js are
 * pure-data helpers this module calls but never a storage seam of their own.
 *
 * Phase 12 Wave D (BUILD-PLAN 12.4, PRD-REGISTER sections 16 and 19): the
 * `planned` status end to end (chip, "To sign up" group, drawer, risk-tile
 * and Leavers exclusion), and `?have=` parsed alongside `?from=` for the
 * Discover deck hand-off. The deck's own public-surface storage key (named
 * in js/discover.js's module comment, and deliberately not spelled out here
 * either, so a blunt grep for it never turns up a false "read" in a comment)
 * is never read anywhere in this file, or anywhere else under js/my/: the
 * hand-off travels in the URL only, since store.js remains the one module
 * that may touch this surface's persistence (section 6). store.js itself is
 * untouched this wave: no new methods, no schema bump, the `planned` value
 * is additive to an existing string enum.
 *
 * Redraw discipline: each screen is built once by its view function and
 * only rebuilt wholesale on a genuine step/mode transition (a button
 * click), never on a keystroke. Text inputs write straight into local
 * state via their own 'input' listener with no redraw, so typing never
 * loses focus. This mirrors curator.js's targeted-update discipline for
 * the same reason, by a different mechanism suited to a multi-step wizard.
 *
 * ONE deliberate exception (Wave B): the accounts free-text search filters
 * the table live, as the reader types, which needs a redraw per keystroke
 * to show/hide rows. draw() below preserves whatever element currently has
 * focus (by a data-focus-key attribute) and its cursor position across that
 * redraw, so the exception never costs the reader their place. Every input
 * that should survive a redraw (search, inline table edits, the drawer's
 * fields) carries a stable data-focus-key for this to key off.
 */
import { el, themeToggleButton, readPlainMode, writePlainMode, showToast, parseSelection, money } from '../data-loader.js';
import * as store from './store.js';
import { sampleDocument, sampleStatus } from './sample.js';
import {
  isPersonalEmail, mfaRiskLabel, hasNoOwner, isRenewalSoon, completeness,
  RISK_FILTERS, matchesSearch, leaverChecklist,
} from './risks.js';
import { SOVEREIGN_TEMPLATES, templateToRow } from './templates.js';
// categoryIcon is a standalone, side-effect-free export (module comment,
// BUILD-PLAN 11.3 report): reused here for My tools cards without dragging
// in any of client.js's page chrome, exactly as section 9.3 asks for.
import { categoryIcon } from '../client.js';
// Wave D: the two verbatim house-voice strings now live in copy.js, the one
// source why-register.js's awareness page and this module both quote from.
import { POSITIONING_SENTENCE, PRIVACY_NOTICE } from './copy.js';

/* --- house-voice constants, verbatim per PRD-REGISTER ---------------------- */
const CONSEQUENCE_SENTENCE = 'If you forget this passphrase, nobody can recover this register. Not you, not us. There is no reset.';
// Approved storage phrasing (section 3): never "safe", never "stored securely".
const STORAGE_PHRASE = 'saved in this browser, on this device';
const MIN_PASSPHRASE = 8; // not specified by the PRD to the character; a defensible floor, noted in the build report

const SIDEBAR = [
  ['overview', 'Overview'],
  ['accounts', 'Accounts'],
  ['my-tools', 'My tools'],
  ['costs', 'Costs'],
  ['leavers', 'Leavers'],
  ['backup', 'Backup'],
];

/* --- webview detection: compact, hand-rolled, best effort (section 3) ------ */
const WEBVIEW_PATTERNS = [
  /WhatsApp/i, /Instagram/i, /FBAN/i, /FBAV/i, /LinkedInApp/i, /\bTikTok\b/i,
  /GSA\//i, /\bGmail\b/i, /; ?wv\)/i,
];
export function isInAppWebview(ua) {
  return WEBVIEW_PATTERNS.some((re) => re.test(ua || ''));
}

/** iOS Safari, specifically (section 3's "Add to Home Screen" guidance and
    section 8's share path both name this browser, not iOS generally): other
    iOS browsers (Chrome, Firefox, Edge on iOS all use Apple's WebKit but
    carry their own UA token) are excluded, since they cannot be added to
    the home screen as their own storage-bearing app the way Safari can. */
export function isIosSafari(ua) {
  const s = ua || '';
  const isIOS = /iP(hone|od|ad)/.test(s);
  const isSafari = /Safari/.test(s) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(s);
  return isIOS && isSafari;
}

/** Feature-detect the Web Share API's file-sharing extension (section 8):
    plain navigator.share existing is not enough, since most desktop
    browsers implement it without file support. */
function canShareFiles() {
  try {
    return !!(navigator.canShare && navigator.share
      && navigator.canShare({ files: [new File(['x'], 'x.json', { type: 'application/json' })] }));
  } catch { return false; }
}

/* --- small formatting helpers ---------------------------------------------- */
function slugify(str) {
  return (str || 'workspace').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace';
}
function exportFilename(business) {
  const date = new Date().toISOString().slice(0, 10);
  return `mystack-register-${slugify(business)}-${date}.fsr.json`;
}
function todayIso() { return new Date().toISOString().slice(0, 10); }
function formatDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
/** Backup-age escalation (PRD-REGISTER section 8): quiet under 30 days,
    amber past 30, red past 60 OR after 10+ saves since the last export,
    whichever comes first. The saves-based trigger exists because a register
    that changes heavily between exports is riskier to lose than its raw
    age alone would suggest. */
function backupAgeInfo(lastExportAt, savesSinceExport = 0) {
  if (!lastExportAt) return { text: 'No backup exported yet', level: 'red' };
  const days = Math.floor((Date.now() - new Date(lastExportAt).getTime()) / 86400000);
  const age = days <= 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`;
  const heavilyChanged = savesSinceExport >= 10;
  if (days > 60 || heavilyChanged) {
    const why = days > 60 ? age : `${savesSinceExport} changes since then`;
    return { text: `Last exported ${age} (${why}): export again soon`, level: 'red' };
  }
  if (days > 30) return { text: `Last exported ${age}, due a fresh export soon`, level: 'amber' };
  return { text: `Last exported ${age}`, level: 'ok' };
}
const MFA_LABEL = { app: 'Authenticator app', sms: 'SMS code', hardware: 'Hardware key', none: 'None', unknown: 'Not recorded' };
const ADMIN_LABEL = { owner: 'Owner', admin: 'Admin', member: 'Member', unknown: 'Not recorded' };
// `planned` (section 16, amends section 4.2): an account the business means
// to open but has not yet. Listed first since it is the earliest point in
// an account's life, not because it is somehow the default.
const STATUS_LABEL = { planned: 'Planned', active: 'Active', 'to-close': 'To close', closed: 'Closed' };
const STATUS_OPTIONS = ['planned', 'active', 'to-close', 'closed'];
// My tools (section 9.3): the same statuses, worded as an adoption echo.
const ADOPTION_LABEL = { planned: 'Planned', active: 'In use', 'to-close': 'To close', closed: 'Closed' };
/** Chip colour level for a status, shared by the Accounts table's quiet
    "Planned" chip and My tools' adoption chip (section 16: "a quiet chip",
    never the amber/green risk vocabulary, since a plan is not yet a risk or
    a success). Unknown/future status strings (an import from an older or
    stranger build, section 16's "importer treats an unknown status string
    as data, never a crash") fall through to no colour at all rather than
    throwing. */
function statusChipLevel(status) {
  if (status === 'active') return 'ok';
  if (status === 'to-close') return 'amber';
  if (status === 'planned') return 'quiet';
  return null;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** A small standalone HTML document built entirely through el(), so every
    piece of user-supplied text (the business name) reaches the page via
    text nodes only; .innerHTML is used here purely to SERIALISE an
    already-safe DOM tree back to a string, which escapes it again, never
    to parse untrusted markup. The passphrase itself is never written into
    this file: PRD-REGISTER's "no password field, ever, anywhere" law reads
    most safely as covering any downloadable artefact, so the sheet leaves
    a blank box for the reader to fill in by hand instead. */
function buildRecoverySheetBody(business, date) {
  return el('div', {},
    el('h1', {}, 'My Stack recovery sheet'),
    el('p', {}, `${business}, generated ${date}.`),
    el('p', {}, CONSEQUENCE_SENTENCE),
    el('p', {}, 'Write your passphrase in the box below by hand, then keep this sheet somewhere safe and separate from this device.'),
    el('div', { style: 'border:2px solid #000;height:80px;margin:16px 0;' }),
    el('p', {}, 'My Stack never stores your passphrase and cannot recover it for you.'),
  );
}

function buildRecoverySheetHtml(business, date) {
  const body = buildRecoverySheetBody(business, date);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>My Stack recovery sheet</title></head><body>${body.innerHTML}</body></html>`;
}

/** Prints the recovery sheet from the current page via the print stylesheet,
    the same pattern the leaver checklist uses. A popup window
    (window.open + document.write + print) is the obvious alternative and it
    does not work on mobile: 'noopener' makes window.open return null in
    modern browsers, and Android Chrome largely ignores scripted print calls
    on blank popups. The sheet stays mounted (invisible on screen) until
    afterprint fires; if a browser never fires it, the node is inert and is
    removed on the next print. */
function printRecoverySheet(business) {
  const prev = document.querySelector('.my-print-sheet');
  if (prev) prev.remove();
  const sheet = el('div', { class: 'my-print-sheet' }, buildRecoverySheetBody(business, todayIso()));
  document.body.appendChild(sheet);
  document.body.classList.add('my-printing-sheet');
  const cleanup = () => {
    sheet.remove();
    document.body.classList.remove('my-printing-sheet');
  };
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
}

/** ULID-style is the PRD's own word for this (section 4.2): not a literal
    ULID implementation, but a client-generated, roughly time-sortable,
    collision-safe-enough-for-one-device id. Timestamp prefix plus a random
    suffix is a defensible, dependency-free reading of that, noted here. */
function newId() {
  return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
function blankAccount(overrides = {}) {
  return {
    id: newId(), service: '', url: '', toolId: null, identity: '', owner: '',
    admin: 'unknown', mfa: 'unknown', plan: '', renewal: null, monthlyCost: null,
    status: 'active', notes: '', shared: false, ...overrides,
  };
}
/** One register row per stack tool (section 2, section 9.7, section 15.2,
    section 19): service and address filled in from the catalogue, identity
    and owner deliberately left blank since nobody but the reader knows who
    opened the account or with what address, never invented here.
    `tool.urls[0].domain` is a bare hostname (CLAUDE.md's own note on that
    field), so the https:// prefix is added here to satisfy the register
    schema's "https URL" for `url`. `status` defaults to `active` (every
    call site before section 19 existed relied on that default); a Discover
    "want to try" row (section 19) passes `'planned'` explicitly instead. */
function buildRowFromTool(tool, status = 'active') {
  const domain = tool.urls && tool.urls[0] && tool.urls[0].domain;
  return blankAccount({ service: tool.name, url: domain ? `https://${domain}` : '', toolId: tool.id, status });
}
function cloneDoc(doc) {
  return typeof structuredClone === 'function' ? structuredClone(doc) : JSON.parse(JSON.stringify(doc));
}

/* ============================================================================
   Batch add (PRD-REGISTER section 17, BUILD-PLAN 12.5): a pure row builder,
   no closures needed. Every row in a batch, whatever it was ticked from
   (catalogue tool, sovereign template, or a free-text name), gets the SAME
   identity/owner/mfa/plan/status from the batch's one shared-details step;
   the batch form itself carries no per-row fields (section 17's own words),
   overrides happen afterwards through the existing drawer like any other
   row. `item.kind` is 'tool' | 'template' | 'free'.
   ========================================================================= */
function buildBatchRow(item, shared) {
  let service = '';
  let url = '';
  let toolId = null;
  let notes = '';
  if (item.kind === 'tool') {
    service = item.tool.name;
    const domain = item.tool.urls && item.tool.urls[0] && item.tool.urls[0].domain;
    url = domain ? `https://${domain}` : '';
    toolId = item.tool.id; // Number.isInteger elsewhere, never truthiness: id 0 is a real tool
  } else if (item.kind === 'template') {
    service = item.tpl.service;
    url = item.tpl.url;
    notes = item.tpl.notes || '';
  } else {
    service = item.name;
  }
  return blankAccount({
    service, url, toolId, notes,
    identity: shared.identity, owner: shared.owner, mfa: shared.mfa,
    plan: shared.plan, status: shared.status,
  });
}

/* ============================================================================
   Sign-up generator (PRD-REGISTER section 18, BUILD-PLAN 12.5): pure text
   and DOM builders, no closures needed, fed a list of { tool, row } pairs
   (either may be absent: `row` is missing for a "want to try" catalogue
   tool with no register row yet; `tool` is missing for a manual account
   with no catalogue link). Shared by the on-screen sheet, the copy-as-text
   handler and the in-page print sheet, so the three outputs can never say
   different things about the same set of tools.
   ========================================================================= */
function generatorEntries(items) {
  return items.map(({ tool, row }) => {
    const name = (row && row.service) || (tool && tool.name) || 'Untitled account';
    const identity = (row && row.identity) || '';
    return { name, identity, personal: isPersonalEmail(identity), freeLimit: (tool && tool.free_limit) || null };
  });
}
// Cyber Essentials wording law (section 11, section 18): "helps you prepare
// for" is permitted; the explicit "does not make you certified" clause is
// the law's own required negation, never a claim of compliance, and no CE
// badge is ever rendered.
const CE_LINE = 'Working through this checklist helps you prepare for Cyber Essentials account-management questions. It does not make you certified: certification needs an independent assessment.';
function generatorChecklistPoints(e) {
  const idLine = e.identity
    ? `Sign up with your business email, not a personal one. Use ${e.identity}.${e.personal ? ' This looks like a personal email address: use a business one instead.' : ''}`
    : 'Sign up with your business email, not a personal one.';
  const points = [
    idLine,
    'Turn on two-factor authentication, app-based where the service offers it.',
    'Record the account in this register: identity used, owner, 2FA method.',
  ];
  if (e.freeLimit) points.push(`Free tier: ${e.freeLimit}`);
  return points;
}
function buildGeneratorText(items, business) {
  const entries = generatorEntries(items);
  const lines = [`Sign-up list for ${business || 'your business'}, ${formatDate(todayIso())}.`, ''];
  for (const e of entries) {
    lines.push(e.name);
    for (const point of generatorChecklistPoints(e)) lines.push(`[ ] ${point}`);
    lines.push('');
  }
  lines.push(CE_LINE);
  return lines.join('\n');
}
function buildGeneratorSheetBody(items, business) {
  const entries = generatorEntries(items);
  return el('div', {},
    el('h1', {}, 'Sign-up list'),
    el('p', {}, `${business || 'Your business'}, generated ${formatDate(todayIso())}.`),
    ...entries.map((e) => el('div', { class: 'my-signup-sheet-item' },
      el('h2', {}, e.name),
      el('ul', {}, ...generatorChecklistPoints(e).map((point) => el('li', {}, point))),
    )),
    el('p', { class: 't-meta' }, CE_LINE),
  );
}
/** Prints the sign-up checklist via the same in-page sheet mechanism as
    printRecoverySheet (module comment above it): a `.my-print-sheet` node,
    a body class, `window.print()`, cleanup on `afterprint`. Never
    `window.open` (see printRecoverySheet's own comment for why that fails
    on mobile). */
function printGeneratorSheet(items, business) {
  const prev = document.querySelector('.my-print-sheet');
  if (prev) prev.remove();
  const sheet = el('div', { class: 'my-print-sheet' }, buildGeneratorSheetBody(items, business));
  document.body.appendChild(sheet);
  document.body.classList.add('my-printing-sheet');
  const cleanup = () => { sheet.remove(); document.body.classList.remove('my-printing-sheet'); };
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
}
async function copyGeneratorText(items, business) {
  const text = buildGeneratorText(items, business);
  try { await navigator.clipboard.writeText(text); showToast('Sign-up list copied.'); }
  catch { showToast('Copy failed: select and copy by hand instead.', 'error'); }
}

/* ============================================================================
   Reading-copy exports (PRD-REGISTER section 20, BUILD-PLAN 12.5): CSV, TXT
   and a print sheet, all pure builders over a document, no closures needed.
   Fields are exactly the section 4.2 list, deliberately excluding this
   codebase's own `shared` boolean (real, but not a 4.2 field, so section
   20's "the §4.2 fields the register holds and nothing else" excludes it).
   Never any secret; `mfa` is a method label, never a password (section 4.1,
   restated because every export surface restates it).
   ========================================================================= */
const REGISTER_FIELDS = ['id', 'service', 'url', 'toolId', 'identity', 'owner', 'admin', 'mfa', 'plan', 'renewal', 'monthlyCost', 'status', 'notes'];
const READING_COPY_LAW = 'This is a reading copy. It cannot be imported back into My Stack: only the register file (.fsr.json) can.';
/** OWASP formula-injection escaping (section 20, mandatory): any cell whose
    value starts with '=', '+', '-', '@' or a literal tab gets a leading
    apostrophe, so a spreadsheet reads it as text rather than a formula;
    every field is then double-quoted with internal quotes doubled. Register
    fields are free text a reader typed, and spreadsheets execute formulas:
    this is a section 9.2-grade escaping duty, not polish. */
function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t]/.test(s)) s = `'${s}`;
  s = s.replace(/"/g, '""');
  return `"${s}"`;
}
function buildCsv(doc) {
  const header = REGISTER_FIELDS.map(csvCell).join(',');
  const rows = doc.accounts.map((a) => REGISTER_FIELDS.map((f) => csvCell(a[f])).join(','));
  return [header, ...rows].map((line) => `${line}\r\n`).join(''); // CRLF, per section 20
}
/** Grouped like the register table (status, then service/identity/owner/2FA/
    renewal/notes), section 4.2 fields only, header line with business name
    and date, no markup: exactly section 20's own words for this format. */
function buildTxt(doc) {
  const lines = [`My Stack register: ${doc.business || 'Untitled register'}, ${formatDate(todayIso())}`, ''];
  for (const status of STATUS_OPTIONS) {
    const rows = doc.accounts.filter((a) => a.status === status);
    if (!rows.length) continue;
    lines.push(`${STATUS_LABEL[status]} (${rows.length})`);
    for (const a of rows) {
      lines.push(`- ${a.service || 'Untitled account'}`);
      lines.push(`  Identity: ${a.identity || 'Not recorded'}`);
      lines.push(`  Owner: ${a.owner || 'Not recorded'}`);
      lines.push(`  2FA: ${MFA_LABEL[a.mfa] || a.mfa || 'Not recorded'}`);
      lines.push(`  Renewal: ${a.renewal ? formatDate(a.renewal) : 'None'}`);
      if (a.notes) lines.push(`  Notes: ${a.notes}`);
      lines.push('');
    }
  }
  lines.push(READING_COPY_LAW);
  return lines.join('\n');
}
/** A clean tabular listing of the same content as buildTxt() above (section
    20's own words), grouped by status the same way, built through el() so
    every register field reaches the page via text nodes only. */
function buildReadingCopySheetBody(doc) {
  const groups = STATUS_OPTIONS
    .map((status) => ({ status, rows: doc.accounts.filter((a) => a.status === status) }))
    .filter((g) => g.rows.length);
  return el('div', {},
    el('h1', {}, 'My Stack register'),
    el('p', {}, `${doc.business || 'Untitled register'}, generated ${formatDate(todayIso())}.`),
    ...groups.map((g) => el('div', { class: 'my-readingcopy-group' },
      el('h2', {}, `${STATUS_LABEL[g.status]} (${g.rows.length})`),
      el('table', { class: 'my-readingcopy-table' },
        el('thead', {}, el('tr', {}, ...['Service', 'Identity', 'Owner', '2FA', 'Renewal', 'Notes'].map((h) => el('th', {}, h)))),
        el('tbody', {}, ...g.rows.map((a) => el('tr', {},
          el('td', {}, a.service || 'Untitled account'),
          el('td', {}, a.identity || 'Not recorded'),
          el('td', {}, a.owner || 'Not recorded'),
          el('td', {}, MFA_LABEL[a.mfa] || a.mfa || 'Not recorded'),
          el('td', {}, a.renewal ? formatDate(a.renewal) : 'None'),
          el('td', {}, a.notes || ''),
        ))),
      ),
    )),
    el('p', { class: 't-meta' }, READING_COPY_LAW),
  );
}
/** Same in-page print-sheet mechanism as printRecoverySheet/printGeneratorSheet
    above: never `window.open`. This is the "Print or save as PDF" path for
    the register itself (section 20), distinct from the sign-up generator's
    own print sheet, which prints a different set of tools entirely. */
function printReadingCopySheet(doc) {
  const prev = document.querySelector('.my-print-sheet');
  if (prev) prev.remove();
  const sheet = el('div', { class: 'my-print-sheet' }, buildReadingCopySheetBody(doc));
  document.body.appendChild(sheet);
  document.body.classList.add('my-printing-sheet');
  const cleanup = () => { sheet.remove(); document.body.classList.remove('my-printing-sheet'); };
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
}
function readingCopyFilename(business, ext) {
  const date = new Date().toISOString().slice(0, 10);
  return `mystack-register-${slugify(business)}-${date}.${ext}`;
}

/* ============================================================================
   Entry point
   ========================================================================= */
export async function renderWorkspace(root) {
  const state = {
    mode: 'loading',
    screen: 'overview',
    doc: null,
    expectedRevision: 0,
    example: false,
    plainMode: readPlainMode(),
    banner: null,
    mobileOpen: false,
    setup: null,
    lockUi: null,
    accountsUi: {
      search: '',
      filters: new Set(),   // active risk-filter keys, section 9.2
      selected: new Set(),  // account ids ticked for bulk owner edit
      openDrawerId: null,
      bulkOwnerValue: '',
      templatesOpen: false,
      templatesTicked: new Set(),
    },
    undo: null,        // { row, index, timer }: the last delete, undoable
    mergePreview: null, // { wantIds, haveIds, ticked, open }: ?from=/?have= against an EXISTING register
    // Batch add (section 17): null, or the three-step wizard's own state.
    // Reachable only from Accounts, so this stays a single slot rather than
    // per-screen state; commitBatch()/cancel both reset it to null.
    batchUi: null,
    // Sign-up generator (section 18): null, or { items, preSeed }, `items`
    // being the { tool, row } pairs the sheet was opened over. Rendered at
    // the shell level (see viewShell's container) so it stays visible
    // whichever of Accounts/My tools/the merge banner opened it.
    generatorUi: null,
    leaversUi: {
      person: '',            // selected from the distinct-owner dropdown
      customPerson: '',       // free text, for someone not in that list
      reassignDrafts: {},    // rowId -> in-progress reassign text, per section 9.5
    },
    costsUi: { mode: 'monthly' }, // section 9.4's one monthly/annual toggle
    backupUi: {
      dragOver: false,
      importFile: null,       // File currently picked/dropped, awaiting a decision
      importText: null,       // its text, read once and kept for a retry-with-passphrase
      importPreview: null,    // { document, encrypted, meta } | { needsPassphrase: true } | null
      importPassphrase: '',
      importError: null,
      importing: false,
      encFlow: null,          // null | 'consequence' | 'passphrase' | 'recovery' | 'verifying' | 'disable-consequence'
      encPassphrase1: '', encPassphrase2: '', encRecoveryDone: false, encError: null,
      wipeText: '',
      wipeError: null,
    },
  };

  // ?from= and ?have= (section 2, 9.7, 15.2, section 19): parsed exactly
  // like data-loader's own parseSelection (imported, not reimplemented), so
  // id 0 is exactly as valid here as anywhere else on the site. Resolving
  // either needs the tool catalogue, which this module fetches for itself
  // (an absolute path, so it resolves the same whether the visited path is
  // /my or /my/, unlike a relative fetch would). null = that param was not
  // present at all (or was over the 512-character cap, section 19's own
  // words: "treated as absent"); [] = present but named no tool ids this
  // catalogue recognises.
  const rawParams = new URLSearchParams(location.search);
  const RAW_PARAM_CAP = 512; // section 19: defensive parity with ?client='s 80-char cap
  function cappedRawParam(name) {
    const v = rawParams.get(name);
    return (v !== null && v.length <= RAW_PARAM_CAP) ? v : null;
  }
  const fromRaw = cappedRawParam('from');
  const haveRaw = cappedRawParam('have');
  // The Discover arrival marker (section 19): `have=` present in the URL AT
  // ALL, even as an empty string, is the signal that this is a hand-off from
  // the deck rather than a plain client-page "set up your workspace" link.
  // An over-length `have=` already folds into `haveRaw === null` above, so
  // it correctly reads as "no marker" (legacy behaviour), never a crash.
  const isDiscoverArrival = haveRaw !== null;
  let fromIds = null;
  let haveIds = null;
  let toolsCache = null;
  async function ensureTools() {
    if (!toolsCache) {
      const res = await fetch('/data/tools.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toolsCache = await res.json();
    }
    return toolsCache;
  }
  async function resolveImportIds() {
    if (fromRaw == null && haveRaw == null) return;
    try {
      const tools = await ensureTools();
      // PRD-REGISTER section 2/19 documents the "t:0,2,5" form; bare "0,2,5"
      // is what client.js and the Discover deck generate. Accept both, on
      // both parameters, by stripping the optional prefix before the one
      // shared parseSelection.
      if (fromRaw != null) fromIds = parseSelection(fromRaw.replace(/^t:/, ''), tools);
      if (haveRaw != null) haveIds = parseSelection(haveRaw.replace(/^t:/, ''), tools);
      // Belt and braces: a "want" id that is also a "have" id is a
      // contradiction the deck should never produce (skip/have/want are
      // mutually exclusive per judgement), but if a hand-crafted URL ever
      // does carry both, "already using it" wins over "want to try it".
      if (fromIds && fromIds.length && haveIds && haveIds.length) {
        const haveSet = new Set(haveIds);
        fromIds = fromIds.filter((id) => !haveSet.has(id));
      }
    } catch {
      // catalogue unreachable: degrade to "nothing to import", never block the workspace
      if (fromRaw != null) fromIds = [];
      if (haveRaw != null) haveIds = [];
    }
  }

  /** My tools (section 9.3) and Costs (section 9.4) both want the tool
      catalogue for names/descriptions/icons, but neither can await a fetch
      mid-render (view() is synchronous). Fire the fetch at most once, then
      redraw when it lands; a no-op once toolsCache is warm, which resolveImportIds()
      above may already have done for a ?from= or ?have= visit. */
  let toolsFetchStarted = false;
  function ensureToolsThenRedraw() {
    if (toolsCache || toolsFetchStarted) return;
    toolsFetchStarted = true;
    ensureTools().then(() => { if (state.mode === 'app') draw(); }).catch(() => { toolsFetchStarted = false; });
  }

  // Last known store.status() snapshot, since status() is async and the app
  // shell renders synchronously; refreshStatusNow() updates it deliberately
  // at mode transitions (so the Lock button etc. do not flash in a frame
  // late), and viewShell() below also refreshes it lazily on every redraw.
  let lastKnownStatus = { persisted: false, storageOk: true, locked: false, encrypted: false, revision: 0, lastExportAt: null, savesSinceExport: 0 };
  async function refreshStatusNow() {
    try { lastKnownStatus = await store.status(); } catch { /* keep the last known values */ }
  }

  if (typeof BroadcastChannel !== 'undefined') {
    const bc = new BroadcastChannel('freestack-my');
    bc.onmessage = (event) => {
      if (event?.data?.type === 'wipe') {
        // Another tab wiped the workspace: there is nothing left here worth
        // preserving state for, so a full reload is the honest response
        // rather than pretending this tab's in-memory copy still means
        // anything (mirrors how the example banner's "Start your own" exit
        // resets by re-entering first-run, just via a real reload here).
        location.reload();
        return;
      }
      if (event?.data?.type !== 'write') return;
      if (state.mode === 'app' && !state.example && event.data.revision !== state.expectedRevision) {
        state.banner = { kind: 'external-write' };
        draw();
      }
    };
  }

  /** Focus-preserving redraw (see the module comment above): captures
      whichever element currently has focus by its data-focus-key, and its
      text-selection range where that concept applies, then restores both
      after the wholesale rebuild. A no-op for the vast majority of clicks
      (nothing focused carries the attribute), which is why this is safe to
      make the ONE draw() every code path in this module already calls. */
  function draw() {
    const active = document.activeElement;
    const focusKey = active && active.dataset ? active.dataset.focusKey : null;
    const selStart = active && 'selectionStart' in active ? active.selectionStart : null;
    const selEnd = active && 'selectionEnd' in active ? active.selectionEnd : null;
    root.replaceChildren(view());
    if (!focusKey) return;
    let next = null;
    try { next = root.querySelector(`[data-focus-key="${focusKey}"]`); } catch { next = null; }
    if (!next) return;
    next.focus({ preventScroll: true });
    if (selStart != null && typeof next.setSelectionRange === 'function') {
      try { next.setSelectionRange(selStart, selEnd); } catch { /* date/number inputs do not support this */ }
    }
  }

  function view() {
    switch (state.mode) {
      case 'loading': return el('div', { class: 'app-message', 'aria-live': 'polite' }, 'Loading your workspace…');
      case 'webview-blocked': return viewWebviewBlocked();
      case 'storage-blocked': return viewStorageBlocked();
      case 'first-run': return viewFirstRun();
      case 'setup': return viewSetup();
      case 'locked': return viewLocked();
      case 'app': return viewShell();
      default: return el('div', { class: 'app-message is-error' }, 'Something unexpected happened. Reload the page.');
    }
  }

  /* --- gates: webview, then storage sentinel --------------------------------- */
  async function hasAnyDocument() {
    try { return (await store.load()) !== null; }
    catch { return true; } // any thrown error (locked, schema mismatch) still means something exists
  }

  async function boot() {
    if (isInAppWebview(navigator.userAgent) && !(await hasAnyDocument())) {
      state.mode = 'webview-blocked';
      draw();
      return;
    }
    const st = await store.status();
    if (!st.storageOk) {
      state.mode = 'storage-blocked';
      draw();
      return;
    }
    await resolveImportIds();
    await enterFromStorage();
  }

  async function enterFromStorage() {
    try {
      const doc = await store.load();
      if (doc === null) {
        state.mode = 'first-run';
      } else {
        state.doc = doc;
        state.expectedRevision = doc.revision;
        await refreshStatusNow(); // avoids a one-frame flash where the Lock button is briefly absent
        state.mode = 'app';
        state.screen = 'overview';
        await computeMergePreview();
      }
    } catch (err) {
      if (err instanceof store.LockedError) {
        state.mode = 'locked';
        state.lockUi = { passphrase: '', verifying: false, error: null };
      } else {
        state.mode = 'first-run';
        state.banner = { kind: 'load-error', message: err.message };
      }
    }
    draw();
  }

  /** Merge preview (section 2, 9.7, 15.2, section 19): a returning visitor
      arriving with ?from= and/or ?have= on a register that already exists.
      Only tools not already present by toolId are offered, so re-visiting
      the same shared link twice can never duplicate a row. Computed once on
      entry, not on every redraw, so dismissing it (or applying it) does not
      get recomputed back into existence a frame later. `wantIds` (from
      `from=`) and `haveIds` (from `have=`) are kept as separate lists so the
      review can group and default-status them differently (section 19:
      "have=" rows are always active; "from=" rows default planned only when
      the arrival marker, `have=`, is present in the URL at all). */
  async function computeMergePreview() {
    const hasWant = !!(fromIds && fromIds.length);
    const hasHave = !!(haveIds && haveIds.length);
    if ((!hasWant && !hasHave) || state.example) { state.mergePreview = null; return; }
    try {
      const tools = await ensureTools();
      const byId = new Map(tools.map((t) => [t.id, t]));
      const existingToolIds = new Set(state.doc.accounts.map((a) => a.toolId).filter((v) => v !== null && v !== undefined));
      const newWantIds = (fromIds || []).filter((id) => !existingToolIds.has(id) && byId.has(id));
      const newHaveIds = (haveIds || []).filter((id) => !existingToolIds.has(id) && byId.has(id));
      state.mergePreview = (newWantIds.length || newHaveIds.length)
        ? { wantIds: newWantIds, haveIds: newHaveIds, ticked: new Set([...newWantIds, ...newHaveIds]), open: false }
        : null;
    } catch {
      state.mergePreview = null;
    }
  }

  /* --------------------------------------------------------------------------
     Webview and storage gates
     ----------------------------------------------------------------------- */
  function viewWebviewBlocked() {
    const urlText = el('code', { class: 't-mono' }, location.href);
    const copyBtn = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Copy this address');
    copyBtn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(location.href); showToast('Address copied'); }
      catch { showToast('Copy failed: select and copy the address by hand', 'error'); }
    });
    return el('div', { class: 'my-gate' },
      el('div', { class: 'panel my-gate-panel' },
        el('p', { class: 'eyebrow' }, 'Open in your browser'),
        el('h1', {}, 'My Stack cannot be set up inside this app'),
        el('p', { class: 't-body' },
          'You opened this link inside another app\'s built-in browser (a webview), which is not safe for something you plan to keep. These in-app browsers can lose everything you enter without warning.'),
        el('p', { class: 't-body' }, 'Copy this address and open it in Safari, Chrome, Firefox or Edge instead:'),
        el('p', {}, urlText),
        copyBtn,
      ),
    );
  }

  function viewStorageBlocked() {
    const retryBtn = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Try again');
    retryBtn.addEventListener('click', boot);
    const exampleBtn = el('button', { class: 'btn btn-ghost', type: 'button' }, 'Explore an example register instead');
    exampleBtn.addEventListener('click', enterExample);
    return el('div', { class: 'my-gate' },
      el('div', { class: 'panel my-gate-panel my-gate-warn' },
        el('p', { class: 'eyebrow' }, 'Nothing will be remembered here'),
        el('h1', {}, 'This browser will not remember anything you enter'),
        el('p', { class: 't-body' },
          'Storage is unavailable here, most often because of private or incognito browsing. Setting up a register is blocked until you open this page in a normal browsing window.'),
        el('div', { class: 'my-gate-actions' }, retryBtn, exampleBtn),
      ),
    );
  }

  /* --------------------------------------------------------------------------
     First run
     ----------------------------------------------------------------------- */
  function defaultSetupState(fromStack) {
    return {
      step: 'name', business: '', wantsEncryption: null, passphrase1: '', passphrase2: '',
      error: null, recoveryDone: false, verifyOk: false, exportDone: false, blob: null, filename: '',
      // stackAccounts is the flat list actually saved (section 19: haveAccounts
      // then wantAccounts, so nothing depends on array order elsewhere); the
      // two group arrays exist only so setupReview can show "Already using
      // these" and "Want to try" as separate, clearly labelled groups.
      stackAccounts: [], haveAccounts: [], wantAccounts: [],
      templatesTicked: new Set(), fromStack: !!fromStack,
    };
  }

  function viewFirstRun() {
    const startBtn = el('button', { class: 'btn btn-primary btn-lg', type: 'button' }, 'Start your own register');
    startBtn.addEventListener('click', () => {
      state.mode = 'setup';
      state.setup = defaultSetupState(false);
      draw();
    });
    const exampleBtn = el('button', { class: 'btn btn-ghost btn-lg', type: 'button' }, 'Explore an example register');
    exampleBtn.addEventListener('click', enterExample);

    let stackChoice = null;
    const stackTotal = (fromIds ? fromIds.length : 0) + (haveIds ? haveIds.length : 0);
    if (stackTotal) {
      const stackBtn = el('button', { class: 'btn btn-primary btn-lg', type: 'button' },
        `Start from your stack (${stackTotal} tool${stackTotal === 1 ? '' : 's'})`);
      stackBtn.addEventListener('click', () => {
        state.mode = 'setup';
        state.setup = defaultSetupState(true);
        draw();
      });
      // Discover arrival (section 19): the want-list defaults to `planned`,
      // a deliberate difference the description states plainly rather than
      // leaving the reader to discover it on the review step.
      const desc = isDiscoverArrival
        ? 'Pre-fill your register from the tools you judged: the ones you already use land as active accounts, the ones you want to try land as planned, a note to sign up properly rather than an account that exists yet.'
        : 'Pre-fill one account row per tool from the link you followed here: service name and address filled in, identity and owner left for you to complete.';
      stackChoice = el('div', { class: 'my-firstrun-choice' },
        el('h3', {}, 'Start from your shared stack'),
        el('p', { class: 't-body' }, desc),
        stackBtn,
      );
    }

    return el('div', { class: 'my-firstrun' },
      el('header', { class: 'panel my-firstrun-header' },
        el('p', { class: 'eyebrow' }, 'My Stack'),
        el('h1', {}, 'Your account register'),
        el('p', { class: 't-lede' }, POSITIONING_SENTENCE),
      ),
      el('div', { class: 'panel my-firstrun-choices' },
        stackChoice,
        el('div', { class: 'my-firstrun-choice' },
          el('h3', {}, 'Start your own'),
          el('p', { class: 't-body' }, 'A few minutes: your business name, an optional passphrase, and a backup you keep.'),
          startBtn,
        ),
        el('div', { class: 'my-firstrun-choice' },
          el('h3', {}, 'Explore an example register'),
          el('p', { class: 't-body' }, 'A fictional coffee roastery, already filled in, so you can see what My Stack looks like before committing to anything. Nothing you see here is saved.'),
          exampleBtn,
        ),
      ),
      el('p', { class: 't-meta my-firstrun-privacy' },
        'Your register is ', STORAGE_PHRASE, '. Nothing you type is ever sent to Kaipability. ',
        el('a', { href: '/why-register.html', target: '_blank', rel: 'noopener noreferrer' }, 'Why we built this'),
        '. ',
        el('a', { href: '/privacy.html', target: '_blank', rel: 'noopener noreferrer' }, 'Privacy'),
        ' · ',
        el('a', { href: '/contact.html', target: '_blank', rel: 'noopener noreferrer' }, 'Contact'),
        '.'),
    );
  }

  function enterExample() {
    state.example = true;
    state.doc = sampleDocument();
    state.expectedRevision = state.doc.revision;
    state.mergePreview = null;
    state.mode = 'app';
    state.screen = 'overview';
    draw();
  }

  /* --------------------------------------------------------------------------
     Setup wizard
     ----------------------------------------------------------------------- */
  function labelledInput(labelText, inputAttrs, onInput, initialValue) {
    const input = el('input', { class: 'input', ...inputAttrs, value: initialValue ?? '' });
    input.addEventListener('input', () => onInput(input.value));
    return el('label', { class: 'my-field' }, el('span', { class: 't-small' }, labelText), input);
  }

  function viewSetup() {
    const s = state.setup;
    switch (s.step) {
      case 'name': return setupName(s);
      case 'review': return setupReview(s);
      case 'encrypt-choice': return setupEncryptChoice(s);
      case 'consequence': return setupConsequence(s);
      case 'passphrase': return setupPassphrase(s);
      case 'recovery': return setupRecovery(s);
      case 'export': return setupExport(s);
      case 'verify-pending': return setupWrap('Verifying', el('h1', {}, 'Saving and verifying your register…'), el('p', { class: 't-body' }, 'This takes a moment.'));
      default: return setupName(s);
    }
  }

  function setupWrap(stepLabel, ...children) {
    return el('div', { class: 'my-setup' },
      el('div', { class: 'panel my-setup-panel' },
        el('p', { class: 'eyebrow' }, `Setting up · ${stepLabel}`),
        ...children,
      ),
    );
  }

  function setupName(s) {
    const nameField = labelledInput('Business name', { type: 'text', autofocus: true, placeholder: 'e.g. Harbour & Vine Coffee Roasters' }, (v) => { s.business = v; }, s.business);
    const err = s.error ? el('p', { class: 'my-error', role: 'alert' }, s.error) : null;
    const next = el('button', { class: 'btn btn-primary', type: 'button' }, 'Continue');
    next.addEventListener('click', () => {
      if (!s.business || s.business.trim().length < 2) { s.error = 'Enter your business name to continue.'; draw(); return; }
      s.business = s.business.trim();
      s.error = null;
      if (s.fromStack) {
        // Section 19: "have=" rows are always active, "from=" rows default
        // active UNLESS the arrival marker (have=, even empty) is present in
        // the URL, in which case they default planned ("want to try"). Either
        // list may be empty (a stack link can be all-want or all-have).
        const tools = toolsCache || [];
        const byId = new Map(tools.map((t) => [t.id, t]));
        const wantStatus = isDiscoverArrival ? 'planned' : 'active';
        s.haveAccounts = (haveIds || []).map((id) => byId.get(id)).filter((t) => t !== undefined).map((t) => buildRowFromTool(t, 'active'));
        s.wantAccounts = (fromIds || []).map((id) => byId.get(id)).filter((t) => t !== undefined).map((t) => buildRowFromTool(t, wantStatus));
        s.stackAccounts = [...s.haveAccounts, ...s.wantAccounts];
      } else {
        s.haveAccounts = [];
        s.wantAccounts = [];
        s.stackAccounts = [];
      }
      s.step = 'review';
      draw();
    });
    return setupWrap('Your business', el('h1', {}, 'What is this register for?'), nameField, err, next);
  }

  /** Section 9.7's "sovereign row suggestions", plus (Wave B) a preview of
      any stack-import rows already decided on the previous step: "shows
      what will be added before applying" in spirit, even though at setup
      there is nothing yet to conflict with. Ticking here never invents
      identity or owner facts (section 4.3: sovereign rows are suggestions,
      never auto-created), only adds a named, mostly-blank row. */
  function setupReview(s) {
    const back = el('button', { class: 'btn btn-ghost', type: 'button' }, 'Back');
    back.addEventListener('click', () => { s.step = 'name'; draw(); });
    const cont = el('button', { class: 'btn btn-primary', type: 'button' }, 'Continue');
    cont.addEventListener('click', () => { s.step = 'encrypt-choice'; draw(); });

    // Section 19: grouped so a "want to try" plan never mixes silently with
    // an account already in genuine use, exactly as the "To sign up" group
    // does later on the Accounts screen for the same reason.
    function stackGroup(titleText, rows, note) {
      if (!rows.length) return null;
      return el('div', { class: 'my-review-block' },
        el('p', { class: 't-small' }, `${titleText} (${rows.length}):`),
        note ? el('p', { class: 't-meta' }, note) : null,
        el('ul', { class: 'my-attention-list' }, ...rows.map((r) => el('li', {}, r.service))),
      );
    }
    const haveBlock = stackGroup('Already using these', s.haveAccounts,
      'Added as active accounts. Fill in who and what identity opened each one when you have a moment.');
    const wantBlock = s.fromStack && isDiscoverArrival
      ? stackGroup('Want to try', s.wantAccounts, 'Added as planned: a note to sign up properly, not an account yet.')
      : stackGroup('From your shared stack', s.wantAccounts, null);
    const stackList = (haveBlock || wantBlock) ? el('div', {}, haveBlock, wantBlock) : null;

    const templateRows = SOVEREIGN_TEMPLATES.map((tpl) => {
      const id = `setup-tpl-${tpl.key}`;
      const cb = el('input', { type: 'checkbox', id, checked: s.templatesTicked.has(tpl.key) });
      cb.addEventListener('change', () => { if (cb.checked) s.templatesTicked.add(tpl.key); else s.templatesTicked.delete(tpl.key); });
      return el('label', { class: 'my-template-row', for: id }, cb, el('span', {}, tpl.service));
    });

    return setupWrap('Accounts to start with',
      el('h1', {}, 'A few accounts every business has'),
      stackList,
      el('p', { class: 't-body' }, 'Tick any of these that apply. You can add, edit or remove any account later.'),
      ...templateRows,
      el('div', { class: 'my-setup-actions' }, back, cont),
    );
  }

  function setupEncryptChoice(s) {
    const yesBtn = el('button', { class: 'btn btn-primary', type: 'button' }, 'Yes, set a passphrase');
    yesBtn.addEventListener('click', () => { s.wantsEncryption = true; s.step = 'consequence'; draw(); });
    const noBtn = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Not now');
    noBtn.addEventListener('click', async () => {
      s.wantsEncryption = false;
      await commitInitialSave(s, null);
    });
    return setupWrap('Passphrase (optional)',
      el('h1', {}, 'Protect this register with a passphrase?'),
      el('p', { class: 't-body' }, 'Off by default. A passphrase encrypts the register on this device, on top of it being ', STORAGE_PHRASE, '. You can turn this on later from Backup instead, if you would rather decide now.'),
      el('div', { class: 'my-setup-actions' }, yesBtn, noBtn),
    );
  }

  function setupConsequence(s) {
    const back = el('button', { class: 'btn btn-ghost', type: 'button' }, 'Back');
    back.addEventListener('click', () => { s.step = 'encrypt-choice'; draw(); });
    const cont = el('button', { class: 'btn btn-primary', type: 'button' }, 'I understand, continue');
    cont.addEventListener('click', () => { s.step = 'passphrase'; draw(); });
    return setupWrap('Passphrase',
      el('h1', {}, 'Before you set a passphrase'),
      el('p', { class: 'my-consequence' }, CONSEQUENCE_SENTENCE),
      el('div', { class: 'my-setup-actions' }, back, cont),
    );
  }

  function setupPassphrase(s) {
    const p1 = labelledInput('Passphrase', { type: 'password', autocomplete: 'new-password' }, (v) => { s.passphrase1 = v; }, s.passphrase1);
    const p2 = labelledInput('Enter it again', { type: 'password', autocomplete: 'new-password' }, (v) => { s.passphrase2 = v; }, s.passphrase2);
    const err = s.error ? el('p', { class: 'my-error', role: 'alert' }, s.error) : null;
    const back = el('button', { class: 'btn btn-ghost', type: 'button' }, 'Back');
    back.addEventListener('click', () => { s.step = 'consequence'; draw(); });
    const cont = el('button', { class: 'btn btn-primary', type: 'button' }, 'Continue');
    cont.addEventListener('click', () => {
      if (s.passphrase1.length < MIN_PASSPHRASE) { s.error = `Use at least ${MIN_PASSPHRASE} characters.`; draw(); return; }
      if (s.passphrase1 !== s.passphrase2) { s.error = 'Those two do not match.'; draw(); return; }
      s.error = null;
      s.step = 'recovery';
      draw();
    });
    return setupWrap('Passphrase', el('h1', {}, 'Choose a passphrase'), p1, p2, err, el('div', { class: 'my-setup-actions' }, back, cont));
  }

  function setupRecovery(s) {
    const html = buildRecoverySheetHtml(s.business, todayIso());
    const status = s.recoveryDone ? el('p', { class: 'my-ok' }, 'Recovery sheet saved.') : null;
    const dl = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Download recovery sheet');
    dl.addEventListener('click', () => {
      downloadBlob(new Blob([html], { type: 'text/html' }), `mystack-recovery-sheet-${slugify(s.business)}.html`);
      s.recoveryDone = true;
      draw();
    });
    const pr = el('button', { class: 'btn btn-ghost', type: 'button' }, 'Print recovery sheet');
    pr.addEventListener('click', () => {
      printRecoverySheet(s.business);
      s.recoveryDone = true;
      draw();
    });
    const cont = el('button', { class: 'btn btn-primary', type: 'button', disabled: !s.recoveryDone }, "I've saved my recovery sheet");
    cont.addEventListener('click', async () => {
      if (!s.recoveryDone) return;
      s.step = 'verify-pending';
      await commitInitialSave(s, s.passphrase1);
    });
    return setupWrap('Recovery sheet',
      el('h1', {}, 'Save a recovery sheet'),
      el('p', { class: 't-body' }, 'My Stack never stores your passphrase, so this sheet is the only backstop if you forget it. Write your passphrase on it by hand, then keep it somewhere safe and separate from this device.'),
      el('div', { class: 'my-setup-actions' }, dl, pr),
      status,
      cont,
    );
  }

  /** Writes the initial document (encrypted if passphrase is not null),
      then silently exports and re-imports it to verify the round trip
      before anything is declared done, per section 8 (and, for the
      encrypted path, section 7's required test-decrypt). The initial
      account list (Wave B) is whatever stack-import rows and ticked
      sovereign templates the reader chose at the review step; an empty
      array when neither applies, exactly as before. */
  async function commitInitialSave(s, passphrase) {
    state.mode = 'setup';
    s.step = 'verify-pending';
    s.error = null;
    draw();
    try {
      if (passphrase) await store.unlock(passphrase); // chooses the passphrase: see store.js's unlock() doc comment
      const accounts = [
        ...(s.stackAccounts || []),
        ...SOVEREIGN_TEMPLATES.filter((tpl) => s.templatesTicked.has(tpl.key)).map((tpl) => templateToRow(tpl, newId)),
      ];
      const doc = { business: s.business, people: [], accounts };
      const saved = await store.save(doc, 0);
      state.doc = saved;
      state.expectedRevision = saved.revision;

      const { blob } = await store.exportBlob();
      const text = await blob.text();
      const imported = await store.importBlob(text, passphrase || undefined);
      const roundTripOk = imported.document.business === s.business && imported.document.accounts.length === accounts.length;
      if (!roundTripOk) throw new Error('The verification re-import did not match what was saved.');

      s.verifyOk = true;
      s.blob = blob;
      s.filename = exportFilename(s.business);
      s.step = 'export';
    } catch (err) {
      s.step = passphrase ? 'passphrase' : 'encrypt-choice';
      s.error = err.message || 'Something went wrong saving your register. Try again.';
    }
    draw();
  }

  function setupExport(s) {
    if (s.step !== 'export') return el('div', { class: 'app-message' }, 'Verifying…');
    const dl = el('button', { class: 'btn btn-primary btn-lg', type: 'button' }, 'Download your register file');
    dl.addEventListener('click', () => {
      downloadBlob(s.blob, s.filename);
      s.exportDone = true;
      draw();
    });
    const finish = el('button', { class: 'btn btn-secondary', type: 'button', disabled: !s.exportDone }, 'Finish setup');
    finish.addEventListener('click', async () => {
      if (!s.exportDone) return;
      await refreshStatusNow(); // avoids a one-frame flash where the Lock button is briefly absent
      state.example = false;
      state.mode = 'app';
      state.screen = 'overview';
      state.setup = null;
      draw();
    });
    return setupWrap('Verified backup',
      el('h1', {}, 'Your register is verified and ready'),
      el('p', { class: 'my-ok' }, 'Your register file was saved, exported and read back successfully: the round trip checks out.'),
      el('p', { class: 't-body' }, `Filename: `, el('code', { class: 't-mono' }, s.filename), '. Keep it somewhere you would find it again: a backed-up folder, cloud storage, or emailed to yourself.'),
      dl,
      el('p', { class: 't-meta' }, s.exportDone ? 'Downloaded. You can finish setup now.' : 'Download the file above before finishing setup.'),
      finish,
    );
  }

  /* --------------------------------------------------------------------------
     Lock screen
     ----------------------------------------------------------------------- */
  function viewLocked() {
    const l = state.lockUi;
    const input = el('input', { class: 'input', type: 'password', autocomplete: 'current-password', autofocus: true, placeholder: 'Passphrase' });
    input.addEventListener('input', () => { l.passphrase = input.value; });
    const err = l.error ? el('p', { class: 'my-error', role: 'alert' }, l.error) : null;
    const btn = el('button', { class: 'btn btn-primary', type: 'button', disabled: l.verifying }, l.verifying ? 'Unlocking…' : 'Unlock');
    btn.addEventListener('click', async () => {
      l.verifying = true;
      l.error = null;
      draw();
      try {
        await store.unlock(l.passphrase);
        await enterFromStorage();
      } catch (err2) {
        l.verifying = false;
        l.error = err2.message || 'Could not unlock: wrong passphrase, or this file is damaged.';
        draw();
      }
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
    return el('div', { class: 'my-gate' },
      el('div', { class: 'panel my-gate-panel' },
        el('p', { class: 'eyebrow' }, 'My Stack'),
        el('h1', {}, 'This register is locked'),
        el('p', { class: 't-body' }, 'Enter your passphrase to unlock it for this session.'),
        el('label', { class: 'my-field' }, el('span', { class: 't-small' }, 'Passphrase'), input),
        err,
        btn,
      ),
    );
  }

  /* --------------------------------------------------------------------------
     Account mutations: every one flows load (state.doc, already in memory)
     -> mutate a clone -> store.save(clone, expectedRevision), per section 6.
     A rejected save (ConflictError, section 6/9) shows the same reload
     offer the BroadcastChannel path already shows: this module never tries
     to merge two edits itself. mutateDoc() resolves to null rather than
     rejecting on a handled failure (already shown as a banner or toast),
     specifically so none of its many call sites below need their own
     try/catch just to avoid an unhandled rejection; each one only checks
     the truthy/null result when it has actual follow-up work to skip (for
     example, not opening a drawer for a row that never actually saved).
     The example register never reaches here in practice (its CRUD
     affordances are not rendered), but the guard is kept as a second line
     of defence rather than trusting that alone.
     ----------------------------------------------------------------------- */
  async function mutateDoc(mutator) {
    if (state.example) {
      state.doc = mutator(cloneDoc(state.doc));
      draw();
      return state.doc;
    }
    const next = mutator(cloneDoc(state.doc));
    try {
      const saved = await store.save(next, state.expectedRevision);
      state.doc = saved;
      state.expectedRevision = saved.revision;
      draw();
      return saved;
    } catch (err) {
      if (err instanceof store.ConflictError) {
        state.banner = { kind: 'external-write' };
        draw();
      } else {
        showToast(err.message || 'Could not save that change.', 'error');
      }
      return null;
    }
  }

  async function addAccount(overrides) {
    const row = blankAccount(overrides);
    const saved = await mutateDoc((doc) => { doc.accounts.push(row); return doc; });
    if (saved) { state.accountsUi.openDrawerId = row.id; draw(); } // straight into editing: an empty row alone is not useful
    return row;
  }
  async function updateAccountField(id, field, value) {
    await mutateDoc((doc) => {
      const row = doc.accounts.find((a) => a.id === id);
      if (row) row[field] = value;
      return doc;
    });
  }
  async function bulkSetOwner(ids, owner) {
    const saved = await mutateDoc((doc) => {
      for (const a of doc.accounts) if (ids.has(a.id)) a.owner = owner;
      return doc;
    });
    if (saved) { state.accountsUi.selected.clear(); state.accountsUi.bulkOwnerValue = ''; }
  }
  async function addTemplates(keys) {
    await mutateDoc((doc) => {
      for (const tpl of SOVEREIGN_TEMPLATES) if (keys.has(tpl.key)) doc.accounts.push(templateToRow(tpl, newId));
      return doc;
    });
  }
  /** Commits the ticked ids from a merge preview (section 15.2, section 19)
      in ONE store.save() for the whole batch, whichever mix of "want" and
      "have" ids was ticked: never N saves for N rows, and never a second
      pass that could see a revision the first pass already moved past.
      `mp.wantIds` default to `planned` only on a Discover arrival, exactly
      the same rule setupName's continue handler applies at first run;
      `mp.haveIds` are always `active`. */
  async function applyMerge(mp, tickedIds) {
    const tools = toolsCache || [];
    const byId = new Map(tools.map((t) => [t.id, t]));
    const wantStatus = isDiscoverArrival ? 'planned' : 'active';
    state.mergePreview = null; // clears the instant the matching rows land, not a frame later
    const saved = await mutateDoc((doc) => {
      const existingToolIds = new Set(doc.accounts.map((a) => a.toolId).filter((v) => v !== null && v !== undefined));
      function addTicked(ids, status) {
        for (const id of ids) {
          if (!tickedIds.has(id) || existingToolIds.has(id)) continue; // never duplicates, per section 15.2
          const tool = byId.get(id);
          if (!tool) continue;
          doc.accounts.push(buildRowFromTool(tool, status));
          existingToolIds.add(id);
        }
      }
      addTicked(mp.haveIds, 'active');
      addTicked(mp.wantIds, wantStatus);
      return doc;
    });
    if (saved) showToast('Accounts added from your shared stack.');
  }

  /** Batch add commit (section 17, BUILD-PLAN 12.5): ONE store.save() for
      the whole batch, whichever mix of catalogue tools, sovereign templates
      and free-text names was ticked, sharing the one identity/owner/mfa/
      plan/status entered at step 2. Never N saves for N rows; per-row
      overrides happen afterwards through the existing drawer, unchanged. */
  async function commitBatch(items, shared) {
    const rows = items.map((it) => buildBatchRow(it, shared));
    const saved = await mutateDoc((doc) => { doc.accounts.push(...rows); return doc; });
    if (saved) {
      showToast(`Added ${rows.length} account${rows.length === 1 ? '' : 's'}.`);
      state.batchUi = null;
      draw();
    }
    return saved;
  }

  /** Sign-up generator (section 18, BUILD-PLAN 12.5): opens the in-app sheet
      over a set of { tool, row } pairs. Reached from Accounts (the "To sign
      up" group or a row selection), My tools (imported tools still only
      planned) and the merge banner's want-list (a Discover arrival's "want
      to try" ids, before any row exists for them). */
  function openGenerator(items) {
    const valid = (items || []).filter((it) => it && (it.tool || it.row));
    if (!valid.length) { showToast('Nothing to build a sign-up list from.', 'error'); return; }
    state.generatorUi = { items: valid, preSeed: false };
    draw();
  }
  function closeGenerator() { state.generatorUi = null; draw(); }

  /** Pre-seed (section 18, opt-in, off by default): ONE store.save() creates
      a `planned` row per generator item whose tool is not already linked to
      an existing account by `toolId` (a Set membership check, never a
      truthiness test, so tool id 0 is never skipped and never duplicated).
      A generator item with no catalogue tool (a manual account) cannot be
      pre-seeded, since there is no `toolId` to dedupe or create a row from. */
  async function preSeedGeneratorItems(items) {
    const candidates = (items || []).filter((it) => it.tool && Number.isInteger(it.tool.id));
    if (!candidates.length) return null;
    const saved = await mutateDoc((doc) => {
      const existingToolIds = new Set(doc.accounts.map((a) => a.toolId).filter((v) => v !== null && v !== undefined));
      for (const it of candidates) {
        if (existingToolIds.has(it.tool.id)) continue; // never a duplicate toolId row, id 0 included
        doc.accounts.push(buildRowFromTool(it.tool, 'planned'));
        existingToolIds.add(it.tool.id);
      }
      return doc;
    });
    return saved;
  }

  /** Delete with undo (no confirm modal, per the brief): the row is removed
      and saved immediately (the store law: mutations persist, they do not
      wait in limbo), and "Undo" is a second, equally real mutation that
      re-inserts the exact row rather than a client-side pretend-undo. */
  function showUndo(row, index) {
    if (state.undo?.timer) clearTimeout(state.undo.timer);
    const timer = setTimeout(() => { state.undo = null; draw(); }, 8000);
    state.undo = { row, index, timer };
    draw();
  }
  async function deleteAccount(id) {
    const row = state.doc.accounts.find((a) => a.id === id);
    if (!row) return;
    const index = state.doc.accounts.indexOf(row);
    const saved = await mutateDoc((doc) => { doc.accounts = doc.accounts.filter((a) => a.id !== id); return doc; });
    if (!saved) return; // the delete never actually persisted: nothing to offer undo for
    state.accountsUi.selected.delete(id);
    if (state.accountsUi.openDrawerId === id) state.accountsUi.openDrawerId = null;
    showUndo(row, index);
  }
  async function undoDelete() {
    if (!state.undo) return;
    const { row, index } = state.undo;
    clearTimeout(state.undo.timer);
    state.undo = null;
    await mutateDoc((doc) => {
      const at = Math.min(index, doc.accounts.length);
      doc.accounts.splice(at, 0, row);
      return doc;
    });
  }

  /* --------------------------------------------------------------------------
     App shell
     ----------------------------------------------------------------------- */
  function label(key) {
    const PLAIN = {
      overview: ['Overview', 'The big picture'],
      accounts: ['Accounts', 'Your accounts'],
      recorded: ['Accounts recorded', 'How many accounts you have written down'],
      backupAge: ['Backup age', 'How old your last backup is'],
    };
    return state.plainMode && PLAIN[key] ? PLAIN[key][1] : (PLAIN[key] ? PLAIN[key][0] : key);
  }

  function navigate(screen) {
    state.screen = screen;
    state.mobileOpen = false;
    draw();
  }
  function goAccounts(filterKey) {
    state.accountsUi.filters = filterKey ? new Set([filterKey]) : new Set();
    navigate('accounts');
  }

  function viewShell() {
    const doc = state.doc;
    const currentStatus = state.example ? sampleStatus() : lastKnownStatus;
    const nav = el('nav', { class: 'my-nav', 'aria-label': 'My Stack sections' },
      ...SIDEBAR.map(([id, text]) => {
        const current = state.screen === id;
        const shown = id === 'overview' ? label('overview') : id === 'accounts' ? label('accounts') : text;
        const item = el('a', {
          href: '#', class: 'my-nav-item', 'aria-current': current ? 'page' : false,
        }, shown);
        item.addEventListener('click', (e) => { e.preventDefault(); navigate(id); });
        return item;
      }),
    );

    const plainBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-pressed': String(state.plainMode) }, 'Plain English');
    plainBtn.addEventListener('click', () => {
      state.plainMode = !state.plainMode;
      writePlainMode(state.plainMode);
      draw();
    });

    let lockBtn = null;
    if (currentStatus.encrypted && !state.example) {
      lockBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, 'Lock');
      lockBtn.addEventListener('click', () => {
        store.lock();
        state.mode = 'locked';
        state.lockUi = { passphrase: '', verifying: false, error: null };
        draw();
      });
    }

    // Backup-age indicator, sidebar footer (section 8, also repeated on the
    // Backup screen itself below): a real button, not decoration alone, so
    // it doubles as a one-tap jump straight to Backup from anywhere.
    const ageInfo = backupAgeInfo(currentStatus.lastExportAt, currentStatus.savesSinceExport);
    const ageChip = el('button', { class: `my-age-chip my-age-chip-${ageInfo.level}`, type: 'button' }, ageInfo.text);
    ageChip.addEventListener('click', () => navigate('backup'));

    const sidebarFoot = el('div', { class: 'my-sidebar-foot' }, ageChip, plainBtn, themeToggleButton('btn-ghost btn-sm'), lockBtn);

    const menuBtn = el('button', { class: 'btn btn-ghost my-menu-toggle', type: 'button', 'aria-expanded': String(state.mobileOpen), 'aria-label': 'Menu' }, 'Menu');
    menuBtn.addEventListener('click', () => { state.mobileOpen = !state.mobileOpen; draw(); });

    // no-print (section 9.5/print stylesheet): when a screen is printed
    // (the Leavers checklist is the case this actually matters for), the
    // shell chrome around it has no business on the page, so it reuses the
    // site-wide .no-print rule rather than a bespoke workspace-only one.
    const sidebar = el('div', { class: `my-sidebar no-print${state.mobileOpen ? ' is-open' : ''}` },
      el('div', { class: 'my-sidebar-brand' }, el('p', { class: 'eyebrow' }, 'My Stack')),
      nav,
      sidebarFoot,
    );

    const exampleBanner = state.example ? el('div', { class: 'my-banner my-banner-example no-print', role: 'status' },
      'This is an example register. Nothing here is saved. ',
      (() => { const b = el('button', { class: 'btn btn-sm btn-primary', type: 'button' }, 'Start your own'); b.addEventListener('click', () => { state.example = false; state.doc = null; state.mode = 'first-run'; draw(); }); return b; })(),
    ) : null;

    const reloadBanner = state.banner?.kind === 'external-write' ? el('div', { class: 'my-banner my-banner-reload no-print', role: 'alert' },
      'This register changed in another tab. ',
      (() => { const b = el('button', { class: 'btn btn-sm btn-secondary', type: 'button' }, 'Reload'); b.addEventListener('click', () => location.reload()); return b; })(),
    ) : null;

    const mergeBanner = (!state.example && state.mergePreview) ? renderMergeBanner() : null;

    const undoBanner = state.undo ? el('div', { class: 'my-banner my-banner-undo no-print', role: 'status' },
      `Deleted ${state.undo.row.service || 'that account'}. `,
      (() => { const b = el('button', { class: 'btn btn-sm btn-secondary', type: 'button' }, 'Undo'); b.addEventListener('click', () => undoDelete()); return b; })(),
    ) : null;

    // Nag banner (section 8): non-modal, persistent while the age indicator
    // reads red, distinct from the sidebar chip so it cannot be missed on
    // whichever screen the reader currently has open; hidden on the Backup
    // screen itself since its own age indicator already says the same thing.
    const nagBanner = (!state.example && ageInfo.level === 'red' && state.screen !== 'backup')
      ? el('div', { class: 'my-banner my-banner-nag no-print', role: 'status' },
        `${ageInfo.text}. `,
        (() => { const b = el('button', { class: 'btn btn-sm btn-secondary', type: 'button' }, 'Go to Backup'); b.addEventListener('click', () => navigate('backup')); return b; })(),
      ) : null;

    const searchInput = el('input', {
      class: 'input my-topbar-search', type: 'search', placeholder: 'Search accounts…', 'aria-label': 'Search accounts (service, identity, owner, notes)',
      value: state.accountsUi.search, dataset: { focusKey: 'accounts-search' },
    });
    searchInput.addEventListener('input', () => { state.accountsUi.search = searchInput.value; draw(); });

    const topbar = el('div', { class: 'my-topbar no-print' },
      menuBtn,
      el('h1', { class: 'my-topbar-name' }, doc.business || 'Untitled register'),
      searchInput,
    );

    const main = el('main', { class: 'my-main' }, screenView());

    function screenView() {
      switch (state.screen) {
        case 'overview': return screenOverview();
        case 'accounts': return screenAccounts();
        case 'my-tools': return screenMyTools();
        case 'costs': return screenCosts();
        case 'leavers': return screenLeavers();
        case 'backup': return screenBackup();
        default: return placeholderScreen(state.screen, '');
      }
    }

    function placeholderScreen(title, body) {
      return el('section', { class: 'my-screen' }, el('h2', {}, title), el('p', { class: 't-body' }, body));
    }

    /* --- Overview: risk and status tiles (section 9.1) -------------------- */
    function screenOverview() {
      const st = currentStatus;
      const age = backupAgeInfo(st.lastExportAt, st.savesSinceExport);
      const accounts = doc.accounts;
      // Section 16: "an account that does not exist yet is a plan, not a
      // risk". Every risk tile below, and the no-owner attention bucket
      // further down, is computed over non-planned rows only; "accounts
      // recorded" (the first tile) still counts every row, planned included.
      const riskAccounts = accounts.filter((a) => a.status !== 'planned');
      const counts = {
        'personal-email': riskAccounts.filter((a) => isPersonalEmail(a.identity)).length,
        'no-mfa': riskAccounts.filter((a) => mfaRiskLabel(a.mfa) !== null).length,
        'no-owner': riskAccounts.filter((a) => hasNoOwner(a.owner)).length,
        'renewing-soon': riskAccounts.filter((a) => isRenewalSoon(a.renewal)).length,
      };
      // Two value treatments share one tile shell (Rocky's phone-test fix):
      // a short number reads as the big stat-numeral style; anything textual
      // (the backup-age tile's status sentence today, whatever else might
      // ever carry a long string tomorrow) gets the sentence-scale modifier
      // instead, so a run of prose never inherits 34px numeral typography.
      // The check is on the JS value's type, not the tile's identity, so the
      // treatment follows the data rather than a hardcoded tile name.
      function tile(value, labelText, level, onClick) {
        const isTextValue = typeof value !== 'number';
        const btn = el('button', { class: `panel my-tile${level ? ` my-tile-${level}` : ''}`, type: 'button' },
          el('span', { class: `my-tile-value${isTextValue ? ' my-tile-value--text' : ''}` }, String(value)),
          el('span', { class: 'my-tile-label' }, labelText));
        btn.addEventListener('click', onClick);
        return btn;
      }
      const tiles = [
        tile(accounts.length, label('recorded'), null, () => goAccounts(null)),
        tile(counts['personal-email'], 'On personal email', counts['personal-email'] ? 'amber' : 'ok', () => goAccounts('personal-email')),
        tile(counts['no-mfa'], 'No 2FA recorded', counts['no-mfa'] ? 'amber' : 'ok', () => goAccounts('no-mfa')),
        tile(counts['no-owner'], 'No owner', counts['no-owner'] ? 'amber' : 'ok', () => goAccounts('no-owner')),
        tile(counts['renewing-soon'], 'Renewing in 60 days', counts['renewing-soon'] ? 'amber' : 'ok', () => goAccounts('renewing-soon')),
        tile(age.text, label('backupAge'), age.level, () => navigate('backup')),
      ];

      // "Unassigned attention bucket" (section 9.1): rows with no owner
      // surface here rather than rotting quietly in the table, each with a
      // one-tap jump straight to that row's drawer. Planned rows excluded
      // for the same reason as the tiles above (section 16).
      const noOwnerRows = riskAccounts.filter((a) => hasNoOwner(a.owner));
      const attention = noOwnerRows.length ? el('div', { class: 'panel my-attention' },
        el('h3', {}, 'Needs an owner'),
        el('p', { class: 't-body' }, 'Nobody is down as the owner for these accounts yet.'),
        el('ul', { class: 'my-attention-list' }, ...noOwnerRows.map((a) => {
          const btn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, `Assign owner: ${a.service || 'Untitled account'}`);
          btn.addEventListener('click', () => {
            state.accountsUi.filters = new Set(['no-owner']);
            state.accountsUi.openDrawerId = a.id;
            navigate('accounts');
          });
          return el('li', {}, btn);
        })),
      ) : null;

      return el('section', { class: 'my-screen' },
        el('h2', {}, 'Overview'),
        el('p', { class: 't-lede my-quote' }, POSITIONING_SENTENCE),
        el('div', { class: 'my-tiles' }, ...tiles),
        attention,
      );
    }

    /* --- Accounts: the register (section 9.2) ------------------------------ */
    function screenAccounts() {
      // The drawer's tool-name line and Phase 22 exposure note both read
      // toolsCache; fetch it here too so a reader who lands straight on
      // Accounts (rather than My tools or Costs first) still sees them once
      // it lands, not only "tool id N" until they happen to visit elsewhere.
      ensureToolsThenRedraw();
      const ui = state.accountsUi;
      const readOnly = state.example;
      const accounts = doc.accounts;

      const chipButtons = Object.entries(RISK_FILTERS).map(([key, def]) => {
        const active = ui.filters.has(key);
        const btn = el('button', { class: `my-chip-filter${active ? ' is-active' : ''}`, type: 'button', 'aria-pressed': String(active) }, def.label);
        btn.addEventListener('click', () => {
          if (ui.filters.has(key)) ui.filters.delete(key); else ui.filters.add(key);
          draw();
        });
        return btn;
      });
      const filterBar = el('div', { class: 'my-filter-bar', role: 'group', 'aria-label': 'Filter accounts by risk' }, ...chipButtons);

      const filtered = accounts.filter((a) => {
        for (const key of ui.filters) if (!RISK_FILTERS[key].test(a)) return false;
        return matchesSearch(a, ui.search);
      });
      // Section 16: planned rows never mix silently into the live register,
      // so they render in their own "To sign up" group below rather than
      // interleaved into the main table row for row.
      const liveFiltered = filtered.filter((a) => a.status !== 'planned');
      const plannedFiltered = filtered.filter((a) => a.status === 'planned');

      let bulkBar = null;
      if (!readOnly && ui.selected.size) {
        const input = el('input', { class: 'input', type: 'text', placeholder: 'Owner for selected accounts…', value: ui.bulkOwnerValue, dataset: { focusKey: 'bulk-owner' } });
        input.addEventListener('input', () => { ui.bulkOwnerValue = input.value; });
        const apply = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, `Set owner for ${ui.selected.size}`);
        apply.addEventListener('click', async () => {
          const owner = ui.bulkOwnerValue.trim();
          if (!owner) { showToast('Enter a name first.', 'error'); return; }
          await bulkSetOwner(new Set(ui.selected), owner);
        });
        // Sign-up list over "a selection of rows" (section 18's own second
        // bulk-action reach point, alongside the "To sign up" group below):
        // whatever status the ticked rows carry, since a reader may just as
        // well want the checklist for a handful of already-planned rows
        // picked by hand as for the whole group at once.
        const signup = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, `Sign-up list for ${ui.selected.size}`);
        signup.addEventListener('click', () => {
          const ids = new Set(ui.selected);
          const rows = accounts.filter((a) => ids.has(a.id));
          const tools = toolsCache || [];
          const byId = new Map(tools.map((t) => [t.id, t]));
          openGenerator(rows.map((row) => ({ row, tool: (row.toolId !== null && row.toolId !== undefined) ? byId.get(row.toolId) : undefined })));
        });
        const clear = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, 'Clear selection');
        clear.addEventListener('click', () => { ui.selected.clear(); draw(); });
        bulkBar = el('div', { class: 'my-bulk-bar' }, el('span', { class: 't-small' }, `${ui.selected.size} selected`), input, apply, signup, clear);
      }

      const addBtn = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, 'Add account');
      addBtn.addEventListener('click', () => addAccount());
      const batchBtn = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Add several at once');
      batchBtn.addEventListener('click', async () => {
        await ensureTools();
        state.batchUi = defaultBatchState();
        draw();
      });
      const templatesBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, 'Add from templates');
      templatesBtn.addEventListener('click', () => { ui.templatesOpen = !ui.templatesOpen; draw(); });
      const headerActions = readOnly ? null : el('div', { class: 'my-accounts-actions' }, addBtn, batchBtn, templatesBtn);
      const templatesPanel = (!readOnly && ui.templatesOpen) ? renderTemplatesPicker() : null;
      const batchPanel = (!readOnly && state.batchUi) ? renderBatchOverlay() : null;

      const table = liveFiltered.length ? renderAccountsTable(liveFiltered, readOnly) : null;
      const plannedTable = plannedFiltered.length ? renderAccountsTable(plannedFiltered, readOnly) : null;
      // Sign-up list, bulk action over the "To sign up" group itself
      // (section 18's first reach point): built from whichever planned rows
      // are currently visible under the active search/filters, so the
      // checklist always matches what the reader is looking at.
      const signupGroupBtn = (!readOnly && plannedFiltered.length) ? (() => {
        const btn = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Generate sign-up list');
        btn.addEventListener('click', () => {
          const tools = toolsCache || [];
          const byId = new Map(tools.map((t) => [t.id, t]));
          openGenerator(plannedFiltered.map((row) => ({ row, tool: (row.toolId !== null && row.toolId !== undefined) ? byId.get(row.toolId) : undefined })));
        });
        return btn;
      })() : null;
      const plannedSection = plannedFiltered.length ? el('div', { class: 'my-signup-group' },
        el('h3', {}, 'To sign up'),
        el('p', { class: 't-meta' }, 'Accounts you plan to open but have not opened yet. They do not count toward the risk tiles on Overview or the Leavers checklist.'),
        signupGroupBtn,
        plannedTable,
      ) : null;
      const emptyMsg = !accounts.length
        ? el('p', { class: 't-body' }, 'No accounts recorded yet. Add one by hand, from a template, or from a shared stack link.')
        : (filtered.length ? null : el('p', { class: 't-body' }, 'No accounts match this search or these filters.'));

      return el('section', { class: 'my-screen' },
        el('h2', {}, 'Accounts'),
        readOnly ? el('p', { class: 't-meta' }, 'This is an example register: editing is switched off. Start your own register to add and edit real accounts.') : null,
        headerActions,
        templatesPanel,
        batchPanel,
        filterBar,
        bulkBar,
        emptyMsg,
        table,
        plannedSection,
      );
    }

    function renderTemplatesPicker() {
      const ui = state.accountsUi;
      const rows = SOVEREIGN_TEMPLATES.map((tpl) => {
        const id = `acc-tpl-${tpl.key}`;
        const cb = el('input', { type: 'checkbox', id, checked: ui.templatesTicked.has(tpl.key) });
        cb.addEventListener('change', () => { if (cb.checked) ui.templatesTicked.add(tpl.key); else ui.templatesTicked.delete(tpl.key); });
        return el('label', { class: 'my-template-row', for: id }, cb, el('span', {}, tpl.service));
      });
      const add = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, 'Add ticked');
      add.addEventListener('click', async () => {
        const keys = new Set(ui.templatesTicked);
        ui.templatesTicked.clear();
        ui.templatesOpen = false;
        if (!keys.size) { draw(); return; }
        await addTemplates(keys);
      });
      const cancel = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, 'Cancel');
      cancel.addEventListener('click', () => { ui.templatesOpen = false; ui.templatesTicked.clear(); draw(); });
      return el('div', { class: 'panel my-templates-panel' },
        el('p', { class: 't-small' }, 'Common accounts every business has. Tick to add:'),
        ...rows,
        el('div', { class: 'my-setup-actions' }, add, cancel));
    }

    /* --- Batch add (section 17, BUILD-PLAN 12.5): a three-step wizard over
       state.batchUi, rendered as an in-flow panel on Accounts (the same
       pattern renderTemplatesPicker above already uses, no modal system
       exists on this surface and none is introduced here). Step 1 mixes
       catalogue tools, sovereign templates and free-text names; step 2
       enters identity/owner/mfa/plan/status once; step 3 lists the rows
       about to be created and commits them all in a single store.save()
       via commitBatch() above. ------------------------------------------- */
    function defaultBatchState() {
      return {
        step: 'pick', search: '',
        tickedTools: new Set(), tickedTemplates: new Set(),
        freeTexts: [], freeTextInput: '', freeTextCounter: 0,
        identity: '', owner: '', mfa: 'unknown', plan: '', status: 'active',
      };
    }
    function batchItems(b) {
      const tools = toolsCache || [];
      const items = [];
      // Number.isInteger + Set#has, never truthiness: tool id 0 ticks and
      // commits exactly like any other id (section 17's own words).
      for (const id of b.tickedTools) {
        const t = tools.find((x) => x.id === id);
        if (t) items.push({ kind: 'tool', tool: t });
      }
      for (const key of b.tickedTemplates) {
        const tpl = SOVEREIGN_TEMPLATES.find((x) => x.key === key);
        if (tpl) items.push({ kind: 'template', tpl });
      }
      for (const f of b.freeTexts) items.push({ kind: 'free', name: f.name });
      return items;
    }
    function batchStepPick(b) {
      const tools = toolsCache || [];
      const q = b.search.trim().toLowerCase();
      const filteredTools = q ? tools.filter((t) => t.name.toLowerCase().includes(q)) : tools;
      const searchInput = el('input', {
        class: 'input', type: 'search', placeholder: 'Search the tool catalogue…',
        value: b.search, dataset: { focusKey: 'batch-search' },
      });
      searchInput.addEventListener('input', () => { b.search = searchInput.value; draw(); });

      const toolRows = filteredTools.map((t) => {
        const id = `batch-tool-${t.id}`;
        const cb = el('input', { type: 'checkbox', id, checked: b.tickedTools.has(t.id) });
        cb.addEventListener('change', () => { if (cb.checked) b.tickedTools.add(t.id); else b.tickedTools.delete(t.id); draw(); });
        return el('label', { class: 'my-template-row', for: id }, cb, el('span', {}, t.name));
      });
      const templateRows = SOVEREIGN_TEMPLATES.map((tpl) => {
        const id = `batch-tpl-${tpl.key}`;
        const cb = el('input', { type: 'checkbox', id, checked: b.tickedTemplates.has(tpl.key) });
        cb.addEventListener('change', () => { if (cb.checked) b.tickedTemplates.add(tpl.key); else b.tickedTemplates.delete(tpl.key); draw(); });
        return el('label', { class: 'my-template-row', for: id }, cb, el('span', {}, tpl.service));
      });

      const freeTextInput = el('input', {
        class: 'input', type: 'text', placeholder: 'A service not in the catalogue…',
        value: b.freeTextInput, dataset: { focusKey: 'batch-freetext' },
      });
      freeTextInput.addEventListener('input', () => { b.freeTextInput = freeTextInput.value; });
      function commitFreeText() {
        const name = b.freeTextInput.trim();
        if (!name) return;
        b.freeTexts.push({ id: `free-${b.freeTextCounter++}`, name });
        b.freeTextInput = '';
        draw();
      }
      const addFreeBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, 'Add name');
      addFreeBtn.addEventListener('click', commitFreeText);
      freeTextInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitFreeText(); } });

      const freeList = b.freeTexts.length ? el('ul', { class: 'my-attention-list' }, ...b.freeTexts.map((f) => {
        const removeBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, 'Remove');
        removeBtn.addEventListener('click', () => { b.freeTexts = b.freeTexts.filter((x) => x.id !== f.id); draw(); });
        return el('li', {}, `${f.name} `, removeBtn);
      })) : null;

      const total = b.tickedTools.size + b.tickedTemplates.size + b.freeTexts.length;
      const cancelBtn = el('button', { class: 'btn btn-ghost', type: 'button' }, 'Cancel');
      cancelBtn.addEventListener('click', () => { state.batchUi = null; draw(); });
      const contBtn = el('button', { class: 'btn btn-primary', type: 'button', disabled: total === 0 }, `Continue (${total} ticked)`);
      contBtn.addEventListener('click', () => { b.step = 'details'; draw(); });

      return el('div', {},
        el('h3', {}, 'Add several at once: pick services'),
        el('p', { class: 't-body' }, 'Tick every service you want to add in one go. Mix catalogue tools, common templates and services typed by hand.'),
        el('label', { class: 'my-field' }, el('span', { class: 't-small' }, 'Search the catalogue'), searchInput),
        el('div', { class: 'my-batch-picklist' }, ...toolRows),
        el('p', { class: 't-small' }, 'Common accounts:'),
        el('div', { class: 'my-batch-picklist' }, ...templateRows),
        el('p', { class: 't-small' }, 'Not in the catalogue:'),
        el('div', { class: 'my-field' }, freeTextInput, addFreeBtn),
        freeList,
        el('div', { class: 'my-setup-actions' }, cancelBtn, contBtn),
      );
    }
    function batchStepDetails(b) {
      const identityInput = el('input', {
        class: 'input', type: 'text', placeholder: 'name@business.co.uk',
        value: b.identity, dataset: { focusKey: 'batch-identity' },
      });
      identityInput.addEventListener('input', () => { b.identity = identityInput.value; draw(); });
      // Personal-email detection fires once, on the shared identity, before
      // creation (section 17's own words), same chip vocabulary as Accounts.
      const personalChip = isPersonalEmail(b.identity) ? el('span', { class: 'my-chip my-chip-risk' }, 'Personal email') : null;

      const ownerInput = el('input', {
        class: 'input', type: 'text', placeholder: 'Who owns these accounts',
        value: b.owner, dataset: { focusKey: 'batch-owner' },
      });
      ownerInput.addEventListener('input', () => { b.owner = ownerInput.value; });

      const mfaSelectEl = el('select', { class: 'select' },
        ...['app', 'sms', 'hardware', 'none', 'unknown'].map((v) => el('option', { value: v, selected: b.mfa === v }, MFA_LABEL[v])));
      mfaSelectEl.addEventListener('change', () => { b.mfa = mfaSelectEl.value; });

      const planInput = el('input', {
        class: 'input', type: 'text', placeholder: 'Plan (optional)',
        value: b.plan, dataset: { focusKey: 'batch-plan' },
      });
      planInput.addEventListener('input', () => { b.plan = planInput.value; });

      // Status offers only active/planned here (section 17): a batch is
      // either accounts being opened now, or a batch of intentions, never a
      // way to bulk-mark existing accounts to-close/closed.
      const statusSelectEl = el('select', { class: 'select' },
        ...['active', 'planned'].map((v) => el('option', { value: v, selected: b.status === v }, STATUS_LABEL[v])));
      statusSelectEl.addEventListener('change', () => { b.status = statusSelectEl.value; });

      const back = el('button', { class: 'btn btn-ghost', type: 'button' }, 'Back');
      back.addEventListener('click', () => { b.step = 'pick'; draw(); });
      const cont = el('button', { class: 'btn btn-primary', type: 'button' }, 'Continue');
      cont.addEventListener('click', () => { b.step = 'review'; draw(); });

      return el('div', {},
        el('h3', {}, 'Add several at once: shared details'),
        el('p', { class: 't-body' }, 'Entered once, applied to every account in this batch. You can change any single one afterwards, in its own details drawer.'),
        el('label', { class: 'my-field' }, el('span', { class: 't-small' }, 'Identity (email or SSO label)'), identityInput, personalChip),
        el('label', { class: 'my-field' }, el('span', { class: 't-small' }, 'Owner'), ownerInput),
        el('label', { class: 'my-field' }, el('span', { class: 't-small' }, '2FA method'), mfaSelectEl),
        el('label', { class: 'my-field' }, el('span', { class: 't-small' }, 'Plan (optional)'), planInput),
        el('label', { class: 'my-field' }, el('span', { class: 't-small' }, 'Status'), statusSelectEl),
        el('div', { class: 'my-setup-actions' }, back, cont),
      );
    }
    function batchStepReview(b) {
      const items = batchItems(b);
      const rows = items.map((it) => {
        const name = it.kind === 'tool' ? it.tool.name : it.kind === 'template' ? it.tpl.service : it.name;
        return el('li', {}, name);
      });
      const back = el('button', { class: 'btn btn-ghost', type: 'button' }, 'Back');
      back.addEventListener('click', () => { b.step = 'details'; draw(); });
      const commitBtn = el('button', { class: 'btn btn-primary', type: 'button' }, `Add ${items.length} account${items.length === 1 ? '' : 's'}`);
      commitBtn.addEventListener('click', () => { commitBatch(items, b); });
      return el('div', {},
        el('h3', {}, 'Add several at once: review'),
        el('p', { class: 't-body' },
          `${items.length} account${items.length === 1 ? '' : 's'}, one commit, all sharing: identity `,
          el('strong', {}, b.identity || 'not set'), ', owner ',
          el('strong', {}, b.owner || 'not set'), ', 2FA ',
          el('strong', {}, MFA_LABEL[b.mfa]), ', status ',
          el('strong', {}, STATUS_LABEL[b.status]), '.'),
        el('ul', { class: 'my-attention-list' }, ...rows),
        el('div', { class: 'my-setup-actions' }, back, commitBtn),
      );
    }
    function renderBatchOverlay() {
      const b = state.batchUi;
      const body = b.step === 'details' ? batchStepDetails(b) : (b.step === 'review' ? batchStepReview(b) : batchStepPick(b));
      return el('div', { class: 'panel my-batch-sheet' }, body);
    }

    function renderMergeBanner() {
      const mp = state.mergePreview;
      const total = mp.wantIds.length + mp.haveIds.length;
      if (!mp.open) {
        const review = el('button', { class: 'btn btn-sm btn-primary', type: 'button' }, 'Review');
        review.addEventListener('click', () => { mp.open = true; draw(); });
        const dismiss = el('button', { class: 'btn btn-sm btn-ghost', type: 'button' }, 'Dismiss');
        dismiss.addEventListener('click', () => { state.mergePreview = null; draw(); });
        return el('div', { class: 'my-banner my-banner-merge', role: 'status' },
          `Your stack link includes ${total} tool${total === 1 ? '' : 's'} not yet in this register. `,
          review, dismiss);
      }
      const tools = toolsCache || [];
      const byId = new Map(tools.map((t) => [t.id, t]));
      function tickRows(ids) {
        return ids.map((id) => {
          const tool = byId.get(id);
          const cbId = `merge-${id}`;
          const cb = el('input', { type: 'checkbox', id: cbId, checked: mp.ticked.has(id) });
          cb.addEventListener('change', () => { if (cb.checked) mp.ticked.add(id); else mp.ticked.delete(id); });
          return el('label', { class: 'my-template-row', for: cbId }, cb, el('span', {}, tool ? tool.name : `Tool ${id}`));
        });
      }
      // Section 19: the same "Already using these" / "Want to try" grouping
      // as the first-run review step, so a returning visitor sees the same
      // vocabulary a fresh setup would have shown them.
      const haveBlock = mp.haveIds.length ? el('div', { class: 'my-review-block' },
        el('p', { class: 't-small' }, 'Already using these:'), ...tickRows(mp.haveIds)) : null;
      const wantHeading = isDiscoverArrival ? 'Want to try (added as planned):' : 'From your shared stack:';
      const wantBlock = mp.wantIds.length ? el('div', { class: 'my-review-block' },
        el('p', { class: 't-small' }, wantHeading), ...tickRows(mp.wantIds)) : null;
      const apply = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, 'Add ticked');
      apply.addEventListener('click', async () => { await applyMerge(mp, new Set(mp.ticked)); });
      const cancel = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, 'Cancel');
      cancel.addEventListener('click', () => { state.mergePreview = null; draw(); });
      // Sign-up generator, reached from the import review itself (section
      // 18's second reach point), over the want-list ids of a Discover
      // arrival: these tools have no register row yet at all, so the
      // generator is opened with `row: undefined`, exactly the shape it
      // already accepts for a manual account with no catalogue link.
      const signupBtn = (isDiscoverArrival && mp.wantIds.length) ? (() => {
        const btn = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Sign-up list for these');
        btn.addEventListener('click', () => {
          openGenerator(mp.wantIds.map((id) => ({ tool: byId.get(id), row: undefined })));
        });
        return btn;
      })() : null;
      return el('div', { class: 'my-banner my-banner-merge my-banner-merge-open', role: 'status' },
        el('p', { class: 't-small' }, 'Adding these will never duplicate a tool already in this register:'),
        haveBlock, wantBlock,
        el('div', { class: 'my-setup-actions' }, apply, signupBtn, cancel));
    }

    /** The sign-up generator's in-app sheet (section 18): rendered at the
        shell level (see the container assembly below) so it stays visible
        whichever of Accounts/My tools/the merge banner opened it, rather
        than being lost the instant the reader navigates away to look at
        something else while working through it. Not a print sheet itself
        (that is printGeneratorSheet(), the .my-print-sheet mechanism); this
        is the interactive, on-screen view the Print and Copy buttons act
        on. */
    function renderGeneratorSheet() {
      const g = state.generatorUi;
      if (!g) return null;
      const entries = generatorEntries(g.items);

      const closeBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, 'Close');
      closeBtn.addEventListener('click', closeGenerator);
      const printBtn = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Print or save as PDF');
      printBtn.addEventListener('click', () => printGeneratorSheet(g.items, doc.business));
      const copyBtn = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Copy as text');
      copyBtn.addEventListener('click', () => copyGeneratorText(g.items, doc.business));

      // Pre-seed (section 18, opt-in, off by default): only offered when at
      // least one item still has a catalogue tool with no matching register
      // row yet, since that is the only case there is anything to create.
      const existingToolIds = new Set(doc.accounts.map((a) => a.toolId).filter((v) => v !== null && v !== undefined));
      const seedable = g.items.filter((it) => it.tool && Number.isInteger(it.tool.id) && !existingToolIds.has(it.tool.id));
      let preSeedBlock = null;
      if (seedable.length) {
        const cbId = 'generator-preseed';
        const cb = el('input', { type: 'checkbox', id: cbId, checked: g.preSeed });
        cb.addEventListener('change', () => { g.preSeed = cb.checked; draw(); });
        const addBtn = el('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: !g.preSeed }, `Add ${seedable.length} to the register as planned`);
        addBtn.addEventListener('click', async () => {
          const saved = await preSeedGeneratorItems(g.items);
          if (saved) showToast('Added as planned accounts.');
        });
        preSeedBlock = el('div', { class: 'my-generator-preseed' },
          el('label', { for: cbId, class: 'my-template-row' }, cb, el('span', {}, 'Add these to the register as planned')),
          addBtn,
        );
      }

      const list = entries.map((e) => el('div', { class: 'my-signup-sheet-item' },
        el('h3', {}, e.name),
        el('ul', { class: 'my-attention-list' },
          el('li', {}, generatorChecklistPoints(e)[0]),
          el('li', {}, 'Turn on two-factor authentication, app-based where the service offers it.'),
          el('li', {}, 'Record the account in this register: identity used, owner, 2FA method.'),
          e.freeLimit ? el('li', {}, `Free tier: ${e.freeLimit}`) : null,
        ),
      ));

      return el('div', { class: 'panel my-generator-sheet no-print' },
        el('div', { class: 'my-generator-head' }, el('h2', {}, 'Sign-up list'), closeBtn),
        el('p', { class: 't-meta' }, CE_LINE),
        ...list,
        preSeedBlock,
        el('div', { class: 'my-setup-actions' }, printBtn, copyBtn),
      );
    }

    function renderAccountsTable(rows, readOnly) {
      const ui = state.accountsUi;
      const selectAllChecked = rows.length > 0 && rows.every((a) => ui.selected.has(a.id));
      const selectAll = el('input', { type: 'checkbox', 'aria-label': 'Select all filtered accounts', checked: selectAllChecked });
      selectAll.addEventListener('change', () => {
        if (selectAll.checked) rows.forEach((a) => ui.selected.add(a.id));
        else rows.forEach((a) => ui.selected.delete(a.id));
        draw();
      });
      const theadRow = el('tr', {},
        readOnly ? null : el('th', {}, selectAll),
        el('th', {}, 'Service'), el('th', {}, 'Identity'), el('th', {}, 'Owner'), el('th', {}, '2FA'), el('th', {}, 'Renewal'), el('th', {}, 'Recorded'),
        readOnly ? null : el('th', {}, 'Actions'),
      );
      const trs = rows.flatMap((a) => renderAccountRow(a, readOnly));
      return el('div', { class: 'my-table-wrap' },
        el('table', { class: 'my-accounts-table my-acc-table' }, el('thead', {}, theadRow), el('tbody', {}, trs)));
    }

    function fieldInput(a, field, type, readOnly, placeholder) {
      const raw = a[field];
      if (readOnly) {
        let display = raw != null && raw !== '' ? String(raw) : (placeholder || 'Not recorded');
        if (field === 'renewal') display = raw ? formatDate(raw) : 'None';
        return el('span', { class: 'my-acc-readonly' }, display);
      }
      const input = el('input', {
        class: 'input my-acc-input', type, value: raw ?? '', placeholder,
        dataset: { focusKey: `field-${a.id}-${field}` },
      });
      input.addEventListener('change', () => { updateAccountField(a.id, field, field === 'renewal' ? (input.value || null) : input.value); });
      return input;
    }

    function mfaSelect(a, readOnly) {
      if (readOnly) return el('span', { class: 'my-acc-readonly' }, MFA_LABEL[a.mfa] || a.mfa || 'Not recorded');
      const select = el('select', { class: 'select my-acc-input', dataset: { focusKey: `field-${a.id}-mfa` } },
        ...['app', 'sms', 'hardware', 'none', 'unknown'].map((v) => el('option', { value: v, selected: a.mfa === v }, MFA_LABEL[v])));
      select.addEventListener('change', () => { updateAccountField(a.id, 'mfa', select.value); });
      return select;
    }

    function renderAccountRow(a, readOnly) {
      const ui = state.accountsUi;
      const { count, total } = completeness(a);
      const checkCell = readOnly ? null : el('td', { class: 'my-acc-check' },
        (() => {
          const cb = el('input', { type: 'checkbox', 'aria-label': `Select ${a.service || 'this account'}`, checked: ui.selected.has(a.id) });
          cb.addEventListener('change', () => { if (cb.checked) ui.selected.add(a.id); else ui.selected.delete(a.id); draw(); });
          return cb;
        })());

      const detailsOpen = ui.openDrawerId === a.id;
      const detailsBtn = el('button', { class: 'btn btn-ghost btn-sm my-acc-details-btn', type: 'button', 'aria-expanded': String(detailsOpen) }, detailsOpen ? 'Close details' : 'Details');
      detailsBtn.addEventListener('click', () => { ui.openDrawerId = detailsOpen ? null : a.id; draw(); });
      // Quiet status chip (section 16): only `planned` gets one on the
      // table itself, since active/to-close/closed are the ordinary life of
      // a real account and do not need flagging on every row.
      const plannedChip = a.status === 'planned' ? el('span', { class: 'my-chip my-chip-quiet' }, 'Planned') : null;
      const serviceCell = el('td', { class: 'my-acc-service' }, fieldInput(a, 'service', 'text', readOnly, 'Service name'), plannedChip, detailsBtn);

      const identityCell = el('td', { class: 'my-acc-identity' },
        fieldInput(a, 'identity', 'text', readOnly, 'name@business.co.uk'),
        isPersonalEmail(a.identity) ? el('span', { class: 'my-chip my-chip-risk' }, 'Personal email') : null);

      const ownerCell = el('td', { class: 'my-acc-owner' },
        fieldInput(a, 'owner', 'text', readOnly, 'Not recorded'),
        hasNoOwner(a.owner) ? el('span', { class: 'my-chip my-chip-risk' }, 'No owner') : null);

      const mfaLbl = mfaRiskLabel(a.mfa);
      const mfaCell = el('td', { class: 'my-acc-mfa' }, mfaSelect(a, readOnly), mfaLbl ? el('span', { class: 'my-chip my-chip-risk' }, mfaLbl) : null);

      const renewalCell = el('td', { class: 'my-acc-renewal' },
        fieldInput(a, 'renewal', 'date', readOnly, ''),
        isRenewalSoon(a.renewal) ? el('span', { class: 'my-chip my-chip-risk' }, 'Renewing soon') : null);

      const completenessCell = el('td', { class: 'my-acc-completeness' },
        el('span', {}, `${count} of ${total} recorded`),
        el('span', { class: 'my-completeness-bar' }, el('span', { class: 'my-completeness-fill', style: `width:${Math.round((count / total) * 100)}%` })));

      let actionsCell = null;
      if (!readOnly) {
        const deleteBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, 'Delete');
        deleteBtn.addEventListener('click', () => deleteAccount(a.id));
        actionsCell = el('td', { class: 'my-acc-actions' }, deleteBtn);
      }

      const dataRow = el('tr', { class: 'my-acc-row' }, checkCell, serviceCell, identityCell, ownerCell, mfaCell, renewalCell, completenessCell, actionsCell);
      const rowsOut = [dataRow];
      if (detailsOpen) {
        rowsOut.push(el('tr', { class: 'my-acc-drawer-row' },
          el('td', { colspan: readOnly ? 7 : 8 }, renderDrawer(a, readOnly))));
      }
      return rowsOut;
    }

    function drawerField(labelText, a, field, type, readOnly) {
      const raw = a[field];
      const value = raw === null || raw === undefined ? '' : raw;
      if (readOnly) return el('div', { class: 'my-field' }, el('span', { class: 't-small' }, labelText), el('p', {}, value !== '' ? String(value) : 'Not recorded'));
      const input = el('input', { class: 'input', type, value, dataset: { focusKey: `drawer-${a.id}-${field}` } });
      input.addEventListener('change', () => {
        let v = input.value;
        if (type === 'number') v = v === '' ? null : Number(v);
        updateAccountField(a.id, field, v);
      });
      return el('label', { class: 'my-field' }, el('span', { class: 't-small' }, labelText), input);
    }
    function drawerSelect(labelText, a, field, options, labels, readOnly) {
      if (readOnly) return el('div', { class: 'my-field' }, el('span', { class: 't-small' }, labelText), el('p', {}, labels[a[field]] || a[field]));
      const select = el('select', { class: 'select', dataset: { focusKey: `drawer-${a.id}-${field}` } },
        ...options.map((v) => el('option', { value: v, selected: a[field] === v }, labels[v])));
      select.addEventListener('change', () => { updateAccountField(a.id, field, select.value); });
      return el('label', { class: 'my-field' }, el('span', { class: 't-small' }, labelText), select);
    }
    function drawerTextarea(labelText, a, field, readOnly) {
      const value = a[field] || '';
      if (readOnly) return el('div', { class: 'my-field my-field-wide' }, el('span', { class: 't-small' }, labelText), el('p', {}, value || 'Not recorded'));
      const textarea = el('textarea', { class: 'input', rows: '3', dataset: { focusKey: `drawer-${a.id}-${field}` } }, value);
      textarea.addEventListener('change', () => { updateAccountField(a.id, field, textarea.value); });
      return el('label', { class: 'my-field my-field-wide' }, el('span', { class: 't-small' }, labelText), textarea);
    }
    /** Shared-login flag (section 9.5's own words, "rows flagged shared"):
        marks a credential more than one person knows, so the Leavers
        screen's phase 3 ("rotate what they knew") catches it even when the
        identity field itself reads as a plain business address rather than
        a personal one. */
    function drawerCheckbox(labelText, a, field, readOnly) {
      if (readOnly) return el('div', { class: 'my-field' }, el('span', { class: 't-small' }, labelText), el('p', {}, a[field] ? 'Yes' : 'No'));
      const id = `drawer-${a.id}-${field}`;
      const cb = el('input', { type: 'checkbox', id, checked: !!a[field], dataset: { focusKey: id } });
      cb.addEventListener('change', () => { updateAccountField(a.id, field, cb.checked); });
      return el('label', { class: 'my-field my-template-row', for: id }, cb, el('span', { class: 't-small' }, labelText));
    }

    /** Conversion exposure (section 9.4, "Conversion exposure (Phase 22)").
        A row is free today if it is not closed and is either still only
        planned, or costed at nothing (no monthlyCost recorded, or recorded
        as exactly zero). This is a render-time read of the catalogue's
        `paid_from`, never written back into the register document: the
        register records facts about the business, and a vendor's future
        price is not one. toolId 0 is a real tool throughout, exactly as
        everywhere else on this surface: Number.isInteger, never
        truthiness. */
    function isFreeRow(a) {
      return a.status !== 'closed' && (a.status === 'planned' || a.monthlyCost === null || a.monthlyCost === undefined || a.monthlyCost === 0);
    }
    /** The linked tool, only when it carries a usable paid tier (an integer
        above zero); null otherwise, whether that is no link, an unresolved
        catalogue fetch, or a tool with no known paid_from. Callers gate this
        on isFreeRow() first: a row that is already paying is never exposure. */
    function exposureToolFor(a) {
      if (!Number.isInteger(a.toolId)) return null;
      const tool = (toolsCache || []).find((t) => t.id === a.toolId);
      if (!tool || !Number.isInteger(tool.paid_from) || tool.paid_from <= 0) return null;
      return tool;
    }
    function exposureNoteText(tool) {
      return `Free today, from ${money(tool.paid_from)}/mo if it converts`;
    }

    /** Everything not in the five visible columns (section 9.2, section
        4.2): url, toolId (read-only: it comes from an import, not typed),
        admin, plan, monthlyCost, status, notes. */
    function renderDrawer(a, readOnly) {
      const toolLine = (a.toolId !== null && a.toolId !== undefined) ? (() => {
        const tool = (toolsCache || []).find((t) => t.id === a.toolId);
        return el('p', { class: 't-meta' }, tool ? `Linked to your stack: ${tool.name}` : `Linked to your stack (tool id ${a.toolId})`);
      })() : null;
      const closeBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, 'Close details');
      closeBtn.addEventListener('click', () => { state.accountsUi.openDrawerId = null; draw(); });
      // Section 16's transition rule: marking a planned row active changes
      // only the status field, nothing else automatically; this note is the
      // reader's cue to go and confirm the identity actually used, rather
      // than the app inventing or assuming one.
      const plannedHint = (!readOnly && a.status === 'planned')
        ? el('p', { class: 't-meta my-field-wide' }, 'Not opened yet. When you do sign up, come back here, mark this active, and check the identity above is the one you actually used.')
        : null;
      // Phase 22 per-row note, right beside the field it explains: this row
      // shows £0 today only because the vendor has not asked for money yet.
      const exposureTool = isFreeRow(a) ? exposureToolFor(a) : null;
      const exposureNote = exposureTool
        ? el('p', { class: 't-meta my-field-wide' }, exposureNoteText(exposureTool))
        : null;
      return el('div', { class: 'my-acc-drawer' },
        toolLine,
        el('div', { class: 'my-acc-drawer-grid' },
          drawerField('Website', a, 'url', 'url', readOnly),
          drawerSelect('Access level', a, 'admin', ['owner', 'admin', 'member', 'unknown'], ADMIN_LABEL, readOnly),
          drawerField('Plan', a, 'plan', 'text', readOnly),
          drawerField('Monthly cost (GBP)', a, 'monthlyCost', 'number', readOnly),
          exposureNote,
          drawerSelect('Status', a, 'status', STATUS_OPTIONS, STATUS_LABEL, readOnly),
          drawerCheckbox('Shared login (more than one person knows it)', a, 'shared', readOnly),
          drawerTextarea('Notes', a, 'notes', readOnly),
          plannedHint,
        ),
        closeBtn,
      );
    }

    /* --- My tools: the imported stack as cards (section 9.3) -------------- */
    function openAccountDrawer(rowId) {
      state.accountsUi.openDrawerId = rowId;
      navigate('accounts');
    }
    function toolCard(row, tool) {
      const icon = tool ? categoryIcon(tool.category) : null;
      const adoptionLevel = statusChipLevel(row.status);
      const adoption = el('span', { class: `my-chip${adoptionLevel ? ` my-chip-${adoptionLevel}` : ''}` }, ADOPTION_LABEL[row.status] || row.status);
      const linkUrl = row.url || (tool && tool.urls && tool.urls[0] ? `https://${tool.urls[0].domain}` : '');
      const visitLink = linkUrl ? el('a', { href: linkUrl, target: '_blank', rel: 'noopener noreferrer', class: 'btn btn-ghost btn-sm' }, 'Visit site') : null;
      const openBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, 'View in register');
      openBtn.addEventListener('click', () => openAccountDrawer(row.id));
      return el('div', { class: 'panel my-tool-card' },
        el('div', { class: 'my-tool-card-head' }, icon, el('h3', {}, row.service || (tool ? tool.name : 'Untitled account')), adoption),
        tool ? el('p', { class: 't-body my-tool-card-desc' }, tool.description) : el('p', { class: 't-meta' }, 'Not matched to a catalogue tool.'),
        el('div', { class: 'my-tool-card-actions' }, visitLink, openBtn),
      );
    }
    function screenMyTools() {
      ensureToolsThenRedraw();
      const accounts = doc.accounts;
      const withTool = accounts.filter((a) => a.toolId !== null && a.toolId !== undefined);
      const withoutTool = accounts.filter((a) => a.toolId === null || a.toolId === undefined);
      const tools = toolsCache || [];
      const byId = new Map(tools.map((t) => [t.id, t]));
      const cards = withTool.map((row) => toolCard(row, byId.get(row.toolId)));
      const cardGrid = cards.length ? el('div', { class: 'my-tool-cards' }, ...cards)
        : el('p', { class: 't-body' }, 'No accounts are linked to a catalogue tool yet. Follow a shared stack link, or set a tool link from an account’s details in Accounts.');
      const otherList = withoutTool.length ? el('ul', { class: 'my-attention-list' }, ...withoutTool.map((row) => {
        const btn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, row.service || 'Untitled account');
        btn.addEventListener('click', () => openAccountDrawer(row.id));
        const adoptionLevel = statusChipLevel(row.status);
        return el('li', {}, btn, ' ', el('span', { class: `my-chip${adoptionLevel ? ` my-chip-${adoptionLevel}` : ''}` }, ADOPTION_LABEL[row.status] || row.status));
      })) : el('p', { class: 't-body' }, 'Nothing else recorded yet.');
      // Sign-up generator, third reach point (section 18): imported tools
      // with no active register row yet, i.e. still only `planned` here.
      const plannedTools = withTool.filter((row) => row.status === 'planned');
      const signupBtn = (!state.example && plannedTools.length) ? (() => {
        const btn = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, `Generate sign-up list (${plannedTools.length})`);
        btn.addEventListener('click', () => {
          openGenerator(plannedTools.map((row) => ({ row, tool: byId.get(row.toolId) })));
        });
        return btn;
      })() : null;
      return el('section', { class: 'my-screen' },
        el('h2', {}, 'My tools'),
        el('p', { class: 't-body' }, 'Your imported stack, one card per tool, each linking back to its full entry in Accounts.'),
        signupBtn,
        cardGrid,
        el('h3', {}, 'Everything else you told us about'),
        otherList,
      );
    }

    /* --- Costs: a ledger, not a dashboard (section 9.4) -------------------- */
    function renewalRow(a) {
      // Phase 22: a renewal date and a £0 amount together are exactly the
      // trap ("free trial ends, converts automatically") this note exists
      // to name, so it belongs on this row even though the row itself
      // already shows a cost.
      const exposureTool = isFreeRow(a) ? exposureToolFor(a) : null;
      return el('div', { class: 'my-renewal-row' },
        el('span', { class: 'my-renewal-date' }, formatDate(a.renewal)),
        el('span', { class: 'my-renewal-service' }, a.service || 'Untitled account'),
        el('span', { class: 'my-renewal-amount' }, a.monthlyCost != null ? money(a.monthlyCost) : 'No cost recorded'),
        exposureTool ? el('span', { class: 'my-renewal-exposure t-meta' }, exposureNoteText(exposureTool)) : null,
      );
    }
    function renewalList(accounts, days, titleText) {
      const rows = accounts
        .filter((a) => a.status !== 'closed' && isRenewalSoon(a.renewal, days) && new Date(a.renewal) >= new Date(new Date().toDateString()))
        .sort((x, y) => new Date(x.renewal) - new Date(y.renewal));
      return el('div', { class: 'panel my-renewal-block' },
        el('h3', {}, titleText),
        rows.length ? el('div', { class: 'my-renewal-list' }, ...rows.map(renewalRow)) : el('p', { class: 't-body' }, 'Nothing renewing in this window.'),
      );
    }
    function buildStackLink(document_) {
      const ids = [...new Set(document_.accounts
        .filter((a) => a.toolId !== null && a.toolId !== undefined)
        .map((a) => a.toolId))].sort((x, y) => x - y);
      if (!ids.length) return null;
      const params = new URLSearchParams();
      params.set('t', ids.join(','));
      if (document_.business) params.set('client', document_.business);
      return `/?${params.toString()}`;
    }
    function screenCosts() {
      ensureToolsThenRedraw();
      // Section 16 extension (BUILD-PLAN 12.4 fix round, 27 Jul): a planned
      // row is an intention the business has not paid for by definition, so
      // it never enters the renewal lists, the uncosted list or the
      // monthly/annual totals below, exactly as it never enters the
      // Overview risk tiles or the Leavers checklist for the same reason.
      const accounts = doc.accounts.filter((a) => a.status !== 'closed' && a.status !== 'planned');
      const costed = accounts.filter((a) => typeof a.monthlyCost === 'number');
      const uncosted = accounts.filter((a) => typeof a.monthlyCost !== 'number');
      const monthlyTotal = costed.reduce((sum, a) => sum + a.monthlyCost, 0);
      const ui = state.costsUi;
      const totalFigure = ui.mode === 'annual' ? monthlyTotal * 12 : monthlyTotal;

      // Conversion exposure (Phase 22). Unlike the total above, this reads
      // the WHOLE register, including planned rows: an intention to sign up
      // for something free is exactly the row this line exists to warn
      // about. Computed here only, at render time, from the catalogue
      // already in memory; never written back into doc.
      let exposureMonthly = 0;
      let exposureRowCount = 0;
      let exposureUnknownCount = 0;
      for (const a of doc.accounts) {
        if (!isFreeRow(a)) continue;
        const tool = exposureToolFor(a);
        if (tool) { exposureMonthly += tool.paid_from; exposureRowCount += 1; }
        else exposureUnknownCount += 1;
      }
      const exposureFigure = ui.mode === 'annual' ? exposureMonthly * 12 : exposureMonthly;

      const monthlyBtn = el('button', { class: `btn btn-sm ${ui.mode === 'monthly' ? 'btn-primary' : 'btn-ghost'}`, type: 'button', 'aria-pressed': String(ui.mode === 'monthly') }, 'Monthly');
      monthlyBtn.addEventListener('click', () => { ui.mode = 'monthly'; draw(); });
      const annualBtn = el('button', { class: `btn btn-sm ${ui.mode === 'annual' ? 'btn-primary' : 'btn-ghost'}`, type: 'button', 'aria-pressed': String(ui.mode === 'annual') }, 'Annual');
      annualBtn.addEventListener('click', () => { ui.mode = 'annual'; draw(); });

      const totalPanel = el('div', { class: 'panel my-costs-total' },
        el('div', { class: 'my-costs-toggle', role: 'group', 'aria-label': 'Monthly or annual total' }, monthlyBtn, annualBtn),
        el('p', { class: 'my-costs-figure' }, money(totalFigure)),
        el('p', { class: 't-meta' }, `${ui.mode === 'annual' ? 'Per year' : 'Per month'}, summed from ${costed.length} account${costed.length === 1 ? '' : 's'} with a cost recorded.`),
      );

      // Category subtotals (Phase 22.1). Same source array as the grand
      // total above (`costed`, not doc.accounts), so the subtotals provably
      // sum to it: no separate qualifying rule, no separate rounding. A
      // costed row with a resolvable toolId takes its linked tool's
      // category; everything else (no toolId, or a toolId the catalogue
      // does not recognise) buckets under one honest label rather than
      // vanishing or inventing a category nobody recorded.
      const UNLINKED_CATEGORY = 'Not linked to the catalogue';
      const categoryTotals = new Map(); // category -> monthly sum
      for (const a of costed) {
        let category = UNLINKED_CATEGORY;
        if (Number.isInteger(a.toolId)) {
          const tool = (toolsCache || []).find((t) => t.id === a.toolId);
          if (tool) category = tool.category;
        }
        categoryTotals.set(category, (categoryTotals.get(category) || 0) + a.monthlyCost);
      }
      const categoryRows = [...categoryTotals.entries()]
        .sort(([nameA, subA], [nameB, subB]) => (subB - subA) || nameA.localeCompare(nameB));
      const subtotalsPanel = categoryRows.length ? el('div', { class: 'panel my-costs-subtotals' },
        el('p', { class: 't-small' }, 'Recorded spend by category:'),
        el('div', { class: 'my-costs-subtotal-list' }, ...categoryRows.map(([category, subMonthly]) => {
          const subFigure = ui.mode === 'annual' ? subMonthly * 12 : subMonthly;
          return el('div', { class: 'my-costs-subtotal-row' },
            el('span', { class: 'my-costs-subtotal-category' }, category),
            el('span', { class: 'my-costs-subtotal-amount' }, money(subFigure)));
        })),
      ) : null;

      const uncostedPanel = uncosted.length ? el('div', { class: 'panel my-costs-uncosted' },
        el('p', { class: 't-small' }, `${uncosted.length} account${uncosted.length === 1 ? '' : 's'} with no cost recorded:`),
        el('ul', { class: 'my-attention-list' }, ...uncosted.map((a) => {
          const btn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, `${a.service || 'Untitled account'}: no cost recorded`);
          btn.addEventListener('click', () => openAccountDrawer(a.id));
          const exposureTool = isFreeRow(a) ? exposureToolFor(a) : null;
          const note = exposureTool ? el('p', { class: 't-meta' }, exposureNoteText(exposureTool)) : null;
          return el('li', { class: 'my-costs-uncosted-item' }, btn, note);
        })),
      ) : null;

      // Section 9.4's own wording: an indicative line, always "from", never
      // a forecast, and it does not render at all when nothing qualifies
      // (a register with no free rows linked to a priced tool has nothing
      // to be indicative about). The "no known price" honesty count is
      // independent of it: it can appear even when the figure above cannot.
      const exposurePanel = exposureRowCount ? el('div', { class: 'panel my-costs-exposure' },
        el('p', { class: 'my-costs-exposure-figure' },
          `If every free tier here converted: from ${money(exposureFigure)}${ui.mode === 'annual' ? '/year' : '/month'}`),
        el('p', { class: 't-meta' },
          `Vendor prices as last checked, summed from ${exposureRowCount} free row${exposureRowCount === 1 ? '' : 's'} with a known paid tier.`),
      ) : null;
      const exposureUnknownPanel = exposureUnknownCount ? el('p', { class: 't-small my-costs-exposure-unknown' },
        `${exposureUnknownCount} free row${exposureUnknownCount === 1 ? '' : 's'} with no known conversion price.`) : null;

      const stackLink = buildStackLink(doc);
      const chartNote = stackLink ? el('div', { class: 'panel my-costs-chart-note' },
        el('p', { class: 't-body' }, 'For the indicative cost-growth chart (how costs could grow if your team grew into every free tier at once), see your stack’s client page:'),
        el('a', { href: stackLink }, 'View your stack'),
      ) : null;

      // Scope note (Phase 22.1): always renders, states the ledger's own
      // boundary rather than letting a complete-looking total imply this is
      // a bookkeeping system, which it is not. Never stored, presentation
      // only, same as the exposure line above it.
      const scopeNote = el('p', { class: 't-meta my-costs-scope' },
        'This ledger covers what is recorded here, typically software subscriptions. Advertising spend, usage-based infrastructure bills and one-off purchases sit outside it unless you record them as accounts with a monthly cost. My Stack is a register, not a bookkeeping system.');

      return el('section', { class: 'my-screen' },
        el('h2', {}, 'Costs'),
        renewalList(accounts, 14, 'Renewing in the next 14 days'),
        renewalList(accounts, 60, 'Renewing in the next 60 days'),
        totalPanel,
        subtotalsPanel,
        exposurePanel,
        exposureUnknownPanel,
        uncostedPanel,
        chartNote,
        scopeNote,
      );
    }

    /* --- Leavers: the offboarding checklist (section 9.5) ------------------ */
    function distinctOwners(document_) {
      const set = new Set();
      // Section 16 (BUILD-PLAN 12.4 fix round, 27 Jul): an owner whose
      // entire footprint is planned rows is not offered here. A planned
      // row's `owner` names a future account holder, someone who will hold
      // a key once this account exists, not a leaver candidate the register
      // can say anything real about yet.
      for (const a of document_.accounts) {
        if (a.status === 'planned') continue;
        const o = (a.owner || '').trim();
        if (o) set.add(o);
      }
      return [...set].sort((x, y) => x.localeCompare(y));
    }
    function findLeaverEntry(document_, person) {
      const norm = (person || '').trim().toLowerCase();
      return (document_.leavers || []).find((l) => l.person.trim().toLowerCase() === norm) || null;
    }
    async function generateLeaverChecklist(person) {
      const trimmed = (person || '').trim();
      if (!trimmed) { showToast('Choose or type a name first.', 'error'); return; }
      await mutateDoc((d) => {
        d.leavers = Array.isArray(d.leavers) ? d.leavers : [];
        const existing = d.leavers.find((l) => l.person.trim().toLowerCase() === trimmed.toLowerCase());
        if (existing) existing.generatedAt = todayIso();
        else d.leavers.push({ person: trimmed, generatedAt: todayIso(), ticks: {} });
        return d;
      });
    }
    async function toggleLeaverTick(person, key) {
      await mutateDoc((d) => {
        const entry = (d.leavers || []).find((l) => l.person.trim().toLowerCase() === person.trim().toLowerCase());
        if (entry) { entry.ticks = entry.ticks || {}; entry.ticks[key] = !entry.ticks[key]; }
        return d;
      });
    }
    async function reassignLeaverRow(rowId, newOwner) {
      const trimmed = (newOwner || '').trim();
      if (!trimmed) { showToast('Enter a name to reassign to.', 'error'); return; }
      await updateAccountField(rowId, 'owner', trimmed);
      showToast('Ownership reassigned.');
    }
    function leaverTickRow(entry, key, mainText, caveatText, extra) {
      const id = `leaver-tick-${key}`;
      const cb = el('input', { type: 'checkbox', id, class: 'my-leaver-tick', checked: !!(entry.ticks || {})[key] });
      cb.addEventListener('change', () => toggleLeaverTick(entry.person, key));
      return el('li', { class: 'my-leaver-item' },
        el('label', { for: id, class: 'my-leaver-tick-label' },
          cb,
          el('span', {}, mainText, caveatText ? el('strong', { class: 'my-leaver-caveat' }, ` ${caveatText}`) : null),
        ),
        extra || null,
      );
    }
    function leaverPhaseSection(number, title, itemsHtml) {
      return el('div', { class: 'my-leaver-phase' },
        el('h3', {}, `${number} ${title}`),
        itemsHtml.length ? el('ul', { class: 'my-leaver-item-list' }, ...itemsHtml) : el('p', { class: 't-meta' }, 'Nothing here for this person.'),
      );
    }
    function screenLeavers() {
      const ui = state.leaversUi;
      const owners = distinctOwners(doc);
      const select = el('select', { class: 'select', 'aria-label': 'Choose who is leaving' },
        el('option', { value: '' }, 'Choose a person…'),
        ...owners.map((o) => el('option', { value: o, selected: ui.person === o && !ui.customPerson }, o)),
      );
      select.addEventListener('change', () => { ui.person = select.value; ui.customPerson = ''; draw(); });

      // Free text overrides the dropdown the instant a reader starts typing
      // (the same "custom beats picked" rule the click handler below reads
      // live too), so this field redraws on every keystroke rather than the
      // usual UI-state-only update: this screen's Generate/Regenerate label,
      // its disabled state and its own click target all depend on knowing
      // NOW who is chosen, not who was chosen when this render last ran.
      // draw() already preserves focus and cursor position by data-focus-key
      // (module comment, top of file) for exactly this kind of exception,
      // the same pattern the accounts search field already uses.
      const customInput = el('input', {
        class: 'input', type: 'text', placeholder: 'Or type a name not listed above…',
        value: ui.customPerson, dataset: { focusKey: 'leaver-custom-person' },
      });
      customInput.addEventListener('input', () => { ui.customPerson = customInput.value; draw(); });

      const chosenPerson = (ui.customPerson || '').trim() || ui.person;
      const existingEntry = chosenPerson ? findLeaverEntry(doc, chosenPerson) : null;
      const genBtn = el('button', { class: 'btn btn-primary', type: 'button', disabled: !chosenPerson },
        existingEntry ? 'Regenerate checklist' : 'Generate checklist');
      // Belt and braces on top of the redraw above: read the live state
      // directly rather than trusting the `chosenPerson` this particular
      // render closed over, so a click can never fire for a stale person
      // even if some future code path changes ui.person/ui.customPerson
      // without going through draw() first.
      genBtn.addEventListener('click', () => {
        const livePerson = (ui.customPerson || '').trim() || ui.person;
        generateLeaverChecklist(livePerson);
      });

      const picker = el('div', { class: 'panel my-leaver-picker no-print' },
        el('div', { class: 'my-field' }, el('span', { class: 't-small' }, 'Person leaving'), select),
        el('div', { class: 'my-field' }, customInput),
        genBtn,
      );

      let checklistOut = null;
      if (existingEntry) {
        // Section 16: "an account that does not exist yet is a plan, not a
        // risk", so it enters none of the five offboarding phases. The
        // planned-row exclusion now lives inside leaverChecklist itself
        // (risks.js, BUILD-PLAN 12.4 fix round, 27 Jul), the one place this
        // checklist is built, rather than trusting this call site alone.
        const phases = leaverChecklist(doc.accounts, chosenPerson);
        const printBtn = el('button', { class: 'btn btn-secondary no-print', type: 'button' }, 'Print checklist');
        printBtn.addEventListener('click', () => window.print());

        const phase1 = phases.phase1.map((item) => leaverTickRow(existingEntry, item.key, item.text, item.caveat));
        const phase2 = phases.phase2.map((item) => {
          const draftKey = item.row.id;
          const draftVal = ui.reassignDrafts[draftKey] ?? '';
          const input = el('input', {
            class: 'input my-leaver-reassign-input', type: 'text', placeholder: 'Reassign to…',
            value: draftVal, dataset: { focusKey: `leaver-reassign-${draftKey}` },
          });
          input.addEventListener('input', () => { ui.reassignDrafts[draftKey] = input.value; });
          const btn = el('button', { class: 'btn btn-secondary btn-sm no-print', type: 'button' }, 'Reassign');
          btn.addEventListener('click', () => reassignLeaverRow(draftKey, ui.reassignDrafts[draftKey]));
          const extra = el('div', { class: 'my-leaver-reassign' }, input, btn);
          return leaverTickRow(existingEntry, item.key, `Reassign ${item.row.service || 'this account'}.`, null, extra);
        });
        const phase3 = phases.phase3.map((item) => leaverTickRow(existingEntry, item.key,
          `Change the login for ${item.row.service || 'this account'} in your password manager.`,
          'This register never holds passwords: rotate it there, not here.'));
        const phase4 = phases.phase4.map((item) => leaverTickRow(existingEntry, item.key,
          `Reclaim the seat and stop payment for ${item.row.service || 'this account'}${item.row.monthlyCost ? ` (${money(item.row.monthlyCost)}/mo)` : ''}.`));
        const phase5 = phases.phase5.map((item) => leaverTickRow(existingEntry, item.key, item.text, item.caveat));

        // Honesty line (BUILD-PLAN 12.4 fix round, 27 Jul): the free-text
        // path deliberately still lets the reader type any name and get a
        // checklist (a real leaver's mailbox and identity-provider account
        // exist whether or not this register recorded anything about them,
        // and typing the name is the reader asserting they are real), but
        // when the register itself holds no non-planned row for this
        // person, that must be stated plainly rather than left to read as
        // real, specific guidance. Sits at the top of the phase 2 to 4
        // region, since phase1 and phase5 above and below it are exactly
        // the generic steps this note is talking about.
        const noRecordedNote = !phases.hasRecordedRows ? el('p', { class: 'my-leaver-honesty', role: 'status' },
          `The register has no live accounts recorded for ${chosenPerson}. The identity and mailbox steps above and below are generic guidance for any leaver, not drawn from anything recorded here.`) : null;

        checklistOut = el('div', { class: 'my-leaver-checklist' },
          el('h2', { class: 'my-leaver-heading' }, `Offboarding checklist: ${chosenPerson}`),
          el('p', { class: 't-meta' }, `Generated ${formatDate(existingEntry.generatedAt)}.`),
          printBtn,
          leaverPhaseSection(1, 'Identity first', phase1),
          noRecordedNote,
          leaverPhaseSection(2, 'Transfer ownership', phase2),
          leaverPhaseSection(3, 'Rotate what they knew', phase3),
          leaverPhaseSection(4, 'Licences and money', phase4),
          leaverPhaseSection(5, 'Final closure', phase5),
        );
      }

      return el('section', { class: 'my-screen' },
        el('h2', { class: 'no-print' }, 'Leavers'),
        el('p', { class: 't-body no-print' }, 'Pick who is leaving to generate their offboarding checklist, in the order that keeps you in control of accounts before their sign-in disappears.'),
        picker,
        checklistOut,
      );
    }

    /** Verified export (section 8): always records lastExportAt via
        store.exportBlob() itself, then confirms the round trip. A plaintext
        register gets the same full silent re-import-and-compare setup
        already uses. An encrypted one now gets a genuine decrypt round
        trip too (Wave C fix): store.exportBlob() itself decrypts the bytes
        it just serialised with whatever key it is already holding in
        memory and reports the real result, no re-prompt needed, and no
        structural-only check that a tampered ciphertext byte could slip
        past (AES-GCM's authentication tag cannot). */
    async function runVerifiedExport() {
      const { blob, verified: storeVerified, verifyError } = await store.exportBlob();
      const text = await blob.text();
      let verified = storeVerified;
      let verifyNote;
      if (currentStatus.encrypted) {
        verifyNote = verified
          ? 'saved; its contents were test-decrypted and checked out'
          : (verifyError || 'saved, but could not be verified');
      } else {
        try {
          const imported = await store.importBlob(text);
          verified = imported.document.business === doc.business && imported.document.accounts.length === doc.accounts.length;
          verifyNote = verified ? 'saved, exported and read back successfully: the round trip checks out' : 'saved, but the verification re-import did not match';
        } catch (err) {
          verified = false;
          verifyNote = err.message || 'saved, but verification failed';
        }
      }
      return { blob, verified, verifyNote };
    }

    async function handleDownload() {
      try {
        const { blob, verified, verifyNote } = await runVerifiedExport();
        downloadBlob(blob, exportFilename(doc.business));
        await refreshStatusNow();
        showToast(`Backup downloaded: ${verifyNote}.`, verified ? 'success' : 'error');
        draw();
      } catch (err) {
        showToast(err.message || 'Export failed', 'error');
      }
    }
    async function handleShareFile() {
      try {
        const { blob, verified, verifyNote } = await runVerifiedExport();
        const filename = exportFilename(doc.business);
        const file = new File([blob], filename, { type: 'application/json' });
        await navigator.share({ files: [file], title: filename });
        await refreshStatusNow();
        showToast(`Backup shared: ${verifyNote}.`, verified ? 'success' : 'error');
        draw();
      } catch (err) {
        if (err && err.name === 'AbortError') return; // reader dismissed the share sheet: not an error
        showToast('Could not open the share sheet; use Download instead.', 'error');
      }
    }

    /* --- Import (section 8): drag-drop or file picker, passphrase on an
       envelope, a preview before anything is replaced. The file picker is
       the PRIMARY path (a visible button, not a hidden drop target alone):
       drag-and-drop has no equivalent on a touch device, so it can only
       ever be a bonus for a mouse, never the only way in. ------------------ */
    async function tryImportText(text, passphrase) {
      const ui = state.backupUi;
      ui.importError = null;
      try {
        const result = await store.importBlob(text, passphrase);
        ui.importPreview = result;
      } catch (err) {
        if (/passphrase is needed/.test(err.message || '')) {
          ui.importPreview = { needsPassphrase: true };
        } else {
          ui.importPreview = null;
          ui.importError = err.message || 'Could not read that file.';
        }
      }
      draw();
    }
    async function handleImportFile(file) {
      const ui = state.backupUi;
      ui.importFile = file;
      ui.importPassphrase = '';
      const text = await file.text();
      ui.importText = text;
      await tryImportText(text, undefined);
    }
    function cancelImport() {
      const ui = state.backupUi;
      ui.importFile = null; ui.importText = null; ui.importPreview = null;
      ui.importPassphrase = ''; ui.importError = null;
      draw();
    }
    async function commitImportReplace() {
      const ui = state.backupUi;
      const preview = ui.importPreview;
      if (!preview || !preview.document) return;
      try {
        if (preview.encrypted && ui.importPassphrase) await store.unlock(ui.importPassphrase);
        const saved = await store.save(preview.document, state.expectedRevision);
        state.doc = saved;
        state.expectedRevision = saved.revision;
        cancelImport();
        await refreshStatusNow();
        showToast('Register replaced from the imported file.');
        draw();
      } catch (err) {
        if (err instanceof store.ConflictError) { state.banner = { kind: 'external-write' }; }
        else showToast(err.message || 'Could not import that file.', 'error');
        draw();
      }
    }

    function renderImportSection() {
      const ui = state.backupUi;
      const fileInput = el('input', { type: 'file', accept: '.json,application/json', class: 'my-import-file-input', 'aria-hidden': 'true' });
      fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleImportFile(fileInput.files[0]); });
      // A primary workspace action (section 14): 44px minimum, same btn-lg
      // used for the equivalent primary actions in first-run and setup.
      const pickBtn = el('button', { class: 'btn btn-primary btn-lg', type: 'button' }, 'Choose a file to import');
      pickBtn.addEventListener('click', () => fileInput.click());

      const dropZone = el('div', {
        class: `my-import-drop${ui.dragOver ? ' is-dragover' : ''}`,
      }, pickBtn, el('p', { class: 't-meta' }, 'Or drag a .fsr.json file here.'), fileInput);
      dropZone.addEventListener('dragover', (e) => { e.preventDefault(); ui.dragOver = true; draw(); });
      dropZone.addEventListener('dragleave', () => { ui.dragOver = false; draw(); });
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        ui.dragOver = false;
        const file = e.dataTransfer?.files?.[0];
        if (file) handleImportFile(file);
        else draw();
      });

      const errorMsg = ui.importError ? el('p', { class: 'my-error', role: 'alert' }, ui.importError) : null;

      let previewPanel = null;
      if (ui.importPreview?.needsPassphrase) {
        const pInput = el('input', { class: 'input', type: 'password', placeholder: 'Passphrase', autocomplete: 'current-password' });
        pInput.addEventListener('input', () => { ui.importPassphrase = pInput.value; });
        const unlockBtn = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Unlock and preview');
        unlockBtn.addEventListener('click', () => tryImportText(ui.importText, ui.importPassphrase));
        const cancelBtn = el('button', { class: 'btn btn-ghost', type: 'button' }, 'Cancel');
        cancelBtn.addEventListener('click', cancelImport);
        previewPanel = el('div', { class: 'panel my-import-preview' },
          el('p', { class: 't-body' }, 'This register file is encrypted: enter its passphrase to preview it.'),
          pInput,
          el('div', { class: 'my-setup-actions' }, unlockBtn, cancelBtn),
        );
      } else if (ui.importPreview?.document) {
        const meta = ui.importPreview.meta;
        const conflictNote = (meta.updatedAt && doc.updatedAt && new Date(doc.updatedAt) > new Date(meta.updatedAt))
          ? el('p', { class: 'my-error', role: 'alert' },
            `This register here was last changed ${formatDate(doc.updatedAt)}, which is newer than this file (${formatDate(meta.updatedAt)}). Replacing will lose anything changed here since the file was made.`)
          : null;
        const replaceBtn = el('button', { class: 'btn btn-primary', type: 'button' }, 'Replace this register');
        replaceBtn.addEventListener('click', commitImportReplace);
        const cancelBtn = el('button', { class: 'btn btn-ghost', type: 'button' }, 'Cancel');
        cancelBtn.addEventListener('click', cancelImport);
        previewPanel = el('div', { class: 'panel my-import-preview' },
          el('h3', {}, 'Before replacing this register'),
          el('dl', { class: 'my-status-list' },
            el('dt', {}, 'Business'), el('dd', {}, meta.business || 'Untitled'),
            el('dt', {}, 'Accounts'), el('dd', {}, String(meta.accountCount)),
            el('dt', {}, 'Last updated'), el('dd', {}, meta.updatedAt ? formatDate(meta.updatedAt) : 'Unknown'),
          ),
          conflictNote,
          el('div', { class: 'my-setup-actions' }, replaceBtn, cancelBtn),
        );
      }

      return el('div', { class: 'my-backup-section' },
        el('h3', {}, 'Import a register file'),
        dropZone,
        errorMsg,
        previewPanel,
      );
    }

    /* --- Encryption enable/disable (section 7): same consequence flow as
       setup, reached from here instead. -------------------------------------- */
    function startEnableEncryption() {
      const ui = state.backupUi;
      ui.encFlow = 'consequence'; ui.encPassphrase1 = ''; ui.encPassphrase2 = ''; ui.encRecoveryDone = false; ui.encError = null;
      draw();
    }
    function cancelEncFlow() { state.backupUi.encFlow = null; draw(); }
    async function commitEnableEncryption() {
      const ui = state.backupUi;
      ui.encFlow = 'verifying';
      draw();
      try {
        await store.unlock(ui.encPassphrase1);
        const saved = await store.save(state.doc, state.expectedRevision);
        state.doc = saved;
        state.expectedRevision = saved.revision;
        const { blob } = await store.exportBlob();
        const text = await blob.text();
        const imported = await store.importBlob(text, ui.encPassphrase1);
        const ok = imported.document.business === saved.business && imported.document.accounts.length === saved.accounts.length;
        if (!ok) throw new Error('The verification re-import did not match what was saved.');
        await refreshStatusNow();
        ui.encFlow = null;
        showToast('Encryption switched on and verified.');
      } catch (err) {
        ui.encFlow = 'passphrase';
        ui.encError = err.message || 'Something went wrong turning encryption on.';
      }
      draw();
    }
    function startDisableEncryption() { state.backupUi.encFlow = 'disable-consequence'; draw(); }
    async function commitDisableEncryption() {
      try {
        const saved = await store.save(state.doc, state.expectedRevision, { forcePlain: true });
        state.doc = saved;
        state.expectedRevision = saved.revision;
        await refreshStatusNow();
        state.backupUi.encFlow = null;
        showToast('Encryption turned off. This register is now stored as plain text on this device.');
      } catch (err) {
        showToast(err.message || 'Could not turn off encryption.', 'error');
      }
      draw();
    }

    function renderEncryptionSection() {
      const ui = state.backupUi;
      const st = currentStatus;
      if (ui.encFlow === 'consequence') {
        const back = el('button', { class: 'btn btn-ghost', type: 'button' }, 'Cancel');
        back.addEventListener('click', cancelEncFlow);
        const cont = el('button', { class: 'btn btn-primary', type: 'button' }, 'I understand, continue');
        cont.addEventListener('click', () => { ui.encFlow = 'passphrase'; draw(); });
        return el('div', { class: 'my-backup-section' }, el('h3', {}, 'Before you set a passphrase'),
          el('p', { class: 'my-consequence' }, CONSEQUENCE_SENTENCE),
          el('div', { class: 'my-setup-actions' }, back, cont));
      }
      if (ui.encFlow === 'passphrase') {
        const p1 = el('input', { class: 'input', type: 'password', autocomplete: 'new-password', value: ui.encPassphrase1 });
        p1.addEventListener('input', () => { ui.encPassphrase1 = p1.value; });
        const p2 = el('input', { class: 'input', type: 'password', autocomplete: 'new-password', value: ui.encPassphrase2 });
        p2.addEventListener('input', () => { ui.encPassphrase2 = p2.value; });
        const err = ui.encError ? el('p', { class: 'my-error', role: 'alert' }, ui.encError) : null;
        const back = el('button', { class: 'btn btn-ghost', type: 'button' }, 'Cancel');
        back.addEventListener('click', cancelEncFlow);
        const cont = el('button', { class: 'btn btn-primary', type: 'button' }, 'Continue');
        cont.addEventListener('click', () => {
          if (ui.encPassphrase1.length < MIN_PASSPHRASE) { ui.encError = `Use at least ${MIN_PASSPHRASE} characters.`; draw(); return; }
          if (ui.encPassphrase1 !== ui.encPassphrase2) { ui.encError = 'Those two do not match.'; draw(); return; }
          ui.encError = null;
          ui.encFlow = 'recovery';
          draw();
        });
        return el('div', { class: 'my-backup-section' }, el('h3', {}, 'Choose a passphrase'),
          el('label', { class: 'my-field' }, el('span', { class: 't-small' }, 'Passphrase'), p1),
          el('label', { class: 'my-field' }, el('span', { class: 't-small' }, 'Enter it again'), p2),
          err, el('div', { class: 'my-setup-actions' }, back, cont));
      }
      if (ui.encFlow === 'recovery') {
        const html = buildRecoverySheetHtml(doc.business, todayIso());
        const dl = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Download recovery sheet');
        dl.addEventListener('click', () => { downloadBlob(new Blob([html], { type: 'text/html' }), `mystack-recovery-sheet-${slugify(doc.business)}.html`); ui.encRecoveryDone = true; draw(); });
        const cont = el('button', { class: 'btn btn-primary', type: 'button', disabled: !ui.encRecoveryDone }, "I've saved my recovery sheet");
        cont.addEventListener('click', commitEnableEncryption);
        return el('div', { class: 'my-backup-section' }, el('h3', {}, 'Save a recovery sheet'),
          el('p', { class: 't-body' }, 'My Stack never stores your passphrase, so this sheet is the only backstop if you forget it.'),
          dl, ui.encRecoveryDone ? el('p', { class: 'my-ok' }, 'Recovery sheet saved.') : null, cont);
      }
      if (ui.encFlow === 'verifying') {
        return el('div', { class: 'my-backup-section' }, el('h3', {}, 'Turning encryption on…'), el('p', { class: 't-body' }, 'Saving, exporting and test-decrypting your register. This takes a moment.'));
      }
      if (ui.encFlow === 'disable-consequence') {
        const back = el('button', { class: 'btn btn-ghost', type: 'button' }, 'Cancel');
        back.addEventListener('click', cancelEncFlow);
        const confirm = el('button', { class: 'btn btn-primary', type: 'button' }, 'Turn off encryption');
        confirm.addEventListener('click', commitDisableEncryption);
        return el('div', { class: 'my-backup-section' }, el('h3', {}, 'Turn off encryption?'),
          el('p', { class: 'my-consequence' }, 'Turning this off decrypts your register: the file on disk becomes readable by anyone who has it.'),
          el('div', { class: 'my-setup-actions' }, back, confirm));
      }
      // Idle: offer the relevant action for the current state.
      if (st.encrypted) {
        const btn = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Turn off encryption');
        btn.addEventListener('click', startDisableEncryption);
        return el('div', { class: 'my-backup-section' }, el('h3', {}, 'Encryption'),
          el('p', { class: 't-body' }, 'This register is encrypted with a passphrase on this device.'), btn);
      }
      const btn = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Set a passphrase');
      btn.addEventListener('click', startEnableEncryption);
      return el('div', { class: 'my-backup-section' }, el('h3', {}, 'Encryption'),
        el('p', { class: 't-body' }, 'Off by default. A passphrase encrypts this register on this device, on top of it being ', STORAGE_PHRASE, '.'), btn);
    }

    /* --- Wipe workspace (section 9.6): typed confirmation -------------------- */
    async function commitWipe() {
      const ui = state.backupUi;
      if (ui.wipeText.trim() !== (doc.business || '').trim()) {
        ui.wipeError = 'Type the business name exactly to confirm.';
        draw();
        return;
      }
      await store.wipe();
      location.reload();
    }
    function renderWipeSection() {
      const ui = state.backupUi;
      const input = el('input', { class: 'input', type: 'text', placeholder: doc.business, value: ui.wipeText, dataset: { focusKey: 'wipe-confirm' } });
      input.addEventListener('input', () => { ui.wipeText = input.value; });
      const err = ui.wipeError ? el('p', { class: 'my-error', role: 'alert' }, ui.wipeError) : null;
      const btn = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Wipe this workspace');
      btn.addEventListener('click', commitWipe);
      return el('div', { class: 'my-backup-section my-backup-wipe' },
        el('h3', {}, 'Wipe this workspace'),
        el('p', { class: 't-body' }, 'Deletes this register from this browser, on this device, for good. Your exported files are unaffected. Type the business name below to confirm.'),
        el('label', { class: 'my-field' }, el('span', { class: 't-small' }, `Type "${doc.business}" to confirm`), input),
        err, btn,
      );
    }

    function screenBackup() {
      const st = currentStatus;
      const age = backupAgeInfo(st.lastExportAt, st.savesSinceExport);
      const rows = [
        ['Saved in this browser', st.storageOk ? 'Yes, on this device' : 'No, this browser is not remembering data'],
        ['Persistent storage granted', st.persisted ? 'Yes' : 'Not granted; the browser may still evict this if the device runs low on space'],
        ['Encrypted with a passphrase', st.encrypted ? 'Yes' : 'No, off by default'],
        ['Last export', st.lastExportAt ? formatDate(st.lastExportAt) : 'Never'],
        ['Backup age', age.text],
        ['Changes since last export', String(st.savesSinceExport || 0)],
      ];
      const list = el('dl', { class: 'my-status-list' },
        ...rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));

      const downloadBtn = el('button', { class: 'btn btn-primary', type: 'button', disabled: state.example }, 'Download a backup now');
      downloadBtn.addEventListener('click', handleDownload);
      const shareBtn = (!state.example && canShareFiles()) ? (() => {
        const b = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Send your backup somewhere safe');
        b.addEventListener('click', handleShareFile);
        return b;
      })() : null;

      const homeScreenNote = (isIosSafari(navigator.userAgent) && !navigator.standalone) ? el('div', { class: 'my-backup-section' },
        el('h3', {}, 'Add to your Home Screen'),
        el('p', { class: 't-body' }, 'On an iPhone, adding this page to your Home Screen (Share, then "Add to Home Screen") gives it its own storage counter, separate from the rest of Safari, which honestly means a little more room before anything here is at risk of eviction. It does not change anything about ', STORAGE_PHRASE, '.'),
      ) : null;

      // Reading-copy exports (section 20): CSV, TXT and print-to-PDF, below
      // the register file above (§8/§20's "primary export presented first,
      // visually subordinate" rule), never touching savesSinceExport or the
      // verified-backup date (no store.save()/exportBlob() call anywhere in
      // these three handlers). Rendered from the unlocked in-memory
      // document only: absent entirely while example (no register of the
      // reader's own to export) or `st.locked` (section 20: "a locked
      // register offers no reading-copy controls"). In this app shell a
      // locked register normally never reaches this screen at all (the lock
      // gate replaces the whole shell, viewLocked() not viewShell()), so
      // `st.locked` here is a defensive second line, not the only guard.
      function handleDownloadCsv() { downloadBlob(new Blob([buildCsv(doc)], { type: 'text/csv' }), readingCopyFilename(doc.business, 'csv')); }
      function handleDownloadTxt() { downloadBlob(new Blob([buildTxt(doc)], { type: 'text/plain' }), readingCopyFilename(doc.business, 'txt')); }
      function handlePrintReadingCopy() { printReadingCopySheet(doc); }
      let readingCopySection = null;
      if (!state.example) {
        if (st.locked) {
          readingCopySection = el('div', { class: 'my-backup-section my-reading-copy-section' },
            el('h3', {}, 'Reading copies'),
            el('p', { class: 't-body' }, 'This register is locked. Unlock it with your passphrase first.'),
          );
        } else {
          const csvBtn = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Download as CSV');
          csvBtn.addEventListener('click', handleDownloadCsv);
          const txtBtn = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Download as text');
          txtBtn.addEventListener('click', handleDownloadTxt);
          const printBtn = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Print or save as PDF');
          printBtn.addEventListener('click', handlePrintReadingCopy);
          readingCopySection = el('div', { class: 'my-backup-section my-reading-copy-section' },
            el('h3', {}, 'Reading copies'),
            el('p', { class: 't-body' }, READING_COPY_LAW, ' Keep the register file above as your real backup.'),
            el('div', { class: 'my-setup-actions' }, csvBtn, txtBtn, printBtn),
          );
        }
      }

      return el('section', { class: 'my-screen' },
        el('h2', {}, 'Backup'),
        el('p', { class: 't-body' }, 'The export file you download is the copy that truly lasts. Everything ', STORAGE_PHRASE, ' can be lost if you clear browsing data or switch devices.'),
        list,
        el('div', { class: 'my-backup-section' },
          el('h3', {}, 'Export'),
          state.example ? el('p', { class: 't-meta' }, 'Exports are disabled while exploring the example register.') : el('div', { class: 'my-setup-actions' }, downloadBtn, shareBtn),
        ),
        readingCopySection,
        state.example ? null : renderImportSection(),
        state.example ? null : renderEncryptionSection(),
        homeScreenNote,
        el('div', { class: 'my-backup-section' },
          el('h3', {}, 'Your privacy'),
          el('p', { class: 't-body' }, PRIVACY_NOTICE),
          el('p', { class: 't-meta' },
            el('a', { href: '/why-register.html', target: '_blank', rel: 'noopener noreferrer' }, 'Why we built this'),
            ', including the evidence behind it and what a passphrase does and does not protect.'),
          el('p', { class: 't-meta' },
            el('a', { href: '/privacy.html', target: '_blank', rel: 'noopener noreferrer' }, 'Privacy'),
            ' · ',
            el('a', { href: '/contact.html', target: '_blank', rel: 'noopener noreferrer' }, 'Contact'),
            '.'),
        ),
        state.example ? null : renderWipeSection(),
      );
    }

    const generatorSheet = (!state.example && state.generatorUi) ? renderGeneratorSheet() : null;
    const container = el('div', { class: 'my-shell' }, sidebar, el('div', { class: 'my-content' }, exampleBanner, reloadBanner, mergeBanner, undoBanner, nagBanner, topbar, generatorSheet, main));
    // A lazy top-up on top of the deliberate refreshes at mode transitions:
    // status() is async, so if it changed since the snapshot this render
    // used, quietly redraw once. The equality check is what stops this from
    // looping forever, since a redraw would otherwise re-arm the same check.
    if (!state.example) {
      const before = JSON.stringify(currentStatus);
      refreshStatusNow().then(() => {
        if (state.mode === 'app' && JSON.stringify(lastKnownStatus) !== before) draw();
      });
    }
    return container;
  }

  await boot();
}
