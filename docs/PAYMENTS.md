# Payments: build instructions (Phase 13, draft awaiting provider setup)

Rocky's 29 Jul direction: a first payment feature as a learning exercise, provider-agnostic so providers can be switched later. Decided 29 Jul: run BOTH providers, one per product, which doubles the learning while changing nothing structural: Stripe for the tip (cards and wallets suit an impulse gesture), GoCardless for the stack audit (bank rails and lower fees suit invoiced work with known customers, and mandates suit any future retainer or subscription). This document is the build plan; no code exists yet. It becomes buildable the moment the hosted link URLs exist.

## 1. The two trust rules (binding, same force as the register laws)

1. **Payments never influence listings.** Money buys Kaipability's services or supports the site's running; it never buys placement, ranking, retention or wording of any tool in the directory. The "No affiliates, no sponsors, no paid placement" line must remain literally true after this ships. Any future feature that would make it untrue is rejected at spec stage.
2. **No payment machinery on our pages.** No provider SDK, no embedded checkout widget, no card fields, no third-party scripts. The site carries ordinary links to the provider's hosted checkout page and nothing else. This keeps the CSP untouched (script-src stays 'self' plus the two boot hashes), keeps PCI compliance entirely the provider's problem, and keeps the no-backend architecture intact.

## 2. The provider-agnostic pattern

Everything provider-specific lives in one place: a small constants block (suggested: `js/payments.js`, a few lines, no logic) holding the hosted checkout URLs and display labels:

```
export const PAYMENT_LINKS = {
  tip:   { url: 'https://...', label: 'Buy the curator a coffee' },   // Stripe Payment Link
  audit: { url: 'https://...', label: 'Book a stack audit' },         // GoCardless paylink
};
```

Each entry carries its own provider's hosted URL, so the two-provider decision costs nothing: the site neither knows nor cares which provider sits behind a link. Switching either (to Square, PayPal, Ko-fi, anything with hosted checkout) means replacing that one URL and nothing else. No page structure, CSP, or copy changes. That is the whole abstraction; anything cleverer is speculative.

Rendering rules: links are ordinary `<a>` elements built with `el()`, `target="_blank" rel="noopener noreferrer"`, styled as quiet links or a single modest button, never a checkout form. If a URL in the constants block is empty, the corresponding element simply does not render, so the site can ship ahead of the Stripe account being ready.

## 3. What Rocky does in the provider dashboards (the learning curve itself)

Nothing here needs code.

### Stripe (the tip)

In order:

1. Create the Stripe account for Kaipability Ltd (business details, bank account for payouts, VAT status under Settings, Tax).
2. Turn on **Test mode** first. Everything below can be done in test mode with test cards (4242 4242 4242 4242) before going live; this is most of the learning value.
3. Create one Product: "Support Free Stack" (a tip, suggested one-off £3 with "customer chooses price" enabled if preferred).
4. Create its **Payment Link** (Products, select product, Create payment link). Options worth understanding while there: quantity limits, collecting a customer note, the post-payment confirmation page and receipt emails.
5. Check Settings, Branding (logo, cream/oxblood colours) so the hosted checkout page looks like it belongs to Kaipability.
6. Flip to Live mode, repeat 3-4 (Stripe keeps test and live objects separate), and send the live URL for the build.
7. After the first real payment: find it in Payments, issue a partial refund to see how that works, and check the payout schedule under Balance.

### GoCardless (the stack audit)

1. Create the GoCardless account for Kaipability Ltd (business verification takes a little longer than Stripe's, since it is bank-rail onboarding).
2. Use their **sandbox** first, the equivalent of Stripe's test mode, to see a mandate and a collection end to end.
3. Create a paylink (or a one-off payment request) for the Stack Audit at the chosen fixed price. Understand while there: what the customer authorises (a mandate versus a single payment), settlement timing (Direct Debit clears in days, not instantly), and the notification emails both sides receive.
4. Branding settings, so the hosted authorisation page carries the Kaipability identity.
5. Go live, recreate the paylink, and send the live URL for the build.
6. After the first real collection: watch the payout timing and try the refund flow once. Comparing exactly these mechanics against Stripe's card flow is the point of running both.

## 4. Site build (small, one wave)

Owner: builder. Files: `js/payments.js` (new constants), `js/public.js` (footer), `css/styles.css` (PUBLIC block), `scripts/smoke-test.mjs`.

- **Placement**: the public directory footer only, alongside the existing "Talk to Kaipability" line. One sentence for the tip ("Free forever. If it saved you money, buy the curator a coffee.") and one for the audit ("Or book a fixed-fee stack audit."). Client deliverable pages stay payment-free: a client already paying for consulting must never see a tip jar on their deliverable. The /my workspace stays payment-free for the same reason the privacy notice exists: it is the trust surface.
- **Copy laws**: house voice, British English, no em dashes, and one added sentence near the links making rule 1 visible: payments support the site and buy Kaipability's time; they never affect which tools are listed.
- **Smoke checks**: the footer renders both links with correct rel attributes when URLs are present and renders neither when the constants are empty; no new script elements anywhere; the CSP hash set unchanged; the links point at the constants' URLs verbatim.
- Verifier gate as ever, PR with Deploy Preview, Rocky's merge word.

## 5. What this deliberately is not (yet)

- Not subscriptions: if the My Stack hosted-sync tier ever clears its evidence gate, either account can carry recurring billing (Stripe subscriptions on cards, GoCardless on Direct Debit, which suffers no card-expiry churn), and checkout still starts from a hosted link. Running both now means that choice can be made on evidence later. Nothing in this phase blocks or prejudges it.
- Not on-site checkout: that would need a session-creating backend (Netlify Functions is the natural first step) and a CSP change. Only worth it if hosted pages measurably lose buyers, which at this scale they will not.
- Not invoicing: consulting engagements above tip-jar scale should be invoiced normally; Stripe Invoicing exists when wanted, same account, still no site code.

## 6. Acceptance

Phase 13 is done when: both live links work end to end (Stripe test card then one real card payment; GoCardless sandbox then one real collection), the footer renders per section 4 on production, the trust sentence is present, all gates pass, and BUILD-PLAN's Phase 13 entry is ticked with the usual verifier note.
