/**
 * why-copy.js: the single source of the "Why this exists" disclosure copy
 * (PRD section 16, Rocky's 11 Aug direction). Follows js/savings-copy.js's
 * precedent exactly: the words are written once here and imported by both
 * js/public.js (the rendered, collapsed <details>/<summary> on the homepage)
 * and scripts/build-seo.mjs (the static crawler block), so the two surfaces
 * can never drift the way the hero sentence once did (see savings-copy.js's
 * own banner for that history). Kept free of DOM and Node APIs so both sides
 * can import it unchanged.
 *
 * Each paragraph is an array of segments. A plain string segment is rendered
 * as text; an object segment ({ text, href }) is a link and is always built
 * as a real anchor, never templated into an HTML or text string, so the one
 * link in this copy (the Guardian report) gets identical href, target and
 * rel treatment on both surfaces.
 */

export const WHY_TITLE = 'Why this exists';

const GUARDIAN_URL = 'https://www.theguardian.com/business/2026/aug/09/burnham-vows-crackdown-on-rip-off-business-practices-to-ease-cost-of-living';
const GUARDIAN_LINK_TEXT = 'reported in the Guardian, 9 August 2026';

export const WHY_PARAGRAPHS = [
  [
    "In August 2026 the government announced a crackdown on rip-off pricing and subscription traps: fake discounts banned, cooling-off periods after renewals, subscriptions made easier to cancel. Its own figures put the average person's subscription spend at about £500 a year, with £1.6bn a year going on subscriptions nobody wants (",
    { text: GUARDIAN_LINK_TEXT, href: GUARDIAN_URL },
    ').',
  ],
  [
    'Free Stack was already live before the announcement, built on the same conviction: small businesses and founders are routinely sold software they could have had free. Most "best free tools" lists are affiliate marketing, and the recommendation follows the commission.',
  ],
  [
    'This directory is the correction. Every tool here has a genuinely free tier with its limits stated honestly. Every tool carries at least two alternatives, open source included where it exists, so nobody gets locked in. Every value figure is what a commercial equivalent would really cost, not a number inflated to impress. Nobody paid to be listed, and nobody can.',
  ],
  [
    'If you are starting a business, begin with a starter stack: a working toolkit at zero cost from day one. If you are established, read this page as a subscription audit: set what you pay against what is free here, and keep the difference.',
  ],
];
