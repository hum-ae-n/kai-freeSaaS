/**
 * discover.js: the Discover deck engine, PRD section 17. Mounted on demand
 * from js/public.js's Discover entry path (PRD section 16) and never
 * imported by curator.js or client.js. This module is the sole owner of the
 * freestack:v1:discover storage key; no js/my/* module may read it, per the
 * register laws in CLAUDE.md. The hand-off to My Stack travels entirely in
 * the URL (buildHandoffUrl below), so store.js stays the only storage
 * choke-point on its own surface.
 *
 * Deals a short deck (10 to 12 cards, never more, PRD 17 "Deck composition")
 * from unjudged active tools, seeded by a persona pack, a category, or the
 * default mix (unjudged core tools first, then unjudged tools spread across
 * categories). Buttons and keyboard are the primary controls (WCAG 2.5.7:
 * no function may require dragging); the pointer gesture is an enhancement
 * layered on top, never a requirement, and Skip has no gesture at all so an
 * accidental drag can never silently discard a card.
 *
 * Physics are CSS transforms set directly in the pointermove handler, no
 * requestAnimationFrame loop, no animation library. Under
 * prefers-reduced-motion the card never translates or rotates at any point
 * in its lifecycle: exits and the undo return are opacity-only, and a
 * sub-threshold release simply leaves the card exactly where it already was
 * (nothing to spring back from, since nothing ever moved).
 *
 * PHASE 12.3 (PRD section 16, "Grid quick-judge and list parity"): judgement
 * read/write stays entirely in this module even though the browse list's
 * state chip, chooser and corner controls now write to it too. getDecision/
 * setDecision/clearDecision/subscribe below are that seam. A single shared
 * in-memory copy (getSharedState) backs both the deck and the browse list
 * for the page's whole lifetime, so a judgement made in either place is
 * visible to the other without a re-read: every read in this file goes
 * through the same object reference, its properties simply get mutated in
 * place by whichever side wrote last. notify() is the half that still needs
 * doing by hand, since a mutated object does not repaint itself; anything
 * that renders a decision (the browse list's cards, this module's own
 * completion screen while it is showing) subscribes and re-renders itself,
 * never the unrelated rest of the page.
 */
import { el, favicon, readPlainMode } from './data-loader.js';

const STORAGE_KEY = 'freestack:v1:discover';
const DECK_MAX = 12;
const SLOP_PX = 10;
const COMMIT_PX = 100;
const COMMIT_RATIO = 0.35;
const FLING_VELOCITY = 0.5; // px/ms
const VALID_DECISIONS = ['have', 'want', 'skip'];

/* --- persistence (PRD 17, "Persistence") ----------------------------------
   Wrapped in try/catch throughout: a blocked store (private mode, some
   webviews) must never stop the deck dealing or completing, it simply stays
   in memory for the session and nothing survives a reload. Ids are always
   read with Number.parseInt and validated with Number.isInteger, never a
   truthiness test, so tool id 0 survives every read and write. */

function freshState() {
  return { v: 1, lastVisit: new Date().toISOString(), seenIds: [], decisions: {} };
}

function readState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== 1) return freshState(); // unknown v: discard, start fresh
    const decisions = {};
    if (parsed.decisions && typeof parsed.decisions === 'object') {
      for (const [key, value] of Object.entries(parsed.decisions)) {
        const id = Number.parseInt(key, 10);
        if (!Number.isInteger(id) || !value || !VALID_DECISIONS.includes(value.d)) continue;
        decisions[String(id)] = { d: value.d, t: typeof value.t === 'number' ? value.t : Date.now() };
      }
    }
    const seenIds = Array.isArray(parsed.seenIds)
      ? [...new Set(parsed.seenIds.filter((id) => Number.isInteger(id)))]
      : [];
    return {
      v: 1,
      lastVisit: typeof parsed.lastVisit === 'string' ? parsed.lastVisit : new Date().toISOString(),
      seenIds,
      decisions,
    };
  } catch {
    return freshState();
  }
}

