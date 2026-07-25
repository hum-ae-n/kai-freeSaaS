/**
 * copy.js: house-voice strings that must read identically wherever they
 * appear (PRD-REGISTER, section 1's positioning sentence and section 11's
 * privacy notice). One source, so workspace.js's Backup/first-run screens
 * and why-register.js's awareness page can never drift apart from each
 * other by so much as a comma. Deliberately has no other exports and no
 * imports of its own: why-register.js is a standalone static page that must
 * stay light, and pulling it through workspace.js would drag in the store,
 * crypto and risk-engine modules for two strings.
 */

// Verbatim, PRD-REGISTER section 1: "The one-sentence positioning, used
// verbatim in copy".
export const POSITIONING_SENTENCE = 'Your password manager holds the keys; the register is the keyring label: which doors exist, who holds which key, and which keys to collect when someone leaves.';

// Verbatim, PRD-REGISTER section 11: "the three-sentence privacy notice
// (verbatim, Backup screen and awareness page)".
export const PRIVACY_NOTICE = 'Your My Stack register is stored only in your own browser: nothing you type is ever sent to us, and if you set a passphrase it is encrypted on your device with a key we never see, so we could not read your register even if we wanted to. Because we cannot see it, we also cannot recover it: if you lose your passphrase, your encrypted register cannot be unlocked, so keep a safe copy of your export. Our hosting provider, Netlify, briefly keeps standard access logs (including IP addresses, held for around 30 days) to run the site; we run no analytics and set no tracking cookies.';
