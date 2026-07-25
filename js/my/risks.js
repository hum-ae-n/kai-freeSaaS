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
