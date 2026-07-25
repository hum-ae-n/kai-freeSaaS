/**
 * templates.js: the sovereign template suggestions (PRD-REGISTER section
 * 4.3): "bank, HMRC Government Gateway, domain registrar, Meta Business,
 * phone contract". These are offered unticked at first-run setup AND from
 * an "Add from templates" affordance on Accounts (section 9.2/9.7); this
 * module only describes the suggestions and how to turn a ticked one into
 * a blank account row, never persists anything itself.
 */

export const SOVEREIGN_TEMPLATES = [
  {
    key: 'bank',
    service: 'Business bank account',
    url: '',
    notes: 'Your day to day business banking login. Add your bank’s own address above.',
  },
  {
    key: 'hmrc',
    service: 'HMRC Government Gateway',
    url: 'https://www.gov.uk/log-in-register-hmrc-online-services',
    notes: 'Tax, PAYE and VAT filing.',
  },
  {
    key: 'registrar',
    service: 'Domain registrar',
    url: '',
    notes: 'Wherever your domain name is registered and renewed. Add the registrar’s address above.',
  },
  {
    key: 'meta',
    service: 'Meta Business',
    url: 'https://business.facebook.com',
    notes: 'Facebook and Instagram business presence.',
  },
  {
    key: 'phone',
    service: 'Phone contract',
    url: '',
    notes: 'The account for a business mobile or landline contract.',
  },
];

/** Turn a ticked template into a blank-ish account row: everything a person
    would have to type by hand (identity, owner) stays blank on purpose, per
    section 4.3's "never auto-created" spirit even once ticked: ticking adds
    the row, it does not invent facts nobody has confirmed yet. `newId` is
    passed in so this module stays free of any ID-generation opinion of its
    own; workspace.js already owns that (section 6, one ID scheme, one
    place). */
export function templateToRow(template, newId) {
  return {
    id: newId(),
    service: template.service,
    url: template.url,
    toolId: null,
    identity: '',
    owner: '',
    admin: 'unknown',
    mfa: 'unknown',
    plan: '',
    renewal: null,
    monthlyCost: null,
    status: 'active',
    notes: template.notes,
  };
}