/** Best-effort write. Failure is silent by design (PRD 17): "nothing
    persists and no error is shown beyond honest wording if persistence is
    mentioned at all", and this module never claims browser storage is safe. */
function writeState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { /* private mode, webview, quota: session stays in-memory only */ }
}

function recordDecision(state, id, decision) {
  const idStr = String(id);
  state.decisions[idStr] = { d: decision, t: Date.now() };
  if (!state.seenIds.includes(id)) state.seenIds.push(id);
  state.lastVisit = new Date().toISOString();
  writeState(state);
}

/** Reverses exactly one decision: deletes the record and its seenIds entry,
    per PRD 17's undo spec ("including its seenIds entry"). Shared by the
    deck's own single-level undo and by the browse list's "Clear" (PRD
    section 16): clearing a judgement from the grid means "I have not
    decided", so the tool becomes new-to-you again for a future deck, same
    as an in-deck undo. */
function undoStoredDecision(state, id) {
  delete state.decisions[String(id)];
  state.seenIds = state.seenIds.filter((existing) => existing !== id);
  writeState(state);
}

/* --- shared state and subscription (Phase 12.3, PRD section 16) -----------
   One in-memory copy for the page's whole lifetime, not a fresh read per
   deck session: the browse list's chip/chooser/corner controls need to read
   and write the exact same object the deck itself is using, or a judgement
   made on one side would not appear on the other without a hard reload. */
let sharedState = null;
const subscribers = new Set();

function getSharedState() {
  if (!sharedState) sharedState = readState();
  return sharedState;
}

function notify() {
  for (const fn of subscribers) {
    try { fn(); } catch (cause) { console.warn('Discover subscriber threw:', cause); }
  }
}

/** Subscribe to any decision change, from any source: the deck's own
    buttons/keyboard/gesture, or the browse list's chip chooser and corner
    controls. Returns an unsubscribe function. */
export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/** Current decision for a tool id, or null when unjudged. Read API for the
    browse list's state chip and corner controls. Number.isInteger, never a
    truthiness test, so tool id 0 is never mistaken for "no id given". */
export function getDecision(id) {
  if (!Number.isInteger(id)) return null;
  const rec = getSharedState().decisions[String(id)];
  return rec ? rec.d : null;
}

/** Records have/want from outside the deck (PRD section 16's chip chooser
    and corner buttons). Skip is deliberately not accepted here: it is a
    deck-only concept with no browse-list control of its own (the section
    names only a "Got it"/"On my list" chip, never a skip chip). */
export function setDecision(id, decision) {
  if (!Number.isInteger(id) || (decision !== 'have' && decision !== 'want')) return;
  const state = getSharedState();
  recordDecision(state, id, decision);
  notify();
}

/** Clears a decision from outside the deck (the chooser's "Clear", or a
    second activation of an already-set corner button). */
export function clearDecision(id) {
  if (!Number.isInteger(id)) return;
  const state = getSharedState();
  if (!(String(id) in state.decisions)) return; // nothing to clear: skip the notify
  undoStoredDecision(state, id);
  notify();
}

/* --- deck composition (PRD 17, "Deck composition") ------------------------ */

function activeTools(tools) {
  return tools.filter((t) => !t.archived);
}

/** "New to you": an active id absent from seenIds, a set difference computed
    at render with no schema change (PRD 17, "New to you"). Exported as a
    seam for an entry point to surface the count; this wave renders no such
    copy itself (PRD 16 only says an entry point "may" show it). */
export function newToYouCount(tools, state) {
  const seen = new Set(state.seenIds);
  return activeTools(tools).filter((t) => !seen.has(t.id)).length;
}

function seedPool(tools, seed) {
  const active = activeTools(tools);
  if (seed.type === 'persona') {
    const ids = new Set(seed.ids);
    return active.filter((t) => ids.has(t.id));
  }
  if (seed.type === 'category') {
    return active.filter((t) => t.category === seed.category);
  }
  return active;
}

/** Default mix: unjudged core tools first, then unjudged tools spread
    across categories in round-robin order, so one large category never
    hogs the first several slots. */
