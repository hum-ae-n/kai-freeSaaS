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
// Movability hint (PRD 17 amended, Phase 15.6): how long the coachDone-
// already-true path waits after mount before shaking the top card, standing
// in for public.js's own finished-promise-then-fallback sequencing on the
// deck-open morph, which this module has no reference to (it does not know
// whether its caller is inside a View Transition at all). 450ms clears both
// the deal-in entrance (200ms) and the morph's own group duration (380ms,
// motion inventory item 4) with a small margin, so the shake reliably lands
// once the open has visually settled rather than fighting either of them.
const SHAKE_HINT_DELAY_MS = 450;

/* --- persistence (PRD 17, "Persistence") ----------------------------------
   Wrapped in try/catch throughout: a blocked store (private mode, some
   webviews) must never stop the deck dealing or completing, it simply stays
   in memory for the session and nothing survives a reload. Ids are always
   read with Number.parseInt and validated with Number.isInteger, never a
   truthiness test, so tool id 0 survives every read and write.

   coachDone (Phase 12 close-out) is additive: a plain boolean bolted onto
   the same v:1 shape rather than a schema bump, exactly the tolerance PRD
   17 asks for ("unknown v: discard and start fresh" only applies to the
   version number itself, never to an unrecognised extra field). A record
   written before this field existed simply parses with coachDone: false,
   which is the correct default: nobody has dismissed a coach mark they
   have never seen. */

