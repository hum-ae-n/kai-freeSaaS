/**
 * risks.js: pure functions over an account row (PRD-REGISTER section 9.1 and
 * 9.2). Every function here takes plain data and returns plain data: no
 * DOM, no storage, no import of store.js or workspace.js, so these are
 * trivially testable and reusable by the Overview tiles, the Accounts risk
 * chips/filters and the Leavers screen alike. Nothing here is a secret or a
 * credential: this module only ever reasons about metadata (a domain string,
 * an enum value, a date), never about passwords, which do not exist in this
 * schema (PRD-REGISTER section 4.1).
 */

/** Deliberately short and honest (the task's own words): only domains that
    are near-universally a PERSONAL consumer mailbox, never a domain that
    could plausibly be a business's own (custom) domain. Google Workspace and
    Microsoft 365 business tenants use a company's own domain, not these, so
    they are correctly not flagged; only the free consumer mail services are
    listed. proton.me / protonmail.com are consumer webmail like the rest of
    this list, so they are included on the same footing, not specially. */
const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com',
  'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'live.com', 'msn.com',
  'yahoo.com', 'yahoo.co.uk',
  'icloud.com', 'me.com', 'mac.com',
  'aol.com',
  'proton.me', 'protonmail.com',
]);

/** Pull a bare, lower-cased domain out of an identity string. Identities are
    free text (PRD-REGISTER 4.2): a plain email address, or an SSO-style
    label like "Google: name@business.co.uk". Either way the thing to check
    is whatever comes after the last '@'. Returns '' when there is no email
    shape in the string at all (an SSO label with no address, for instance),
    which every risk check below treats as "cannot tell, not a risk". */
export function domainOf(identity) {
  const match = /@([a-z0-9.-]+\.[a-z]{2,})\b/i.exec(identity || '');
  return match ? match[1].toLowerCase() : '';
}

/** True when the identity's domain is a known personal consumer mailbox. */
export function isPersonalEmail(identity) {
  const domain = domainOf(identity);
  return domain !== '' && PERSONAL_DOMAINS.has(domain);
}

/** MFA risk: 'none' and 'unknown' are both risks, but distinct ones worth
    saying differently. 'none' means somebody looked and there genuinely is
    no second factor; 'unknown' means nobody has recorded it yet, which is
    itself a gap worth closing. Returns null for app/sms/hardware (no risk). */
export function mfaRiskLabel(mfa) {
  if (mfa === 'none') return 'No 2FA recorded';
  if (mfa === 'unknown' || !mfa) return '2FA unknown';
  return null;
}
export function hasMfaRisk(mfa) { return mfaRiskLabel(mfa) !== null; }

/** Owner risk: blank or whitespace-only. */
export function hasNoOwner(owner) {
  return !owner || !String(owner).trim();
}

/** True when a renewal date falls within `withinDays` of `now` (default 60,
    per section 9.1/9.2). Deliberately also flags a renewal already in the
    past (a negative day count): an overdue renewal is at least as much of a
    risk as an upcoming one, arguably more, and there is no reason to let a
    lapsed date quietly stop being "soon". A null/invalid renewal is not a
    risk here (it has no date to be soon about); a missing renewal date is a
    completeness gap, tracked separately by completeness() below. */
export function isRenewalSoon(renewal, withinDays = 60, now = new Date()) {
  if (!renewal) return false;
  const date = new Date(renewal);
  if (Number.isNaN(date.getTime())) return false;
  const diffDays = Math.ceil((date.getTime() - now.getTime()) / 86400000);
  return diffDays <= withinDays;
}

/** The eight fields the completeness meter counts (PRD-REGISTER section
    9.2's own list). 'admin' and 'mfa' count as recorded only when they carry
    real information, not the 'unknown' placeholder: an enum sitting on its
    default is exactly as unrecorded as a blank text field, and treating it
    as "filled in" would make the meter lie. */
const COMPLETENESS_FIELDS = ['service', 'url', 'identity', 'owner', 'admin', 'mfa', 'plan', 'renewal'];
export function completeness(account) {
  const filled = COMPLETENESS_FIELDS.filter((field) => {
    const value = account ? account[field] : undefined;
    if (field === 'admin' || field === 'mfa') return !!value && value !== 'unknown';
    return value !== null && value !== undefined && String(value).trim() !== '';
  });
  return { count: filled.length, total: COMPLETENESS_FIELDS.length };
}

/** Every risk filter key the Accounts screen and Overview tiles share, so
    the two never drift into checking slightly different things. */
export const RISK_FILTERS = {
  'personal-email': { label: 'Personal email', test: (a) => isPersonalEmail(a.identity) },
  'no-mfa': { label: 'No 2FA', test: (a) => hasMfaRisk(a.mfa) },
  'no-owner': { label: 'No owner', test: (a) => hasNoOwner(a.owner) },
  'renewing-soon': { label: 'Renewing soon', test: (a) => isRenewalSoon(a.renewal) },
};