function defaultMixOrder(pool) {
  const core = pool.filter((t) => t.type === 'core');
  const rest = pool.filter((t) => t.type !== 'core');
  const byCategory = new Map();
  for (const tool of rest) {
    if (!byCategory.has(tool.category)) byCategory.set(tool.category, []);
    byCategory.get(tool.category).push(tool);
  }
  const groups = [...byCategory.values()];
  const spread = [];
  for (let i = 0; spread.length < rest.length; i++) {
    let addedAny = false;
    for (const group of groups) {
      if (i < group.length) { spread.push(group[i]); addedAny = true; }
    }
    if (!addedAny) break;
  }
  return [...core, ...spread];
}

/** Builds the deck order: at most DECK_MAX ids, filtered to unjudged unless
    includeJudged is set (the "review judged tools again" path offered when
    a seed has nothing left). Dealt exactly as-is when fewer are eligible
    (PRD 17: "Fewer than 10 eligible ids: deal what remains. Never more than
    DECK_MAX, whatever the seed. */
function buildOrder(tools, seed, state, includeJudged = false) {
  const pool = seedPool(tools, seed);
  const seen = new Set(state.seenIds);
  const eligible = includeJudged ? pool : pool.filter((t) => !seen.has(t.id));
  const ordered = seed.type === 'default' ? defaultMixOrder(eligible) : eligible;
  return ordered.slice(0, DECK_MAX).map((t) => t.id);
}

/* --- hand-off URL (PRD 17, "Hand-off: Open these in My Stack") ------------ */

/** Caps a comma-joined id list at 512 characters by dropping ids from the
    end, defensive per the section's length limit (every active tool today
    fits well under this in practice). */
function capIdsParam(ids) {
  let list = ids.slice();
  let joined = list.join(',');
  while (joined.length > 512 && list.length) {
    list = list.slice(0, -1);
    joined = list.join(',');
  }
  return joined;
}

/** Built from the full stored decisions, not just the current deck's cards:
    the completion card is "any equivalent affordance built from stored
    judgements" per the spec, so it reflects everything judged on this
    device so far. have= always travels, even with no ids: its presence is
    the arrival marker the workspace reads (PRD-REGISTER section 19), not
    just a data carrier. skip decisions never travel. Returns null when both
    resolved lists are empty, in which case no button is rendered. */
export function buildHandoffUrl(state) {
  const haveIds = [];
  const wantIds = [];
  for (const [key, value] of Object.entries(state.decisions)) {
    const id = Number.parseInt(key, 10);
    if (!Number.isInteger(id)) continue;
    if (value.d === 'have') haveIds.push(id);
    else if (value.d === 'want') wantIds.push(id);
  }
  if (!haveIds.length && !wantIds.length) return null;
  const params = [];
  if (wantIds.length) params.push(`from=${capIdsParam(wantIds)}`);
  params.push(`have=${capIdsParam(haveIds)}`); // always emitted, even with no ids
  return `/my?${params.join('&')}`;
}

/* --- motion, physics, gesture (PRD 17, "Controls" and "Card physics") ----- */

function prefersReducedMotion() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** ~1 degree per 20px of horizontal travel, applied live in pointermove.
    Never called at all under reduced motion: the card must not translate
    or rotate at any point in its lifecycle in that mode. */
function setDragTransform(card, dx) {
  const rotate = dx / 20;
  card.style.transform = `translateX(${dx}px) rotate(${rotate}deg)`;
}

/** Verdict stamp opacity rises with drag distance, proportional up to the
    commit threshold, where it reaches full strength. */
function setStampOpacity(card, dx, threshold) {
  const ratio = threshold > 0 ? Math.min(Math.abs(dx) / threshold, 1) : 0;
  const haveStamp = card.querySelector('.discover-stamp-have');
  const wantStamp = card.querySelector('.discover-stamp-want');
  if (haveStamp) haveStamp.style.opacity = dx < 0 ? String(ratio) : '0';
  if (wantStamp) wantStamp.style.opacity = dx > 0 ? String(ratio) : '0';
}