function freshState() {
  return { v: 1, lastVisit: new Date().toISOString(), seenIds: [], decisions: {}, coachDone: false };
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
      coachDone: parsed.coachDone === true,
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

/* --- fresh judgement marker (Wave 14.2, PRD section 16 amended, motion
   inventory item 5, "Judged-chip pop") ---------------------------------
   A tiny, module-private, single-slot marker: set immediately before
   notify() fires for a decision that was just now recorded (the browse
   list's setDecision, or the deck's own judge()), and read-and-cleared by
   the very next call to wasFreshlyDecided(id) from js/public.js's chip
   builder. Any OTHER redecoration pass, load-time or otherwise (page
   mount, an unrelated id's notify, a persona-filter redraw), finds nothing
   to read: never load-time redecoration, per the spec's own exclusion, and
   a fresh id is consumed exactly once regardless of how many subscribers
   happen to be registered. Deliberately in-memory only, never persisted:
   a reload has nothing "just judged" to pop for. */
let freshDecisionId = null;
export function wasFreshlyDecided(id) {
  if (freshDecisionId !== id) return false;
  freshDecisionId = null;
  return true;
}

/* --- deck-coach visibility (Phase 21, PRD section 16 amended, "First-
   judgement explainer") ------------------------------------------------
   Whether the deck's own first-open coach overlay (showCoachIfNeeded /
   dismissCoach below) is up right now, for whichever deck is currently
   open. At most one deck is ever open at a time (public.js guards
   re-entrant opens), so a single module-level flag mirrors the per-open
   closure's own `coachVisible` exactly. js/judge-coach.js's caller reads
   this before showing the public-surface judgement explainer, per the
   PRD's "never fires during the deck's own first-open coach" rule: while
   this is true the browse list below is still fully interactive (the deck
   is an inline panel, never a modal), so a judgement made there from a
   chip or quick-judge button has to wait for the next judgement event
   rather than stack a second coach mark on top of the deck's own. */
let deckCoachVisible = false;
export function isDeckCoachOpen() {
  return deckCoachVisible;
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
  freshDecisionId = id; // motion inventory item 5: this id's next chip render may pop
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
    commit threshold, where it reaches full strength. The stamp's own solid
    --paper-2 backing (DISCOVER CSS block) rides along with this same
    opacity, which is fine: the one hard requirement is that the composite
    is fully opaque and legible once opacity reaches 1 at the commit
    threshold, not throughout the whole drag. */
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
  // Cancel any still-running entrance animation first. A running CSS
  // keyframe animation on transform/opacity takes precedence over a CSS
  // transition on the same properties and blocks that transition from
  // ever starting (per spec) until the animation ends, which meant a card
  // judged before its own 200ms deal-in had finished never fired
  // transitionend at all: the exit silently fell back to the 320ms
  // setTimeout every time, and the judged card lingered, visually stuck,
  // for as long as the animation was still notionally "in charge" of it.
  // Removing the class here hands transform/opacity back to ordinary CSS
  // (and this element's own inline styles) immediately, so the exit
  // transition set up below always actually runs and fires on schedule.
  // discover-card-shake (Phase 15.6) is removed for the identical reason:
  // it is a second transform keyframe animation this element can carry (the
  // shake trigger's up-to-450ms delay means it can still be running on a
  // card that gets judged quickly), and left in place it would block the
  // exit transition exactly like a still-running discover-card-enter did,
  // discovered by a real, reproducible test flake while building this
  // wave: a fast judge-then-skip sequence measurably fell back to the
  // 320ms timeout on the shaken card instead of firing transitionend at
  // ~220ms, and the accumulated slack across several cards in a row was
  // enough to desync a test loop's own fixed per-card wait from the
  // deck's actual pace.
  card.classList.remove('discover-card-enter');
  card.classList.remove('discover-card-shake');
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

/** Once-only staggered reveal (the completion card's tallies and buttons):
    the same double-rAF-then-is-in, transition-delay-then-clear pattern
    js/public.js uses for the homepage's first-paint reveal, kept local to
    this module rather than imported, since public.js already depends on
    discover.js and never the other way round. Under reduced motion every
    node simply appears (opacity only, no delay, no stagger), matching the
    DISCOVER CSS block's .discover-reveal rules for the same query. */
function revealStagger(nodes, reduced) {
  nodes.forEach((node, index) => {
    if (!node) return;
    node.classList.add('discover-reveal');
    if (reduced) {
      requestAnimationFrame(() => node.classList.add('is-in'));
      return;
    }
    const delayMs = index * 70;
    node.style.transitionDelay = `${delayMs}ms`;
    requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add('is-in')));
    const clearDelay = () => { node.style.transitionDelay = ''; };
    node.addEventListener('transitionend', clearDelay, { once: true });
    setTimeout(clearDelay, delayMs + 400);
  });
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
    depends on it.

    Returns { isPointerActive }, Phase 15.6: the movability-hint shake
    (triggerShakeHint below) must never fire while a pointer is already down
    on the card, and this is the one place that already tracks that,
    untouched otherwise: no new state, just a read of the existing
    `pointerId` closure variable exposed outward. Deck physics and
    persistence are otherwise unchanged by this wave. */
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
      // Cancel any still-running deal-in animation the instant a drag is
      // claimed, same reasoning as exitCard: a running keyframe animation
      // on transform overrides an inline style on that same property, so
      // dragging a card within its own 200ms entrance would otherwise not
      // visibly respond to the pointer at all until the animation ended.
      // discover-card-shake (Phase 15.6) is removed here for the identical
      // reason: it is the same kind of transform keyframe animation on this
      // same element, and setDragTransform below sets transform inline on
      // every subsequent pointermove, which a still-running animation would
      // silently keep overriding otherwise. This removal always runs before
      // setDragTransform is ever called for this drag (synchronously, a few
      // lines below), so the two never actually composite even for a single
      // frame.
      card.classList.remove('discover-card-enter');
      card.classList.remove('discover-card-shake');
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

  return { isPointerActive: () => pointerId !== null };
}

