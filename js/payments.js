/**
 * payments.js: the single place a payment provider's hosted checkout URL may
 * ever appear (docs/PAYMENTS.md section 2, "the provider-agnostic pattern").
 * Switching provider, or filling in a live URL once one exists, is a
 * one-line change here and nothing else: no other file may hold a provider
 * URL, and no page structure, CSP or copy depends on which provider sits
 * behind a link. If a url below is empty, the corresponding footer element
 * in js/public.js simply does not render, so the site can ship ahead of the
 * account being ready.
 *
 * The two trust rules this file exists under (docs/PAYMENTS.md section 1,
 * binding, same force as the register laws):
 *   1. Payments never influence listings. Money buys Kaipability's services
 *      or supports the site's running; it never buys placement, ranking,
 *      retention or wording of any tool in the directory.
 *   2. No payment machinery on our pages. No provider SDK, no embedded
 *      checkout widget, no card fields, no third party script. This file
 *      holds ordinary URLs to a provider's hosted checkout page and nothing
 *      else. No script tag or SDK import may ever be added here, or
 *      anywhere else, for payments.
 *
 * Wave 13.1 shipped both entries empty, ahead of the accounts being ready.
 * The tip URL below is Rocky's live Stripe Payment Link, added once the
 * Kaipability Ltd account was activated: it takes real money, so it is
 * verified on a Deploy Preview by a human before it ever reaches main. The
 * audit entry stays empty until GoCardless clears business verification,
 * which is exactly the empty-renders-nothing case above, live on production.
 */
export const PAYMENT_LINKS = {
  tip:   { url: 'https://buy.stripe.com/3cI00idJjcJzdN75ps3AY01', label: 'buy the curator a coffee' },
  audit: { url: '', label: 'book a fixed-fee stack audit' },   // GoCardless paylink, live URL pending
};