/** Sub-threshold release: the card returns to rest and nothing is recorded.
    Under reduced motion nothing ever moved, so there is nothing to spring
    back from: only the stamp opacities (already opacity, never transform)
    need resetting. */
function springBack(card, reduced) {
  setStampOpacity(card, 0, 1);
  if (reduced) return;
  card.classList.remove('discover-card-dragging');
  card.classList.add('discover-card-springback');
  card.style.transform = 'none';
  const clear = () => card.classList.remove('discover-card-springback');
  card.addEventListener('transitionend', clear, { once: true });
}

/** A single CSS transition along the exit vector, element removed on
    transitionend (with a timeout fallback in case the transition never
    fires, e.g. a backgrounded tab). have exits left, want exits right, skip
    fades and drops slightly so it is never visually confused with a
    directional verdict it can never actually carry via gesture.

    cleanup() checks card.isConnected before calling done(): normally this
    exiting card is still attached right up until this fires, but undo()
    can replace the stage's contents early (while this transition is still
    in flight), which detaches it as a side effect. done() here is always
    dealCurrent(), whose job (arming the next card) has already been done
    by that other path in that case, so calling it again would silently
    re-deal and discard whatever the reader is now looking at. */
function exitCard(card, decision, reduced, done) {
  const cleanup = () => {
    const stillCurrent = card.isConnected;
    card.remove();
    if (stillCurrent) done();
  };
  if (reduced) {
    card.classList.add('discover-card-exit-reduced');
    requestAnimationFrame(() => requestAnimationFrame(() => { card.style.opacity = '0'; }));
    card.addEventListener('transitionend', cleanup, { once: true });
    setTimeout(cleanup, 250);
    return;
  }
  card.classList.remove('discover-card-dragging');
  card.classList.add('discover-card-exit');
  const width = Math.max(card.getBoundingClientRect().width, 320);
  const distance = width * 1.6;
  if (decision === 'have') card.style.transform = `translateX(${-distance}px) rotate(-24deg)`;
  else if (decision === 'want') card.style.transform = `translateX(${distance}px) rotate(24deg)`;
  else {
    card.style.transform = `translateY(${distance * 0.6}px)`;
    card.style.opacity = '0';
  }
  card.addEventListener('transitionend', cleanup, { once: true });
  setTimeout(cleanup, 320);
}

/** Animates a card back onto the deck for undo, from roughly the direction
    it left in. Instant, with no travel, under reduced motion (fade only). */
function animateCardIn(card, fromDecision, reduced) {
  if (reduced) {
    card.style.opacity = '0';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      card.classList.add('discover-card-enter-reduced');
      card.style.opacity = '1';
    }));
    return;
  }
  const dir = fromDecision === 'have' ? -1 : fromDecision === 'want' ? 1 : 0;
  card.style.transition = 'none';
  card.style.transform = dir === 0 ? 'translateY(70px)' : `translateX(${dir * 140}px) rotate(${dir * 10}deg)`;
  card.style.opacity = dir === 0 ? '0' : '1';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    card.style.transition = '';
    card.classList.add('discover-card-springback');
    card.style.transform = 'none';
    card.style.opacity = '1';
  }));
}

/** Pointer gesture: mouse and touch alike via the Pointer Events API. A drag
    is only claimed after 10px of slop and only when horizontal travel
    dominates (|dx| > |dy|); anything more vertical hands the gesture back
    to native pan-y scroll untouched. Commits at 100px, or 35% of the card's
    own width if that is smaller, or a 0.5px/ms release velocity (a fling);
    otherwise springs back. Skip is reached only through its button, never
    through this gesture. Pointer capture is deferred until a drag is
    actually claimed (see the pointermove handler): capturing unconditionally
    on pointerdown would retarget every later event, including the
    synthesised click, at the card itself, which silently swallows a
    stationary tap or click on an interactive descendant such as the "More"
    permalink. A drag that starts over that same link still works, since
    capture engages the moment slop is exceeded, before the drag math ever
    depends on it. */
