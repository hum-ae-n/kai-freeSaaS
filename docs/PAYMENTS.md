# Payments: build instructions (Phase 13, draft awaiting Stripe setup)

Rocky's 29 Jul direction: a first payment feature as a learning exercise, provider-agnostic so the provider can be switched later. This document is the build plan; no code exists yet. It becomes buildable the moment a hosted payment link URL exists.

## 1. The two trust rules (binding, same force as the register laws)

1. **Payments never influence listings.** Money buys Kaipability's services or supports the site's running; it never buys placement, ranking, retention or wording of any tool in the directory. The "No affiliates, no sponsors, no paid placement" line must remain literally true after this ships. Any future feature that would make it untrue is rejected at spec stage.
2. **No payment machinery on our pages.** No provider SDK, no embedded checkout widget, no card fields, no third-party scripts. The site carries ordinary links to the provider's hosted checkout page and nothing else. This keeps the CSP untouched (script-src stays 'self' plus the two boot hashes), keeps PCI compliance entirely the provider's problem, and keeps the no-backend architecture intact.

## 2. The provider-agnostic pattern

Everything provider-specific lives in one place: a small constants block (suggested: `js/payments.js`, a few lines, no logic) holding the hosted checkout URLs and display labels:

```
export const PAYMENT_LINKS = {
  tip:   { url: 'https://...', label: 'Buy the curator a coffee' },
  audit: { url: 'https://...', label: 'Book a stack audit' },
};
```

Switching provider (Stripe to Square, PayPal, GoCardless, Ko-fi, anything with hosted checkout) means replacing URLs in that one file and nothing else. No page structure, CSP, or copy changes. That is the whole abstraction; anything cleverer is speculative.

Rendering rules: links are ordinary `<a>` elements built with `el()`, `target="_blank" rel="noopener noreferrer"`, styled as quiet links or a single modest button, never a checkout form. If a URL in the constants block is empty, the corresponding element simply does not render, so the site can ship ahead of the Stripe account being ready.

## 3. What Rocky does in Stripe (the learning curve itself)

Nothing here needs code. In order:

1. Create the Stripe account for Kaipability Ltd (business details, bank account for payouts, VAT status under Settings, Tax).
2. Turn on **Test mode** first. Everything below can be done in test mode with test cards (4242 4242 4242 4242) before going live; this is most of the learning value.
3. Create two Products: "Support Free Stack" (a tip, suggested one-off £3 with "customer chooses price" enabled if preferred) and "Stack Audit" (fixed price, whatever the engagement is worth).
4. For each product, create a **Payment Link** (Products, select product, Create payment link). Options worth understanding while there: quantity limits, promotional codes, collecting a customer note, post-payment confirmation page and receipt emails.
5. Check Settings, Branding (logo, cream/oxblood colours) so the hosted checkout page looks like it belongs to Kaipability.
6. Flip to Live mode, repeat 3-4 (Stripe keeps test and live objects separate), and send the two live URLs plus the chosen prices for the build.
7. After the first real payment: find it in Payments, issue a partial refund to see how that works, and check the payout schedule under Balance. That completes the loop the exercise was for.

## 4. Site build (small, one wave)

Owner: builder. Files: `js/payments.js` (new constants), `js/public.js` (footer), `css/styles.css` (PUBLIC block), `scripts/smoke-test.mjs`.

- **Placement**: the public directory footer only, alongside the existing "Talk to Kaipability" line. One sentence for the tip ("Free forever. If it saved you money, buy the curator a coffee.") and one for the audit ("Or book a fixed-fee stack audit."). Client deliverable pages stay payment-free: a client already paying for consulting must never see a tip jar on their deliverable. The /my workspace stays payment-free for the same reason the privacy notice exists: it is the trust surface.
- **Copy laws**: house voice, British English, no em dashes, and one added sentence near the links making rule 1 visible: payments support the site and buy Kaipability's time; they never affect which tools are listed.
- **Smoke checks**: the footer renders both links with correct rel attributes when URLs are present and renders neither when the constants are empty; no new script elements anywhere; the CSP hash set unchanged; the links point at the constants' URLs verbatim.
- Verifier gate as ever, PR with Deploy Preview, Rocky's merge word.

## 5. What this deliberately is not (yet)

- Not subscriptions: if the My Stack hosted-sync tier ever clears its evidence gate, the same Stripe account does recurring billing, and checkout still starts from a hosted link. Nothing in this phase blocks or prejudges that.
- Not on-site checkout: that would need a session-creating backend (Netlify Functions is the natural first step) and a CSP change. Only worth it if hosted pages measurably lose buyers, which at this scale they will not.
- Not invoicing: consulting engagements above tip-jar scale should be invoiced normally; Stripe Invoicing exists when wanted, same account, still no site code.

## 6. Acceptance

Phase 13 is done when: both live payment links work end to end (test card in test mode, then one real transaction), the footer renders per section 4 on production, the trust sentence is present, all gates pass, and BUILD-PLAN's Phase 13 entry is ticked with the usual verifier note.
