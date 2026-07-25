/**
 * sample.js: the read-only "Explore an example register" workspace (PRD-
 * REGISTER section 9.7). A fictional firm, eight to ten account rows built
 * to exercise every risk state the Accounts screen and Overview tiles can
 * show: a personal-email identity, missing 2FA, no owner, a renewal due
 * soon, an admin of "unknown", a closed account, and a fully recorded row
 * for contrast. Nothing in this module ever touches js/my/store.js: the
 * example is generated fresh in memory on every visit and is never passed
 * to load()/save(), which is what "never persists" means in practice.
 */

const NOW = new Date();
function daysFromNow(days) {
  const d = new Date(NOW);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function sampleDocument() {
  return {
    schemaVersion: 1,
    business: 'Harbour & Vine Coffee Roasters (example)',
    people: ['Priya Shah', 'Tom Ellery', 'Jess Okafor'],
    accounts: [
      {
        id: 'ex-01', service: 'Xero', url: 'https://xero.com', toolId: null,
        identity: 'accounts@harbourvine.example', owner: 'Priya Shah', admin: 'owner',
        mfa: 'app', plan: 'Starter £15/mo', renewal: daysFromNow(21), monthlyCost: 15,
        status: 'active', notes: 'Bookkeeping, reconciled monthly by Priya.',
      },
      {
        id: 'ex-02', service: 'Canva', url: 'https://canva.com', toolId: 7,
        identity: 'jess.okafor@gmail.com', owner: 'Jess Okafor', admin: 'member',
        mfa: 'none', plan: 'Free', renewal: null, monthlyCost: 0,
        status: 'active', notes: 'Opened on a personal Gmail before Jess joined full time.',
      },
      {
        id: 'ex-03', service: 'Google Workspace', url: 'https://workspace.google.com', toolId: null,
        identity: 'Google: admin@harbourvine.example', owner: '', admin: 'unknown',
        mfa: 'unknown', plan: 'Business Starter £5.20/user/mo', renewal: daysFromNow(45), monthlyCost: 15.6,
        status: 'active', notes: '',
      },
      {
        id: 'ex-04', service: 'Meta Business Suite', url: 'https://business.facebook.com', toolId: null,
        identity: 'tom.ellery@gmail.com', owner: 'Tom Ellery', admin: 'admin',
        mfa: 'sms', plan: 'Free', renewal: null, monthlyCost: 0,
        status: 'active', notes: 'The shop Facebook page lives under Tom’s personal account.',
      },
      {
        id: 'ex-05', service: 'Domain registrar (123-reg)', url: 'https://123-reg.co.uk', toolId: null,
        identity: 'accounts@harbourvine.example', owner: 'Priya Shah', admin: 'owner',
        mfa: 'hardware', plan: '£12/yr', renewal: daysFromNow(310), monthlyCost: 1,
        status: 'active', notes: 'Domain and DNS.',
      },
      {
        id: 'ex-06', service: 'Slack', url: 'https://slack.com', toolId: 61,
        identity: 'accounts@harbourvine.example', owner: '', admin: 'unknown',
        mfa: 'unknown', plan: 'Free', renewal: null, monthlyCost: 0,
        status: 'active', notes: 'Nobody has claimed ownership of this one yet.',
      },
      {
        id: 'ex-07', service: 'Squarespace', url: 'https://squarespace.com', toolId: null,
        identity: 'accounts@harbourvine.example', owner: 'Priya Shah', admin: 'owner',
        mfa: 'app', plan: 'Business £23/mo', renewal: daysFromNow(9), monthlyCost: 23,
        status: 'active', notes: 'Website and online ordering. Renewal due soon.',
      },
      {
        id: 'ex-08', service: 'Old Mailchimp account', url: 'https://mailchimp.com', toolId: null,
        identity: 'tom.ellery@gmail.com', owner: 'Tom Ellery', admin: 'owner',
        mfa: 'none', plan: 'Free', renewal: null, monthlyCost: 0,
        status: 'to-close', notes: 'Replaced by the newsletter tool below. Needs closing.',
      },
      {
        id: 'ex-09', service: 'Newsletter tool (Buttondown)', url: 'https://buttondown.email', toolId: null,
        identity: 'accounts@harbourvine.example', owner: 'Jess Okafor', admin: 'admin',
        mfa: 'app', plan: 'Free', renewal: null, monthlyCost: 0,
        status: 'active', notes: '',
      },
    ],
    createdAt: daysFromNow(-40),
    updatedAt: daysFromNow(-2),
    revision: 7,
  };
}

/** Fabricated backup status for the example, since it never calls store.js
    and so has no real status() to report. Framed honestly as example data,
    not a real persisted state, per the persistent "This is an example"
    banner requirement. */
export function sampleStatus() {
  return { persisted: true, storageOk: true, locked: false, encrypted: false, revision: 7, lastExportAt: daysFromNow(-2) };
}