const VELOCITY_WINDOW_MS = 100; // trailing window a release velocity is read from

function attachGesture(card, reduced, { getThreshold, onCommit }) {
  let pointerId = null;
  let claimed = false;
  let captured = false;
  let startX = 0;
  let startY = 0;
  // Trailing window of {t, x} samples, oldest-first, trimmed to the last
  // VELOCITY_WINDOW_MS and drawn ONLY from pointermove events: release
  // velocity is read across this window of real motion, never from the
  // pointerup event's own coordinates and timestamp. Hardware and the OS
  // routinely deliver pointerup tens of milliseconds after the last real
  // move (the finger has already stopped before it lifts), and folding
  // that late, stale-timed sample into the window would dilute an
  // otherwise identical flick's velocity purely as a function of how long
  // the release happened to be delayed. A finger that deliberately stops
  // moving before releasing already reads as slow on its own terms: it
  // keeps emitting near-stationary move samples, which correctly age the
  // fast samples out of the trailing window without any special-casing.
  let samples = [];

  function pushSample(t, x) {
    samples.push({ t, x });
    const cutoff = t - VELOCITY_WINDOW_MS;
    while (samples.length > 1 && samples[0].t < cutoff) samples.shift();
  }

  function releaseVelocity() {
    if (samples.length < 2) return 0;
    const first = samples[0];
    const last = samples[samples.length - 1];
    const dt = last.t - first.t;
    return dt > 0 ? (last.x - first.x) / dt : 0;
  }

  function reset() {
    pointerId = null;
    claimed = false;
    captured = false;
  }

  card.addEventListener('pointerdown', (event) => {
    if (event.button > 0) return;
    pointerId = event.pointerId;
    claimed = false;
    captured = false;
    startX = event.clientX;
    startY = event.clientY;
    samples = [{ t: event.timeStamp, x: event.clientX }];
    // No setPointerCapture here: see the function comment above.
  });

  card.addEventListener('pointermove', (event) => {
    if (pointerId === null || event.pointerId !== pointerId) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!claimed) {
      if (Math.abs(dx) < SLOP_PX && Math.abs(dy) < SLOP_PX) return;
      if (Math.abs(dx) <= Math.abs(dy)) {
        // More vertical than horizontal: hand the gesture back to native
        // scroll rather than claiming it as a card drag. Capture was never
        // taken in this branch, so there is nothing to release.
        pointerId = null;
        return;
      }
      claimed = true;
      captured = true;
      card.setPointerCapture(pointerId);
      card.classList.add('discover-card-dragging');
    }
    event.preventDefault();
    pushSample(event.timeStamp, event.clientX);
    if (!reduced) setDragTransform(card, dx);
    setStampOpacity(card, dx, getThreshold());
  });

  function release(event) {
    if (pointerId === null || event.pointerId !== pointerId) return;
    const dx = event.clientX - startX;
    const wasClaimed = claimed;
    if (captured) { try { card.releasePointerCapture(pointerId); } catch { /* already released */ } }
    reset();
    if (!wasClaimed) return; // a stationary tap/click: let the browser's own click go through
    const passedDistance = Math.abs(dx) >= getThreshold();
    const passedVelocity = Math.abs(releaseVelocity()) >= FLING_VELOCITY;
    if (passedDistance || passedVelocity) onCommit(dx < 0 ? 'have' : 'want');
    else springBack(card, reduced);
  }

  // pointercancel means the system interrupted the gesture (an incoming
  // call, an edge-swipe gesture, the browser reclaiming the pointer): it is
  // never a considered release and must always spring back, never commit,
  // regardless of where the pointer happened to be when it was cancelled.
  function cancel(event) {
    if (pointerId === null || event.pointerId !== pointerId) return;
    const wasClaimed = claimed;
    if (captured) { try { card.releasePointerCapture(pointerId); } catch { /* already released */ } }
    reset();
    if (wasClaimed) springBack(card, reduced);
  }

  card.addEventListener('pointerup', release);
  card.addEventListener('pointercancel', cancel);
}

/* --- card content (PRD 17, "Card content") -------------------------------- */

