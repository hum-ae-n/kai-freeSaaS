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

/* --- house-voice constants, verbatim per PRD-REGISTER ---------------------- */
const POSITIONING_SENTENCE = 'Your password manager holds the keys; the register is the keyring label: which doors exist, who holds which key, and which keys to collect when someone leaves.';
const CONSEQUENCE_SENTENCE = 'If you forget this passphrase, nobody can recover this register. Not you, not us. There is no reset.';
// Approved storage phrasing (section 3): never "safe", never "stored securely".
const STORAGE_PHRASE = 'saved in this browser, on this device';
const MIN_PASSPHRASE = 8; // not specified by the PRD to the character; a defensible floor, noted in the build report
// Verbatim, section 11: Backup screen and (Wave D) the awareness page.
const PRIVACY_NOTICE = 'Your My Stack register is stored only in your own browser: nothing you type is ever sent to us, and if you set a passphrase it is encrypted on your device with a key we never see, so we could not read your register even if we wanted to. Because we cannot see it, we also cannot recover it: if you lose your passphrase, your encrypted register cannot be unlocked, so keep a safe copy of your export. Our hosting provider, Netlify, briefly keeps standard access logs (including IP addresses, held for around 30 days) to run the site; we run no analytics and set no tracking cookies.';

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
const STATUS_LABEL = { active: 'Active', 'to-close': 'To close', closed: 'Closed' };
// My tools (section 9.3): the same statuses, worded as an adoption echo.
const ADOPTION_LABEL = { active: 'In use', 'to-close': 'To close', closed: 'Closed' };

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
function buildRecoverySheetHtml(business, date) {
  const body = el('div', {},
    el('h1', {}, 'My Stack recovery sheet'),
    el('p', {}, `${business}, generated ${date}.`),
    el('p', {}, CONSEQUENCE_SENTENCE),
    el('p', {}, 'Write your passphrase in the box below by hand, then keep this sheet somewhere safe and separate from this device.'),
    el('div', { style: 'border:2px solid #000;height:80px;margin:16px 0;' }),
    el('p', {}, 'My Stack never stores your passphrase and cannot recover it for you.'),
  );
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>My Stack recovery sheet</title></head><body>${body.innerHTML}</body></html>`;
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
/** One register row per stack tool (section 2, section 9.7, section 15.2):
    service and address filled in from the catalogue, identity and owner
    deliberately left blank since nobody but the reader knows who opened the
    account or with what address. `tool.urls[0].domain` is a bare hostname
    (CLAUDE.md's own note on that field), so the https:// prefix is added
    here to satisfy the register schema's "https URL" for `url`. */
function buildRowFromTool(tool) {
  const domain = tool.urls && tool.urls[0] && tool.urls[0].domain;
  return blankAccount({ service: tool.name, url: domain ? `https://${domain}` : '', toolId: tool.id });
}
function cloneDoc(doc) {
  return typeof structuredClone === 'function' ? structuredClone(doc) : JSON.parse(JSON.stringify(doc));
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
    mergePreview: null, // { ids, ticked, open }: ?from= against an EXISTING register
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

  // ?from= (section 2, 9.7, 15.2): parsed exactly like data-loader's own
  // parseSelection (imported, not reimplemented), so id 0 is exactly as
  // valid here as anywhere else on the site. Resolving it needs the tool
  // catalogue, which this module fetches for itself (an absolute path, so
  // it resolves the same whether the visited path is /my or /my/, unlike a
  // relative fetch would). null = no ?from= param at all; [] = the param
  // was present but named no tool ids this catalogue recognises.
  const fromRaw = new URLSearchParams(location.search).get('from');
  let fromIds = null;
  let toolsCache = null;
  async function ensureTools() {
    if (!toolsCache) {
      const res = await fetch('/data/tools.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toolsCache = await res.json();
    }
    return toolsCache;
  }
  async function resolveFromIds() {
    if (fromRaw == null) return;
    try {
      const tools = await ensureTools();
      fromIds = parseSelection(fromRaw, tools);
    } catch {
      fromIds = []; // catalogue unreachable: degrade to "nothing to import", never block the workspace
    }
  }

  /** My tools (section 9.3) and Costs (section 9.4) both want the tool
      catalogue for names/descriptions/icons, but neither can await a fetch
      mid-render (view() is synchronous). Fire the fetch at most once, then
      redraw when it lands; a no-op once toolsCache is warm, which resolveFromIds()
      above may already have done for a ?from= visit. */
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
    await resolveFromIds();
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

  /** Merge preview (section 2, 9.7, 15.2): a returning visitor arriving with
      ?from= on a register that already exists. Only tools not already
      present by toolId are offered, so re-visiting the same shared link
      twice can never duplicate a row. Computed once on entry, not on every
      redraw, so dismissing it (or applying it) does not get recomputed back
      into existence a frame later. */
  async function computeMergePreview() {
    if (!fromIds || !fromIds.length || state.example) { state.mergePreview = null; return; }
    try {
      const tools = await ensureTools();
      const byId = new Map(tools.map((t) => [t.id, t]));
      const existingToolIds = new Set(state.doc.accounts.map((a) => a.toolId).filter((v) => v !== null && v !== undefined));
      const newIds = fromIds.filter((id) => !existingToolIds.has(id) && byId.has(id));
      state.mergePreview = newIds.length ? { ids: newIds, ticked: new Set(newIds), open: false } : null;
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
      stackAccounts: [], templatesTicked: new Set(), fromStack: !!fromStack,
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
    if (fromIds && fromIds.length) {
      const stackBtn = el('button', { class: 'btn btn-primary btn-lg', type: 'button' },
        `Start from your stack (${fromIds.length} tool${fromIds.length === 1 ? '' : 's'})`);
      stackBtn.addEventListener('click', () => {
        state.mode = 'setup';
        state.setup = defaultSetupState(true);
        draw();
      });
      stackChoice = el('div', { class: 'my-firstrun-choice' },
        el('h3', {}, 'Start from your shared stack'),
        el('p', { class: 't-body' }, 'Pre-fill one account row per tool from the link you followed here: service name and address filled in, identity and owner left for you to complete.'),
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
        'Your register is ', STORAGE_PHRASE, '. Nothing you type is ever sent to Kaipability.'),
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
      if (s.fromStack && fromIds && fromIds.length) {
        const tools = toolsCache || [];
        const byId = new Map(tools.map((t) => [t.id, t]));
        s.stackAccounts = fromIds.map((id) => byId.get(id)).filter((t) => t !== undefined).map(buildRowFromTool);
      } else {
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

    const stackList = s.stackAccounts.length ? el('div', { class: 'my-review-block' },
      el('p', { class: 't-small' }, `From your shared stack, ${s.stackAccounts.length} account${s.stackAccounts.length === 1 ? '' : 's'} will be added:`),
      el('ul', { class: 'my-attention-list' }, ...s.stackAccounts.map((r) => el('li', {}, r.service))),
    ) : null;

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
      const win = window.open('', '_blank', 'noopener,noreferrer');
      if (!win) { showToast('Your browser blocked the print window; use Download instead.', 'error'); return; }
      win.document.write(html);
      win.document.close();
      win.focus();
      win.print();
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
  async function applyMerge(ids) {
    const tools = toolsCache || [];
    const byId = new Map(tools.map((t) => [t.id, t]));
    state.mergePreview = null; // clears the instant the matching rows land, not a frame later
    const saved = await mutateDoc((doc) => {
      const existingToolIds = new Set(doc.accounts.map((a) => a.toolId).filter((v) => v !== null && v !== undefined));
      for (const id of ids) {
        if (existingToolIds.has(id)) continue; // never duplicates, per section 15.2
        const tool = byId.get(id);
        if (!tool) continue;
        doc.accounts.push(buildRowFromTool(tool));
        existingToolIds.add(id);
      }
      return doc;
    });
    if (saved) showToast('Accounts added from your shared stack.');
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
      const counts = {
        'personal-email': accounts.filter((a) => isPersonalEmail(a.identity)).length,
        'no-mfa': accounts.filter((a) => mfaRiskLabel(a.mfa) !== null).length,
        'no-owner': accounts.filter((a) => hasNoOwner(a.owner)).length,
        'renewing-soon': accounts.filter((a) => isRenewalSoon(a.renewal)).length,
      };
      function tile(value, labelText, level, onClick) {
        const btn = el('button', { class: `panel my-tile${level ? ` my-tile-${level}` : ''}`, type: 'button' },
          el('span', { class: 'my-tile-value' }, String(value)),
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
      // one-tap jump straight to that row's drawer.
      const noOwnerRows = accounts.filter((a) => hasNoOwner(a.owner));
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
        const clear = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, 'Clear selection');
        clear.addEventListener('click', () => { ui.selected.clear(); draw(); });
        bulkBar = el('div', { class: 'my-bulk-bar' }, el('span', { class: 't-small' }, `${ui.selected.size} selected`), input, apply, clear);
      }

      const addBtn = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, 'Add account');
      addBtn.addEventListener('click', () => addAccount());
      const templatesBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, 'Add from templates');
      templatesBtn.addEventListener('click', () => { ui.templatesOpen = !ui.templatesOpen; draw(); });
      const headerActions = readOnly ? null : el('div', { class: 'my-accounts-actions' }, addBtn, templatesBtn);
      const templatesPanel = (!readOnly && ui.templatesOpen) ? renderTemplatesPicker() : null;

      const table = accounts.length ? renderAccountsTable(filtered, readOnly) : null;
      const emptyMsg = !accounts.length
        ? el('p', { class: 't-body' }, 'No accounts recorded yet. Add one by hand, from a template, or from a shared stack link.')
        : (filtered.length ? null : el('p', { class: 't-body' }, 'No accounts match this search or these filters.'));

      return el('section', { class: 'my-screen' },
        el('h2', {}, 'Accounts'),
        readOnly ? el('p', { class: 't-meta' }, 'This is an example register: editing is switched off. Start your own register to add and edit real accounts.') : null,
        headerActions,
        templatesPanel,
        filterBar,
        bulkBar,
        emptyMsg,
        table,
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

    function renderMergeBanner() {
      const mp = state.mergePreview;
      if (!mp.open) {
        const review = el('button', { class: 'btn btn-sm btn-primary', type: 'button' }, 'Review');
        review.addEventListener('click', () => { mp.open = true; draw(); });
        const dismiss = el('button', { class: 'btn btn-sm btn-ghost', type: 'button' }, 'Dismiss');
        dismiss.addEventListener('click', () => { state.mergePreview = null; draw(); });
        return el('div', { class: 'my-banner my-banner-merge', role: 'status' },
          `Your stack link includes ${mp.ids.length} tool${mp.ids.length === 1 ? '' : 's'} not yet in this register. `,
          review, dismiss);
      }
      const tools = toolsCache || [];
      const byId = new Map(tools.map((t) => [t.id, t]));
      const rows = mp.ids.map((id) => {
        const tool = byId.get(id);
        const cbId = `merge-${id}`;
        const cb = el('input', { type: 'checkbox', id: cbId, checked: mp.ticked.has(id) });
        cb.addEventListener('change', () => { if (cb.checked) mp.ticked.add(id); else mp.ticked.delete(id); });
        return el('label', { class: 'my-template-row', for: cbId }, cb, el('span', {}, tool ? tool.name : `Tool ${id}`));
      });
      const apply = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, 'Add ticked');
      apply.addEventListener('click', async () => { await applyMerge(new Set(mp.ticked)); });
      const cancel = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, 'Cancel');
      cancel.addEventListener('click', () => { state.mergePreview = null; draw(); });
      return el('div', { class: 'my-banner my-banner-merge my-banner-merge-open', role: 'status' },
        el('p', { class: 't-small' }, 'Adding these will never duplicate a tool already in this register:'),
        ...rows,
        el('div', { class: 'my-setup-actions' }, apply, cancel));
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
      const serviceCell = el('td', { class: 'my-acc-service' }, fieldInput(a, 'service', 'text', readOnly, 'Service name'), detailsBtn);

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
      return el('div', { class: 'my-acc-drawer' },
        toolLine,
        el('div', { class: 'my-acc-drawer-grid' },
          drawerField('Website', a, 'url', 'url', readOnly),
          drawerSelect('Access level', a, 'admin', ['owner', 'admin', 'member', 'unknown'], ADMIN_LABEL, readOnly),
          drawerField('Plan', a, 'plan', 'text', readOnly),
          drawerField('Monthly cost (GBP)', a, 'monthlyCost', 'number', readOnly),
          drawerSelect('Status', a, 'status', ['active', 'to-close', 'closed'], STATUS_LABEL, readOnly),
          drawerCheckbox('Shared login (more than one person knows it)', a, 'shared', readOnly),
          drawerTextarea('Notes', a, 'notes', readOnly),
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
      const adoptionLevel = row.status === 'active' ? 'ok' : row.status === 'to-close' ? 'amber' : null;
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
        const adoptionLevel = row.status === 'active' ? 'ok' : row.status === 'to-close' ? 'amber' : null;
        return el('li', {}, btn, ' ', el('span', { class: `my-chip${adoptionLevel ? ` my-chip-${adoptionLevel}` : ''}` }, ADOPTION_LABEL[row.status] || row.status));
      })) : el('p', { class: 't-body' }, 'Nothing else recorded yet.');
      return el('section', { class: 'my-screen' },
        el('h2', {}, 'My tools'),
        el('p', { class: 't-body' }, 'Your imported stack, one card per tool, each linking back to its full entry in Accounts.'),
        cardGrid,
        el('h3', {}, 'Everything else you told us about'),
        otherList,
      );
    }

    /* --- Costs: a ledger, not a dashboard (section 9.4) -------------------- */
    function renewalRow(a) {
      return el('div', { class: 'my-renewal-row' },
        el('span', { class: 'my-renewal-date' }, formatDate(a.renewal)),
        el('span', { class: 'my-renewal-service' }, a.service || 'Untitled account'),
        el('span', { class: 'my-renewal-amount' }, a.monthlyCost != null ? money(a.monthlyCost) : 'No cost recorded'),
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
      const accounts = doc.accounts.filter((a) => a.status !== 'closed');
      const costed = accounts.filter((a) => typeof a.monthlyCost === 'number');
      const uncosted = accounts.filter((a) => typeof a.monthlyCost !== 'number');
      const monthlyTotal = costed.reduce((sum, a) => sum + a.monthlyCost, 0);
      const ui = state.costsUi;
      const totalFigure = ui.mode === 'annual' ? monthlyTotal * 12 : monthlyTotal;

      const monthlyBtn = el('button', { class: `btn btn-sm ${ui.mode === 'monthly' ? 'btn-primary' : 'btn-ghost'}`, type: 'button', 'aria-pressed': String(ui.mode === 'monthly') }, 'Monthly');
      monthlyBtn.addEventListener('click', () => { ui.mode = 'monthly'; draw(); });
      const annualBtn = el('button', { class: `btn btn-sm ${ui.mode === 'annual' ? 'btn-primary' : 'btn-ghost'}`, type: 'button', 'aria-pressed': String(ui.mode === 'annual') }, 'Annual');
      annualBtn.addEventListener('click', () => { ui.mode = 'annual'; draw(); });

      const totalPanel = el('div', { class: 'panel my-costs-total' },
        el('div', { class: 'my-costs-toggle', role: 'group', 'aria-label': 'Monthly or annual total' }, monthlyBtn, annualBtn),
        el('p', { class: 'my-costs-figure' }, money(totalFigure)),
        el('p', { class: 't-meta' }, `${ui.mode === 'annual' ? 'Per year' : 'Per month'}, summed from ${costed.length} account${costed.length === 1 ? '' : 's'} with a cost recorded.`),
      );

      const uncostedPanel = uncosted.length ? el('div', { class: 'panel my-costs-uncosted' },
        el('p', { class: 't-small' }, `${uncosted.length} account${uncosted.length === 1 ? '' : 's'} with no cost recorded:`),
        el('ul', { class: 'my-attention-list' }, ...uncosted.map((a) => {
          const btn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, `${a.service || 'Untitled account'}: no cost recorded`);
          btn.addEventListener('click', () => openAccountDrawer(a.id));
          return el('li', {}, btn);
        })),
      ) : null;

      const stackLink = buildStackLink(doc);
      const chartNote = stackLink ? el('div', { class: 'panel my-costs-chart-note' },
        el('p', { class: 't-body' }, 'For the indicative cost-growth chart (how costs could grow if your team grew into every free tier at once), see your stack’s client page:'),
        el('a', { href: stackLink }, 'View your stack'),
      ) : null;

      return el('section', { class: 'my-screen' },
        el('h2', {}, 'Costs'),
        renewalList(accounts, 14, 'Renewing in the next 14 days'),
        renewalList(accounts, 60, 'Renewing in the next 60 days'),
        totalPanel,
        uncostedPanel,
        chartNote,
      );
    }

    /* --- Leavers: the offboarding checklist (section 9.5) ------------------ */
    function distinctOwners(document_) {
      const set = new Set();
      for (const a of document_.accounts) { const o = (a.owner || '').trim(); if (o) set.add(o); }
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

      const customInput = el('input', {
        class: 'input', type: 'text', placeholder: 'Or type a name not listed above…',
        value: ui.customPerson, dataset: { focusKey: 'leaver-custom-person' },
      });
      customInput.addEventListener('input', () => { ui.customPerson = customInput.value; });

      const chosenPerson = (ui.customPerson || '').trim() || ui.person;
      const existingEntry = chosenPerson ? findLeaverEntry(doc, chosenPerson) : null;
      const genBtn = el('button', { class: 'btn btn-primary', type: 'button', disabled: !chosenPerson },
        existingEntry ? 'Regenerate checklist' : 'Generate checklist');
      genBtn.addEventListener('click', () => generateLeaverChecklist(chosenPerson));

      const picker = el('div', { class: 'panel my-leaver-picker no-print' },
        el('div', { class: 'my-field' }, el('span', { class: 't-small' }, 'Person leaving'), select),
        el('div', { class: 'my-field' }, customInput),
        genBtn,
      );

      let checklistOut = null;
      if (existingEntry) {
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

        checklistOut = el('div', { class: 'my-leaver-checklist' },
          el('h2', { class: 'my-leaver-heading' }, `Offboarding checklist: ${chosenPerson}`),
          el('p', { class: 't-meta' }, `Generated ${formatDate(existingEntry.generatedAt)}.`),
          printBtn,
          leaverPhaseSection(1, 'Identity first', phase1),
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
        already uses; an encrypted one gets an honest, lighter structural
        check instead (magic header, envelope shape), since the derived key
        held in store.js's memory is never exposed for us to decrypt with
        again here, and re-prompting for a passphrase on every single
        subsequent download (rather than only at setup, where section 7
        requires it once) would be poor form for something this frequent. */
    async function runVerifiedExport() {
      const { blob } = await store.exportBlob();
      const text = await blob.text();
      let verified = false;
      let verifyNote;
      try {
        if (currentStatus.encrypted) {
          const parsed = JSON.parse(text);
          verified = parsed.magic === 'freestack-register' && typeof parsed.v === 'number' && typeof parsed.ct === 'string';
          verifyNote = verified
            ? 'saved; its encrypted structure checked out'
            : 'saved, but its structure could not be confirmed';
        } else {
          const imported = await store.importBlob(text);
          verified = imported.document.business === doc.business && imported.document.accounts.length === doc.accounts.length;
          verifyNote = verified ? 'saved, exported and read back successfully: the round trip checks out' : 'saved, but the verification re-import did not match';
        }
      } catch (err) {
        verified = false;
        verifyNote = err.message || 'saved, but verification failed';
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
      const pickBtn = el('button', { class: 'btn btn-primary', type: 'button' }, 'Choose a file to import');
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

      return el('section', { class: 'my-screen' },
        el('h2', {}, 'Backup'),
        el('p', { class: 't-body' }, 'The export file you download is the copy that truly lasts. Everything ', STORAGE_PHRASE, ' can be lost if you clear browsing data or switch devices.'),
        list,
        el('div', { class: 'my-backup-section' },
          el('h3', {}, 'Export'),
          state.example ? el('p', { class: 't-meta' }, 'Exports are disabled while exploring the example register.') : el('div', { class: 'my-setup-actions' }, downloadBtn, shareBtn),
        ),
        state.example ? null : renderImportSection(),
        state.example ? null : renderEncryptionSection(),
        homeScreenNote,
        el('div', { class: 'my-backup-section' },
          el('h3', {}, 'Your privacy'),
          el('p', { class: 't-body' }, PRIVACY_NOTICE),
        ),
        state.example ? null : renderWipeSection(),
      );
    }

    const container = el('div', { class: 'my-shell' }, sidebar, el('div', { class: 'my-content' }, exampleBanner, reloadBanner, mergeBanner, undoBanner, nagBanner, topbar, main));
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
