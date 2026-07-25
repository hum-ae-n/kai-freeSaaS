/**
 * workspace.js: the /my surface (PRD-REGISTER, Wave A per BUILD-PLAN 11.1).
 * Mounted at #my-root by js/data-loader.js's boot(). Owns everything under
 * that mount point: first-run gates, setup, lock screen and the app shell.
 * The only module besides js/my/store.js allowed to know the shape of a
 * workspace document; every mutation still flows through store.js's six
 * methods, this module never touches storage directly.
 *
 * Redraw discipline: each screen is built once by its view function and
 * only rebuilt wholesale on a genuine step/mode transition (a button
 * click), never on a keystroke. Text inputs write straight into local
 * state via their own 'input' listener with no redraw, so typing never
 * loses focus. This mirrors curator.js's targeted-update discipline for
 * the same reason, by a different mechanism suited to a multi-step wizard.
 */
import { el, themeToggleButton, readPlainMode, writePlainMode, showToast } from '../data-loader.js';
import * as store from './store.js';
import { sampleDocument, sampleStatus } from './sample.js';

/* --- house-voice constants, verbatim per PRD-REGISTER ---------------------- */
const POSITIONING_SENTENCE = 'Your password manager holds the keys; the register is the keyring label: which doors exist, who holds which key, and which keys to collect when someone leaves.';
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
function backupAgeInfo(lastExportAt) {
  if (!lastExportAt) return { text: 'No backup exported yet', level: 'red' };
  const days = Math.floor((Date.now() - new Date(lastExportAt).getTime()) / 86400000);
  const age = days <= 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`;
  if (days <= 30) return { text: `Last exported ${age}`, level: 'ok' };
  if (days <= 60) return { text: `Last exported ${age}, due a fresh export soon`, level: 'amber' };
  return { text: `Last exported ${age}, export again soon`, level: 'red' };
}
const MFA_LABEL = { app: 'Authenticator app', sms: 'SMS code', hardware: 'Hardware key', none: 'None', unknown: 'Not recorded' };

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
  };

  // Last known store.status() snapshot, since status() is async and the app
  // shell renders synchronously; refreshStatusNow() updates it deliberately
  // at mode transitions (so the Lock button etc. do not flash in a frame
  // late), and viewShell() below also refreshes it lazily on every redraw.
  let lastKnownStatus = { persisted: false, storageOk: true, locked: false, encrypted: false, revision: 0, lastExportAt: null };
  async function refreshStatusNow() {
    try { lastKnownStatus = await store.status(); } catch { /* keep the last known values */ }
  }

  if (typeof BroadcastChannel !== 'undefined') {
    const bc = new BroadcastChannel('freestack-my');
    bc.onmessage = (event) => {
      if (event?.data?.type !== 'write') return;
      if (state.mode === 'app' && !state.example && event.data.revision !== state.expectedRevision) {
        state.banner = { kind: 'external-write' };
        draw();
      }
    };
  }

  function draw() { root.replaceChildren(view()); }

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
  function viewFirstRun() {
    const startBtn = el('button', { class: 'btn btn-primary btn-lg', type: 'button' }, 'Start your own register');
    startBtn.addEventListener('click', () => {
      state.mode = 'setup';
      state.setup = { step: 'name', business: '', wantsEncryption: null, passphrase1: '', passphrase2: '', error: null, recoveryDone: false, verifyOk: false, exportDone: false, blob: null, filename: '' };
      draw();
    });
    const exampleBtn = el('button', { class: 'btn btn-ghost btn-lg', type: 'button' }, 'Explore an example register');
    exampleBtn.addEventListener('click', enterExample);
    return el('div', { class: 'my-firstrun' },
      el('header', { class: 'panel my-firstrun-header' },
        el('p', { class: 'eyebrow' }, 'My Stack'),
        el('h1', {}, 'Your account register'),
        el('p', { class: 't-lede' }, POSITIONING_SENTENCE),
      ),
      el('div', { class: 'panel my-firstrun-choices' },
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
      s.step = 'encrypt-choice';
      draw();
    });
    return setupWrap('Your business', el('h1', {}, 'What is this register for?'), nameField, err, next);
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
      encrypted path, section 7's required test-decrypt). */
  async function commitInitialSave(s, passphrase) {
    state.mode = 'setup';
    s.step = 'verify-pending';
    s.error = null;
    draw();
    try {
      if (passphrase) await store.unlock(passphrase); // chooses the passphrase: see store.js's unlock() doc comment
      const doc = { business: s.business, people: [], accounts: [] };
      const saved = await store.save(doc, 0);
      state.doc = saved;
      state.expectedRevision = saved.revision;

      const { blob } = await store.exportBlob();
      const text = await blob.text();
      const imported = await store.importBlob(text, passphrase || undefined);
      const roundTripOk = imported.document.business === s.business && imported.document.accounts.length === 0;
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

    const sidebarFoot = el('div', { class: 'my-sidebar-foot' }, plainBtn, themeToggleButton('btn-ghost btn-sm'), lockBtn);

    const menuBtn = el('button', { class: 'btn btn-ghost my-menu-toggle', type: 'button', 'aria-expanded': String(state.mobileOpen), 'aria-label': 'Menu' }, 'Menu');
    menuBtn.addEventListener('click', () => { state.mobileOpen = !state.mobileOpen; draw(); });

    const sidebar = el('div', { class: `my-sidebar${state.mobileOpen ? ' is-open' : ''}` },
      el('div', { class: 'my-sidebar-brand' }, el('p', { class: 'eyebrow' }, 'My Stack')),
      nav,
      sidebarFoot,
    );

    const exampleBanner = state.example ? el('div', { class: 'my-banner my-banner-example', role: 'status' },
      'This is an example register. Nothing here is saved. ',
      (() => { const b = el('button', { class: 'btn btn-sm btn-primary', type: 'button' }, 'Start your own'); b.addEventListener('click', () => { state.example = false; state.doc = null; state.mode = 'first-run'; draw(); }); return b; })(),
    ) : null;

    const reloadBanner = state.banner?.kind === 'external-write' ? el('div', { class: 'my-banner my-banner-reload', role: 'alert' },
      'This register changed in another tab. ',
      (() => { const b = el('button', { class: 'btn btn-sm btn-secondary', type: 'button' }, 'Reload'); b.addEventListener('click', () => location.reload()); return b; })(),
    ) : null;

    const topbar = el('div', { class: 'my-topbar' },
      menuBtn,
      el('h1', { class: 'my-topbar-name' }, doc.business || 'Untitled register'),
      el('input', { class: 'input my-topbar-search', type: 'search', placeholder: 'Search accounts…', 'aria-label': 'Search accounts', disabled: true }),
    );

    const main = el('main', { class: 'my-main' }, screenView());

    function screenView() {
      switch (state.screen) {
        case 'overview': return screenOverview();
        case 'accounts': return screenAccounts();
        case 'my-tools': return placeholderScreen('My tools', 'Your imported stack will show here as cards once stack import ships in the next update.');
        case 'costs': return placeholderScreen('Costs', 'A renewals ledger and running cost total will show here once accounts carry pricing.');
        case 'leavers': return placeholderScreen('Leavers', 'Pick a person and get a printable offboarding checklist here, arriving in a future update.');
        case 'backup': return screenBackup();
        default: return placeholderScreen(state.screen, '');
      }
    }

    function placeholderScreen(title, body) {
      return el('section', { class: 'my-screen' }, el('h2', {}, title), el('p', { class: 't-body' }, body));
    }

    function screenOverview() {
      const st = currentStatus;
      const age = backupAgeInfo(st.lastExportAt);
      const recordedTile = el('button', { class: 'panel my-tile', type: 'button' },
        el('span', { class: 'my-tile-value' }, String(doc.accounts.length)),
        el('span', { class: 'my-tile-label' }, label('recorded')));
      recordedTile.addEventListener('click', () => navigate('accounts'));
      const backupTile = el('button', { class: `panel my-tile my-tile-${age.level}`, type: 'button' },
        el('span', { class: 'my-tile-value' }, age.text),
        el('span', { class: 'my-tile-label' }, label('backupAge')));
      backupTile.addEventListener('click', () => navigate('backup'));
      return el('section', { class: 'my-screen' },
        el('h2', {}, 'Overview'),
        el('div', { class: 'my-tiles' }, recordedTile, backupTile),
        el('p', { class: 't-meta' }, 'Risk tiles (personal email, no 2FA, no owner, renewals due soon) arrive with full account entry in the next update.'),
      );
    }

    function screenAccounts() {
      if (!doc.accounts.length) {
        return el('section', { class: 'my-screen' },
          el('h2', {}, 'Accounts'),
          el('p', { class: 't-body' }, 'No accounts recorded yet. Adding accounts by hand, from templates or from a stack arrives in the next update.'),
        );
      }
      const rows = doc.accounts.map((a) => el('tr', {},
        el('td', {}, a.service),
        el('td', {}, a.identity),
        el('td', {}, a.owner || 'Not recorded'),
        el('td', {}, MFA_LABEL[a.mfa] || a.mfa || 'Not recorded'),
        el('td', {}, formatDate(a.renewal) || 'None'),
      ));
      return el('section', { class: 'my-screen' },
        el('h2', {}, 'Accounts'),
        el('p', { class: 't-meta' }, 'Read only for now: editing arrives with the full register table.'),
        el('div', { class: 'my-table-wrap' },
          el('table', { class: 'my-accounts-table' },
            el('thead', {}, el('tr', {},
              el('th', {}, 'Service'), el('th', {}, 'Identity'), el('th', {}, 'Owner'), el('th', {}, '2FA'), el('th', {}, 'Renewal'),
            )),
            el('tbody', {}, rows),
          ),
        ),
      );
    }

    function screenBackup() {
      const st = currentStatus;
      const rows = [
        ['Saved in this browser', st.storageOk ? 'Yes, on this device' : 'No, this browser is not remembering data'],
        ['Persistent storage granted', st.persisted ? 'Yes' : 'Not granted; the browser may still evict this if the device runs low on space'],
        ['Encrypted with a passphrase', st.encrypted ? 'Yes' : 'No, off by default'],
        ['Last verified export', st.lastExportAt ? formatDate(st.lastExportAt) : 'Never'],
      ];
      const list = el('dl', { class: 'my-status-list' },
        ...rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
      const exportBtn = el('button', { class: 'btn btn-primary', type: 'button', disabled: state.example }, 'Download a backup now');
      exportBtn.addEventListener('click', async () => {
        try {
          const { blob } = await store.exportBlob();
          downloadBlob(blob, exportFilename(doc.business));
          showToast('Backup downloaded');
          draw();
        } catch (err) {
          showToast(err.message || 'Export failed', 'error');
        }
      });
      return el('section', { class: 'my-screen' },
        el('h2', {}, 'Backup'),
        el('p', { class: 't-body' }, 'The export file you download is the copy that truly lasts. Everything ', STORAGE_PHRASE, ' can be lost if you clear browsing data or switch devices.'),
        list,
        state.example ? el('p', { class: 't-meta' }, 'Exports are disabled while exploring the example register.') : exportBtn,
        el('p', { class: 't-meta' }, 'Import, changing your passphrase later and the iOS share sheet arrive in a future update.'),
      );
    }

    const container = el('div', { class: 'my-shell' }, sidebar, el('div', { class: 'my-content' }, exampleBanner, reloadBanner, topbar, main));
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