function buildCard(tool) {
  const plainMode = readPlainMode();
  const descriptionText = plainMode && tool.plain ? tool.plain : tool.description;
  return el('article', { class: 'discover-card', 'data-id': String(tool.id) },
    el('div', { class: 'discover-stamp discover-stamp-have', 'aria-hidden': 'true' }, 'GOT IT'),
    el('div', { class: 'discover-stamp discover-stamp-want', 'aria-hidden': 'true' }, 'MY LIST'),
    el('div', { class: 'discover-card-body' },
      el('h3', { class: 'discover-card-name' }, favicon(tool.urls[0]?.domain), tool.name),
      el('p', { class: 'discover-card-category' }, tool.category),
      el('p', { class: 'discover-card-desc' }, descriptionText),
      tool.free_limit ? el('p', { class: 'discover-card-limit' }, tool.free_limit) : null,
      // A card is never itself a link (a tap must never navigate mid-deck):
      // this quiet "More" anchor is the one exception, opening the single
      // tool permalink in a new tab under the standard link rules.
      el('a', {
        class: 'discover-card-more', href: `?tool=${tool.id}`, target: '_blank', rel: 'noopener noreferrer',
      }, 'More'),
    ),
  );
}

/* --- the deck panel -------------------------------------------------------
   openDiscoverDeck is the only export public.js calls. Everything else in
   this module is a private implementation detail, closed over the single
   session object created here. Only one deck is ever open at a time
   (public.js guards re-entrant clicks), so plain closures are simpler than
   a class with no second instance to justify it. */

/**
 * @param {object} options
 * @param {object[]} options.tools - the full tools.json array (archived
 *   entries included; this module filters them out itself).
 * @param {HTMLElement} options.container - mount point, owned by public.js,
 *   shown and populated here and hidden again on close.
 * @param {HTMLElement} options.opener - receives focus back on close.
 * @param {{type: 'persona', ids: number[]} | {type: 'category', category: string} | {type: 'default'}} [options.seed]
 * @param {() => void} [options.onClose] - called once the deck is closed,
 *   by any route (Escape, the close button, or "Browse all").
 * @param {() => void} [options.onBrowseAll] - called after close when the
 *   reader chooses "Browse all" from the completion or empty-deck screen.
 */
