/**
 * judge-coach.js: the first-judgement explainer dialog, PRD section 16
 * amended, Phase 21 subsection "First-judgement explainer". Shown at most
 * once ever per device, the instant the reader's first judgement (Got it or
 * Add to my list) is recorded anywhere on the public surface: the deck, or
 * the browse list's chip chooser and quick-judge rail. js/public.js is the
 * only caller. js/discover.js never imports this module: it reports a
 * fresh in-deck judgement back through the onJudge callback openDiscoverDeck
 * already accepts, the same shape as its existing onClose/onBrowseAll,
 * which keeps the deck engine decoupled from a dialog that only exists on
 * this one surface.
 *
 * Storage key freestack:v1:judgecoach, a public-surface key outside the
 * js/my/store.js seam (CLAUDE.md register laws), same standing as
 * js/discover.js's own freestack:v1:discover: set to '1' once dismissed, by
 * any close route, and never read as anything but a boolean marker.
 *
 * Copy lives here, not js/why-copy.js: this is interface guidance shown at
 * the moment of first use, never page content, and must never enter the
 * static crawler block scripts/build-seo.mjs generates (that script never
 * imports this file).
 *
 * Dialog contract (PRD section 16 amended, "16.4"; the compressed-topbar
 * disclosure's own contract, applied here to a true modal): role="dialog",
 * aria-modal="true", aria-labelledby the heading. Focus moves into the
 * dialog on open (the primary button); Escape and an outside click both
 * close it; focus returns to the triggering control afterwards, via the
 * caller-supplied restoreFocus callback rather than a guessed
 * document.activeElement, since the judgement write that precedes this call
 * may already have replaced the original control's DOM node (js/public.js's
 * decorateCard does exactly that for the browse list). Appears instantly,
 * with no entrance animation of any kind: the motion inventory (PRD section
 * 16) is exhaustive and gains nothing from this dialog.
 */
import { el } from './data-loader.js';

const STORAGE_KEY = 'freestack:v1:judgecoach';

function readShown() {
  try { return localStorage.getItem(STORAGE_KEY) === '1'; }
  catch { return false; }
}

/** Best-effort write, silent on failure (private mode, a blocked store):
    worst case the dialog can show again on a later visit, never a broken
    page. Mirrors js/discover.js's own writeState tolerance. */
function writeShown() {
  try { localStorage.setItem(STORAGE_KEY, '1'); }
  catch { /* private mode, webview, quota: may show again next visit */ }
}

// Belt-and-braces alongside the storage read above: a blocked store must
// never let the dialog stack twice within one page life just because
// writeShown() silently failed. dialogOpen also stops a second judgement
// event, however unlikely mid-dialog, from mounting a second copy on top
// of the first.
let shownThisSession = false;
let dialogOpen = false;

/**
 * @param {object} options
 * @param {boolean} options.deckCoachVisible - true while the deck's own
 *   first-open coach overlay is up (js/discover.js's isDeckCoachOpen()).
 *   Per the PRD: "it never fires during the deck's own first-open coach
 *   ... the explainer waits for the next judgement." Every judge control is
 *   disabled while that overlay is up, so the very next judgement event
 *   this function is called for will already have it cleared in practice.
 * @param {() => void} options.restoreFocus - called exactly once, when the
 *   dialog closes by any route, to return focus to whatever triggered it.
 */
export function maybeShowJudgeCoach({ deckCoachVisible, restoreFocus }) {
  if (dialogOpen || shownThisSession || deckCoachVisible || readShown()) return;
  dialogOpen = true;

  const headingId = 'pub-judgecoach-heading';
  const keepBtn = el('button', { class: 'btn btn-primary', type: 'button' }, 'Keep browsing');
  const myStackLink = el('a', { class: 'btn btn-ghost', href: '/my' }, 'Open My Stack');

  const dialog = el('section', {
    class: 'pub-judgecoach', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': headingId, tabindex: '-1',
  },
    el('h2', { id: headingId }, 'Your list lives on this device'),
    el('p', {},
      'Judgements you make here are saved in this browser only. Nothing is sent anywhere, and there is no account to create.',
    ),
    el('p', {},
      'Businesses lose track of what they have signed up for all the time. Unwanted subscriptions cost UK consumers about £1.6bn a year. Keeping your list in one place is how you avoid it.',
    ),
    el('p', {},
      'My Stack turns your picks into a free register: no account, no password, nothing leaves your device.',
    ),
    el('div', { class: 'pub-judgecoach-actions' }, keepBtn, myStackLink),
  );
  const backdrop = el('div', { class: 'pub-judgecoach-backdrop' }, dialog);

  function close() {
    if (!dialogOpen) return;
    dialogOpen = false;
    shownThisSession = true;
    writeShown();
    document.removeEventListener('keydown', onKeydown);
    document.removeEventListener('pointerdown', onOutsidePointerdown, true);
    backdrop.remove();
    if (typeof restoreFocus === 'function') restoreFocus();
  }

  function onKeydown(event) {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
  }
  // pointerdown, not click, on the backdrop: the same contract
  // js/public.js's compressed-topbar panel already uses for its own outside
  // click (see that module's onOutsideTopbarPointerdown for the reasoning),
  // so a tap anywhere outside the dialog card closes it.
  function onOutsidePointerdown(event) {
    if (dialog.contains(event.target)) return;
    close();
  }

  // The My Stack link genuinely navigates away: close() runs writeShown()
  // synchronously before the browser follows the href, so the key is set
  // either way, exactly like every other dismissal route.
  keepBtn.addEventListener('click', close);
  myStackLink.addEventListener('click', close);

  document.body.appendChild(backdrop);
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('pointerdown', onOutsidePointerdown, true);
  keepBtn.focus({ preventScroll: true });
}