/** Measures the live card (must already be attached to the document: this
    reads layout, which does not exist before insertion) and moves both
    stamps to sit vertically centred in whatever space is left BELOW the
    name/category header, rather than centred on the whole card. The CSS
    default (top: 50% of the card) is a safe fallback if this cannot run
    for some reason, but a title long enough to wrap to two or three lines
    at a narrow width (the exact case Rocky's phone screenshot caught) can
    reach a third or more of a short card's own height, and a single fixed
    percentage cannot account for that: it has to be measured per card,
    not guessed once in CSS. Runs off the currently rendered (unscrolled)
    layout, which is correct: the stamp is an overlay tied to the card's
    own box, not to whatever the reader has since scrolled its text to. */
function positionStamps(card) {
  const category = card.querySelector('.discover-card-category');
  const haveStamp = card.querySelector('.discover-stamp-have');
  const wantStamp = card.querySelector('.discover-stamp-want');
  if (!category || !haveStamp || !wantStamp) return;
  const cardRect = card.getBoundingClientRect();
  const categoryRect = category.getBoundingClientRect();
  const headerBottom = categoryRect.bottom - cardRect.top;
  const top = headerBottom + Math.max(cardRect.height - headerBottom, 0) / 2;
  haveStamp.style.top = `${top}px`;
  wantStamp.style.top = `${top}px`;
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
 * @param {() => void} [options.onJudge] - Phase 21 (PRD section 16 amended,
 *   "First-judgement explainer"): called once a genuine have/want judgement
 *   commits (never for skip, matching wasFreshlyDecided's own exclusion),
 *   so the caller can offer its own public-surface coaching. This module
 *   never imports js/judge-coach.js itself: the callback shape keeps the
 *   deck engine decoupled from a dialog that only exists on the public
 *   surface, the same reasoning as onClose/onBrowseAll above.
 * @param {boolean} [options.deferFocus] - Wave 14.2, motion inventory item 4
 *   ("Deck-open morph"): when true, this function does not call
 *   panel.focus() itself. js/public.js sets this only when it is about to
 *   mount inside a guarded View Transition, whose spec requires focus to
 *   move into the panel after the transition's `finished` promise rather
 *   than at mount time; every other caller (and every fallback path) keeps
 *   the default, unchanged behaviour below.
 * @returns {HTMLElement} the mounted .discover-panel element, so a caller
 *   coordinating the deck-open morph can hold a direct reference rather
 *   than re-querying the container (which could otherwise pick up a later,
 *   different panel if the reader closes and reopens before this caller's
 *   own deferred focus callback runs).
 */
export function openDiscoverDeck(options) {
  const {
    tools, container, opener, seed = { type: 'default' }, onClose, onBrowseAll, onJudge, deferFocus = false,
  } = options;
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

  // Movability hint (PRD 17 amended, Phase 15.6): currentGesture is the
  // { isPointerActive } handle attachGesture() returns for whichever card
  // is live in the stage right now, kept current by dealCurrent()/undo()
  // below; shakenThisOpen is scoped to this one openDiscoverDeck() call, so
  // it naturally resets to false on every fresh deck open, per "once per
  // deck open", never once per module lifetime.
  let currentGesture = null;
  let shakenThisOpen = false;

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

  /* --- first-open coaching overlay (Phase 12 close-out, redesigned after
     Rocky's phone test: "swipe left and right text not clear") -----------
     Shown over the very first card, once ever per device: the visitor has
     judged nothing yet (state.decisions empty at the moment the deck opens)
     and has never dismissed this exact tip before (state.coachDone). The
     two directions are taught with the same visual language as the real
     verdict stamps a reader sees while actually dragging (large, bold,
     bordered, uppercase, --positive for Got it, --info for Add to my
     list), sized well past the in-card stamp's fs-18 and always at full
     opacity, an overlay on top of the card rather than baked faintly into
     its background, since a low-opacity watermark fights the "legible on
     a single static glance" requirement the animated version never had to
     meet. The ghost-card slide is kept but demoted to reinforcement only:
     the two stamps carry the message on their own, statically, so the
     reduced-motion version (no slide at all) loses nothing. Every judge
     button is disabled for as long as the coach is up, so the very first
     tap anywhere, even squarely on a button before the reader has had a
     chance to read the tip, only ever dismisses it and never records a
     judgement; the close button is deliberately left enabled throughout,
     since leaving the deck entirely must never be blocked by a tutorial. */
  let coachVisible = false;
  let coachTimer = null;
  let coachOverlay = null;

  /** Movability hint (PRD 17 amended, Phase 15.6, "each time a deck opens
      ... the top card runs one brief shake ... to show it can be moved").
      Guards, all hard per spec: `shakenThisOpen` makes this at most once per
      openDiscoverDeck() call, ever, regardless of how many times a caller
      might try to trigger it (dealing a later card never re-shakes);
      `reduced` skips it outright, never even queued; `currentGesture`'s
      `isPointerActive()` (attachGesture's own return value) skips it if a
      pointer is already down on the card at the exact moment this runs, so
      a reader who has already grabbed the card is never fought with an
      animation the pointermove handler would then have to tear down. The
      class is removed on animationend so a later drag claim's own removal
      (see attachGesture's pointermove handler) is belt-and-braces, not the
      only cleanup path.

      `session.index === 0` is the literal reading of "the top card": the
      coachDone-already-true path schedules this on a fixed delay
      (SHAKE_HINT_DELAY_MS) from mount, and a fast reader can judge that
      first card before the delay elapses, by which point stage holds a
      different card entirely. Shaking THAT card instead would not be "the
      top card" any more, and, discovered as a real, reproducible bug while
      building this wave, risks a second transform keyframe animation
      landing on a card mid-way through its own fresh 200ms entrance
      animation, which exitCard()'s own cleanup now defends against
      (removing this class alongside discover-card-enter) but is better
      avoided at the source: if the reader has moved on, the hint is simply
      skipped for this open, never transferred to a later card. */
  function triggerShakeHint() {
    if (shakenThisOpen || reduced || session.index !== 0) return;
    const card = stage.querySelector('.discover-card');
    if (!card || !currentGesture || currentGesture.isPointerActive()) return;
    shakenThisOpen = true;
    card.classList.add('discover-card-shake');
    card.addEventListener('animationend', () => card.classList.remove('discover-card-shake'), { once: true });
  }

  function dismissCoach() {
    if (!coachVisible) return;
    coachVisible = false;
    if (coachTimer) { clearTimeout(coachTimer); coachTimer = null; }
    coachOverlay?.remove();
    coachOverlay = null;
    deckCoachVisible = false;
    haveBtn.disabled = false;
    skipBtn.disabled = false;
    wantBtn.disabled = false;
    // Not a judgement, so no notify(): the browse list has nothing to
    // repaint over a coach mark being dismissed. Best-effort write only,
    // same as every other state mutation in this module: a blocked store
    // just means a device-locked visitor may see the tip again next
    // session, never a broken deck.
    state.coachDone = true;
    writeState(state);
    // Phase 14 close-out: the Continue button (or, for the any-tap and
    // 5s-timeout paths, whichever element last held focus) can be the node
    // that dismissal just removed from the DOM, in which case the browser
    // drops focus to body. The deck's own Left/Right/Backspace/Escape
    // handling lives on panel's keydown listener, so once focus is on body
    // none of those keys reach it any more until a pointer click happens to
    // land back inside the panel. All three dismissal paths (explicit
    // Continue click, any other tap or click within the overlay, and the 5s
    // auto-dismiss) funnel through this one function, so returning focus to
    // the panel here, same preventScroll discipline as the initial mount
    // focus above, keeps the keyboard contract alive after every path.
    panel.focus({ preventScroll: true });
    // Phase 15.6: on a first-ever open the shake fires here, right after the
    // coach mark clears, never while it is still covering the card (every
    // dismissal path, explicit or timed-out, funnels through this one
    // function, so this is the single correct trigger point for that case).
    triggerShakeHint();
  }

  function showCoachIfNeeded() {
    if (Object.keys(state.decisions).length > 0 || state.coachDone) return;
    coachVisible = true;
    deckCoachVisible = true;
    haveBtn.disabled = true;
    skipBtn.disabled = true;
    wantBtn.disabled = true;
    // Left/right stamps, the same visual language (colour, border, weight,
    // uppercase) as the real .discover-stamp-have/.discover-stamp-want a
    // reader sees while actually dragging, just larger and always at full
    // opacity rather than fading in with drag distance: a coach mark has
    // to read on a single static glance, which a proportional-opacity
    // stamp never had to do.
    coachOverlay = el('div', { class: 'discover-coach' },
      el('div', { class: 'discover-coach-ghost', 'aria-hidden': 'true' }),
      el('div', { class: 'discover-coach-directions' },
        el('div', { class: 'discover-coach-stamp discover-coach-stamp-have' },
          el('div', { class: 'discover-coach-stamp-arrow', 'aria-hidden': 'true' }, '←'),
          el('div', { class: 'discover-coach-stamp-text' }, 'Got it'),
        ),
        el('div', { class: 'discover-coach-stamp discover-coach-stamp-want' },
          el('div', { class: 'discover-coach-stamp-arrow', 'aria-hidden': 'true' }, '→'),
          el('div', { class: 'discover-coach-stamp-text' }, 'My list'),
        ),
      ),
      el('p', { class: 'discover-coach-hint' }, 'Swipe left or right, or use the buttons below.'),
      el('button', { class: 'btn btn-primary discover-coach-dismiss', type: 'button' }, 'Continue'),
    );
    // One listener on the overlay itself, not per child: any tap or click
    // anywhere within it (the ghost, either stamp, the hint text, or the
    // explicit Continue button) bubbles here and dismisses, per "dismiss
    // on any tap or click".
    coachOverlay.addEventListener('click', dismissCoach);
    stage.appendChild(coachOverlay);
    announce('New here? Swipe left for Got it, right for Add to my list, or use the buttons below.');
    coachTimer = setTimeout(dismissCoach, 5000);
  }

  panel.addEventListener('keydown', (event) => {
    // Any key dismisses the coach mark first and does nothing else: a
    // reader who has not yet read the tip should never have their first
    // keypress silently register as a real judgement underneath it.
    if (coachVisible) { event.preventDefault(); dismissCoach(); return; }
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
    currentGesture = attachGesture(card, reduced, { getThreshold: () => cardThreshold(card), onCommit: (decision) => judge(decision) });
    stage.replaceChildren(card);
    positionStamps(card); // after insertion: layout must exist to measure it
    // New-card deal-in ("a few fancy animations"): a subtle rise and fade,
    // distinct from the exit (sideways with rotation) and from undo's own
    // animate-back. Never added at all under reduced motion, matching
    // every other motion path in this file; the CSS media query is the
    // second guard on top of that.
    if (!reduced) card.classList.add('discover-card-enter');
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
    // Motion inventory item 5: a deck judgement is exactly as "fresh" as a
    // browse-list one; skip carries no browse-list chip at all, so marking
    // it here is harmless (buildJudgeChipWrap has nothing to pop for skip)
    // but kept precise anyway.
    if (decision !== 'skip') freshDecisionId = id;
    notify(); // a card judged here must reach the browse list's chip too
    // Phase 21: skip carries no judgement of its own (matches the
    // freshDecisionId exclusion just above), and the deck's own coach can
    // never be visible here (every judge control, including this gesture's
    // commit path, is unreachable while showCoachIfNeeded's overlay is up),
    // so this is always a genuine, coach-clear judgement event.
    if (decision !== 'skip' && typeof onJudge === 'function') onJudge();
    session.index += 1;
    undoBtn.hidden = false;
    updateProgress();
    const remaining = session.order.length - session.index;
    const verdict = decision === 'have' ? 'added to what you already use'
      : decision === 'want' ? 'added to your list' : 'skipped';
    announce(`${tool.name}: ${verdict}. ${remaining} card${remaining === 1 ? '' : 's'} left.`);
    // Stamp pop on commit: a single quick scale settle as the verdict
    // locks, regardless of input method. Skip has no stamp of its own, so
    // there is nothing to pop for that decision. A button or keyboard
    // judgement never touched stamp opacity at all before this (only the
    // drag gesture did), so this is also what makes those commits show a
    // verdict stamp for the first time, not only a drag ever did.
    if (card && decision !== 'skip') {
      const stamp = card.querySelector(decision === 'have' ? '.discover-stamp-have' : '.discover-stamp-want');
      if (stamp) {
        stamp.style.opacity = '1';
        if (!reduced) stamp.classList.add('discover-stamp-pop');
      }
    }
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
    currentGesture = attachGesture(card, reduced, { getThreshold: () => cardThreshold(card), onCommit: (d) => judge(d) });
    stage.replaceChildren(card);
    positionStamps(card);
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

    const headingEl = el('h3', {}, 'Deck complete');
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
        headingEl,
        summaryEl,
        el('div', { class: 'discover-completion-actions' }, openInMyStackSlot, anotherDeckBtn, browseAllBtn),
      ),
    );
    // Staggered reveal ("a few fancy animations"): the tallies and buttons
    // arrive one after another rather than all at once, 70ms apart, once,
    // never on later renderSummary() re-renders (those only ever touch
    // summaryEl's text and openInMyStackSlot's single link in place, both
    // of which stay mounted and already revealed).
    revealStagger([headingEl, summaryEl, openInMyStackSlot, anotherDeckBtn, browseAllBtn], reduced);
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
  // preventScroll: true is load-bearing, not a micro-optimisation. Native
  // focus() scrolls the target into view by default, and public.js's own
  // discoverMount.scrollIntoView({behavior:'smooth', block:'start'}) is the
  // single deliberate scroll that is meant to bring the panel on screen.
  // Without preventScroll here, an immediate first tap (well within the
  // ~150-300ms the smooth scroll takes to settle) lands its own focus
  // movement (buttons and links inside the panel also receive focus as
  // part of ordinary interaction) on top of that still-animating scroll,
  // and the two compound: the active card can end up carried hundreds of
  // pixels off-screen at the exact moment a reader judges it. Panel focus
  // here exists for keyboard reachability and the aria-live announcements,
  // not to reposition the page, so it must never scroll on its own.
  // deferFocus (Wave 14.2, motion inventory item 4): the guarded View
  // Transition morph caller moves focus itself, after its own
  // transition.finished promise settles; every other path (including this
  // one whenever VT is unsupported or reduced motion applies) keeps
  // focusing here, at mount time, exactly as before.
  if (!deferFocus) panel.focus({ preventScroll: true });
  if (session.order.length) {
    dealCurrent();
    // Checked once, right here, never re-checked on later cards in this
    // same session: as soon as the first judgement lands, state.decisions
    // stops being empty, so there is nothing to gain from asking again,
    // and the empty-state screen (no card at all) has nothing to coach
    // over in the first place.
    showCoachIfNeeded();
    // Phase 15.6: the other half of the movability hint's two trigger
    // points. coachVisible is only ever true here if showCoachIfNeeded()
    // just turned the coach mark on, in which case triggerShakeHint() fires
    // later, from inside dismissCoach() instead; every other case (coach
    // already dismissed on this device, or a returning visitor with
    // decisions already recorded) reaches here with coachVisible still
    // false, and this is that case's own trigger, on the small delay
    // documented at SHAKE_HINT_DELAY_MS's own definition.
    if (!coachVisible) setTimeout(triggerShakeHint, SHAKE_HINT_DELAY_MS);
  } else {
    showEmptyState();
  }
  return panel;
}