/** Free-text search across the fields named in the spec: service, identity,
    owner, notes. Case-insensitive substring match, composes with the risk
    filters above (both must pass) rather than replacing them. */
export function matchesSearch(account, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return true;
  return [account.service, account.identity, account.owner, account.notes]
    .some((field) => (field || '').toLowerCase().includes(q));
}

/* ============================================================================
   Leavers (PRD-REGISTER section 9.5). Pure over an account row and a
   person's name: no DOM, no store, so the ordering rules below are testable
   on their own and reusable exactly as the risk filters above already are.
   ========================================================================= */

/** True when the row's `identity` field reads as belonging personally to the
    departing person, distinct from `owner` (which is how the row was
    selected for this checklist in the first place): either it is a known
    personal consumer mailbox (isPersonalEmail above, since a personal
    Gmail/Outlook/iCloud address dies with the person, not the business), or
    the identity text itself contains a recognisable piece of their name (a
    business alias like "tom@business.co.uk" or an SSO label naming them).
    Either way, whoever opened the account is the one who chose or knows
    its login, which is exactly what phase 3 (section 9.5) needs to flag:
    "rotate what they knew". Name fragments under 3 characters are ignored
    so a stray initial cannot false-positive against unrelated text. */
export function identityBelongsToPerson(identity, person) {
  if (isPersonalEmail(identity)) return true;
  const idLower = (identity || '').toLowerCase();
  if (!idLower) return false;
  const parts = (person || '').toLowerCase().split(/\s+/).filter((p) => p.length > 2);
  return parts.some((part) => idLower.includes(part));
}

/** True when accepting a monthly cost, or a plan string that does not read
    as free, means real money keeps moving until someone acts (section 9.5
    phase 4, "licences and money"). A blank plan with no monthlyCost is not
    flagged: there is nothing here to reclaim or stop paying for. */
export function hasLicenceCost(account) {
  if (typeof account.monthlyCost === 'number' && account.monthlyCost > 0) return true;
  const plan = (account.plan || '').trim();
  return plan !== '' && !/^free\b/i.test(plan);
}

/** Build the five-phase offboarding checklist (section 9.5) for one person,
    from whichever of their rows are still current in `accounts`. Phase 1
    and phase 5 are fixed, person-scoped items with no underlying row (the
    identity-provider account itself is not necessarily its own register
    row); phases 2 to 4 are derived, in order, from the rows this person
    currently owns, so reassigning a row's owner elsewhere and recomputing
    this function is the entire mechanism by which that row leaves phase 2
    (and therefore 3 and 4 too, since both are subsets of phase 2's rows):
    there is no separate "reassigned" flag to fall out of sync with reality.

    Section 16 (BUILD-PLAN 12.4 fix round, 27 Jul): a `planned` row is an
    intention, not an account that exists yet, so it is filtered out of
    `owned` here, at the one place this checklist is built, rather than
    trusting every call site to remember to pre-filter it. `hasRecordedRows`
    (true exactly when `owned` is non-empty, i.e. phase2 is non-empty) is
    returned alongside the phases so the caller can render an honest line
    distinguishing "this person owns nothing recorded here" from "this
    person owns rows but none needed rotating or cost reclaiming", which
    look identical from phase2 alone but mean very different things: phase1
    and phase5 stay in every case (the reader typing any name is treated as
    an assertion that this is a real person whose identity-provider account
    and mailbox exist regardless of what this register happens to record),
    but the caller is expected to state plainly, when `hasRecordedRows` is
    false, that phases 1 and 5 are then generic guidance rather than
    anything drawn from this register. */
export function leaverChecklist(accounts, person) {
  const trimmed = (person || '').trim();
  const norm = trimmed.toLowerCase();
  const owned = (accounts || []).filter((a) => (a.owner || '').trim().toLowerCase() === norm && a.status !== 'planned');
  const rotate = owned.filter((a) => a.shared === true || identityBelongsToPerson(a.identity, trimmed));
  const licensed = owned.filter(hasLicenceCost);
  return {
    person: trimmed,
    hasRecordedRows: owned.length > 0,
    phase1: [{
      key: 'identity-disable',
      text: `Disable ${trimmed ? `${trimmed}’s` : 'their'} sign-in at your identity provider (Google Workspace, Microsoft 365, Okta or similar).`,
      caveat: 'Do NOT suspend their mailbox yet: phase 5 closes it, last, once everything else here is done.',
    }],
    phase2: owned.map((a) => ({ key: `transfer-${a.id}`, row: a })),
    phase3: rotate.map((a) => ({ key: `rotate-${a.id}`, row: a })),
    phase4: licensed.map((a) => ({ key: `licence-${a.id}`, row: a })),
    phase5: [{
      key: 'identity-close',
      text: `Close ${trimmed ? `${trimmed}’s` : 'their'} mailbox and identity provider account fully.`,
      caveat: 'Do this last, only after phases 1 to 4 above are complete.',
    }],
  };
}