export function openDiscoverDeck(options) {
  const { tools, container, opener, seed = { type: 'default' }, onClose, onBrowseAll } = options;
  // The shared, page-lifetime state object (Phase 12.3): reads anywhere in
  // this closure stay live, since setDecision/clearDecision called from the
  // browse list mutate this exact same object's properties rather than
  // replacing it, and notify() is what tells this open deck to repaint.
  const state = getSharedState();
  const reduced = prefersReducedMotion();
  const byId = new Map(tools.map((t) => [t.id, t]));

  const session = {
    order: buildOrder(tools, seed, state),
    index: 0,
    lastJudged: null, // { id, decision, index }: single level, PRD 17 "Undo"
    // locked is true from the instant a judgement is accepted until the
    // next card is armed (dealCurrent) or the previous one is restored
    // (undo). While locked, judge() refuses every further input: a second
    // rapid click on the same visible button, or a drag committed on a
    // card that is still mid-exit, both arrive while the first judgement's
    // 220-320ms exit transition is still playing, and session.index has
    // already moved on, so a naive re-read would silently judge the wrong
    // id and never show it. A judgement is atomic per displayed card.
    locked: false,
  };
  // Set only while the completion screen (below) is mounted: a chooser or
  // corner change made from the browse list while it is showing must update
  // its counts and hand-off link in place (PRD section 16), never wait for
  // the reader to leave and come back.
  let completionUnsub = null;
  function stopCompletionSync() {
    if (completionUnsub) { completionUnsub(); completionUnsub = null; }
  }

  const progressEl = el('p', { class: 'discover-progress' });
  const liveEl = el('p', { class: 'discover-live visually-hidden', 'aria-live': 'polite' });
  const stage = el('div', { class: 'discover-stage' });
  const undoBtn = el('button', {
    class: 'btn btn-ghost discover-undo', type: 'button', hidden: true,
  }, 'Undo');
  const closeBtn = el('button', {
    class: 'btn btn-ghost discover-close', type: 'button', 'aria-label': 'Close deck',
  }, '×');
  const haveBtn = el('button', { class: 'btn btn-primary discover-btn-have', type: 'button' }, 'Got it');
  const skipBtn = el('button', { class: 'btn btn-ghost discover-btn-skip', type: 'button' }, 'Skip');
  const wantBtn = el('button', { class: 'btn btn-primary discover-btn-want', type: 'button' }, 'Add to my list');
  const controls = el('div', { class: 'discover-controls' }, haveBtn, skipBtn, wantBtn);

  const panel = el('section', { class: 'discover-panel', 'aria-label': 'Discover deck', tabindex: '-1' },
    el('div', { class: 'discover-panel-head' }, progressEl, closeBtn),
    stage,
    controls,
    undoBtn,
    liveEl,
  );

  function closeDeck() {
    stopCompletionSync();
    container.replaceChildren();
    container.hidden = true;
    if (typeof onClose === 'function') onClose();
    if (opener) opener.focus();
  }
  closeBtn.addEventListener('click', closeDeck);

  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); closeDeck(); return; }
    if (event.key === 'ArrowLeft') { event.preventDefault(); judge('have'); return; }
    if (event.key === 'ArrowRight') { event.preventDefault(); judge('want'); return; }
    if (event.key === 'Backspace' || event.key === 'u' || event.key === 'U') {
      event.preventDefault();
      undo();
    }
  });

  haveBtn.addEventListener('click', () => judge('have'));
  wantBtn.addEventListener('click', () => judge('want'));
  skipBtn.addEventListener('click', () => judge('skip'));
  undoBtn.addEventListener('click', undo);

  function announce(text) { liveEl.textContent = text; }

  function updateProgress() {
    const total = session.order.length;
    const current = Math.min(session.index + 1, total);
    progressEl.textContent = total ? `${current} of ${total}` : '';
  }

  function cardThreshold(card) {
    return Math.min(COMMIT_PX, card.getBoundingClientRect().width * COMMIT_RATIO);
  }

  function dealCurrent() {
    if (session.index >= session.order.length) { session.locked = false; showCompletion(); return; }
    session.locked = false; // arm: this card, and only this card, now accepts a judgement
    controls.hidden = false;
    const tool = byId.get(session.order[session.index]);
    updateProgress();
    const card = buildCard(tool);
    attachGesture(card, reduced, { getThreshold: () => cardThreshold(card), onCommit: (decision) => judge(decision) });
    stage.replaceChildren(card);
  }

  function judge(decision) {
    if (session.locked) return; // a judgement is already in flight for this card
    if (session.index >= session.order.length) return; // completion/empty screen showing
    session.locked = true;
    const id = session.order[session.index];
    const tool = byId.get(id);
    const card = stage.querySelector('.discover-card');
    session.lastJudged = { id, decision, index: session.index };
    recordDecision(state, id, decision);
    notify(); // a card judged here must reach the browse list's chip too
    session.index += 1;
    undoBtn.hidden = false;
    updateProgress();
    const remaining = session.order.length - session.index;
    const verdict = decision === 'have' ? 'added to what you already use'
      : decision === 'want' ? 'added to your list' : 'skipped';
    announce(`${tool.name}: ${verdict}. ${remaining} card${remaining === 1 ? '' : 's'} left.`);
    if (card) exitCard(card, decision, reduced, dealCurrent);
    else dealCurrent();
  }

  function undo() {
    if (!session.lastJudged) return; // one level only, a second Backspace does nothing
    const { id, index, decision } = session.lastJudged;
    const tool = byId.get(id);
    undoStoredDecision(state, id);
    notify();
    session.index = index;
    session.lastJudged = null;
    session.locked = false; // arm: the restored card now accepts a judgement
    undoBtn.hidden = true;
    controls.hidden = false;
    updateProgress();
    announce(`Undid your choice for ${tool.name}. ${session.order.length - session.index} of ${session.order.length}.`);
    const card = buildCard(tool);
    attachGesture(card, reduced, { getThreshold: () => cardThreshold(card), onCommit: (d) => judge(d) });
    stage.replaceChildren(card);
    animateCardIn(card, decision, reduced);
  }

  /** Tallies are recomputed from the live shared state, filtered to this
      deck's own dealt ids, rather than kept as a running counter: a single
      source of truth that a browse-list chooser change and an in-deck
      judgement both feed identically, so the two can never drift apart
      (PRD section 16: "Deck and list never disagree after a repaint"). */
  function sessionTallies() {
    const tallies = { have: 0, want: 0, skip: 0 };
    for (const id of session.order) {
      const rec = state.decisions[String(id)];
      if (rec && VALID_DECISIONS.includes(rec.d)) tallies[rec.d] += 1;
    }
    return tallies;
  }

  function showCompletion() {
    controls.hidden = true;
    undoBtn.hidden = true;
    progressEl.textContent = 'Done';

    const summaryEl = el('p', {});
    const openInMyStackSlot = el('span', {});
    // Re-render just these two pieces, live, for as long as this exact
    // completion screen stays mounted: a chip/chooser/corner change made on
    // the browse list below must update the counts and hand-off link in
    // place, never a stale snapshot from the moment the deck finished.
    function renderSummary() {
      const { have, want, skip } = sessionTallies();
      summaryEl.textContent = `${have} got it, ${want} on your list, ${skip} skipped.`;
      const handoffUrl = buildHandoffUrl(state);
      openInMyStackSlot.replaceChildren(
        handoffUrl ? el('a', { class: 'btn btn-primary', href: handoffUrl }, 'Open these in My Stack') : null,
      );
    }
    renderSummary();
    announce(`Deck complete. ${summaryEl.textContent}`);
    stopCompletionSync(); // defensive: only one live subscription at a time
    completionUnsub = subscribe(renderSummary);

    const anotherDeckBtn = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Another deck');
    const browseAllBtn = el('button', { class: 'btn btn-ghost', type: 'button' }, 'Browse all');
    anotherDeckBtn.addEventListener('click', () => {
      stopCompletionSync();
      session.order = buildOrder(tools, seed, state);
      session.index = 0;
      session.lastJudged = null;
      if (!session.order.length) { showEmptyState(); return; }
      dealCurrent();
    });
    browseAllBtn.addEventListener('click', () => {
      stopCompletionSync();
      closeDeck();
      if (typeof onBrowseAll === 'function') onBrowseAll();
    });
    stage.replaceChildren(
      el('div', { class: 'discover-completion' },
        el('h3', {}, 'Deck complete'),
        summaryEl,
        el('div', { class: 'discover-completion-actions' }, openInMyStackSlot, anotherDeckBtn, browseAllBtn),
      ),
    );
  }

  function showEmptyState() {
    controls.hidden = true;
    undoBtn.hidden = true;
    progressEl.textContent = '';
    announce('No new tools to judge for this deck.');
    const reviewBtn = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Review judged tools');
    const browseAllBtn = el('button', { class: 'btn btn-ghost', type: 'button' }, 'Browse all');
    reviewBtn.addEventListener('click', () => {
      session.order = buildOrder(tools, seed, state, true);
      session.index = 0;
      if (!session.order.length) return; // nothing in the catalogue at all for this seed
      dealCurrent();
    });
    browseAllBtn.addEventListener('click', () => {
      closeDeck();
      if (typeof onBrowseAll === 'function') onBrowseAll();
    });
    stage.replaceChildren(
      el('div', { class: 'discover-empty' },
        el('p', {}, 'You have already judged every tool in this deck.'),
        el('div', { class: 'discover-completion-actions' }, reviewBtn, browseAllBtn),
      ),
    );
  }

  container.hidden = false;
  container.replaceChildren(panel);
  panel.focus();
  if (session.order.length) dealCurrent();
  else showEmptyState();
}
