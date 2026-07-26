# My Stack: Account Register Workspace. Product Requirements Document

**Project:** `free-stack`, fourth surface
**Owner:** Kaipability Ltd (Rocky Verma)
**Version:** 1.0
**Date:** 26 July 2026
**Build tool:** Claude Code from this PRD
**Relationship to PRD.md:** additive. Everything in PRD.md still binds; where this document is silent, PRD.md governs. This document is authoritative for the `/my` surface and is section numbered; cite sections when implementing.

---

## 1. What this is and why

Small businesses adopting 10-15 tools create 10-15 accounts and lose track of which email or SSO identity opened which one, who owns it, and what must be closed when someone leaves. 63% of businesses have ex-employees with live SaaS access. Password managers hold the keys; nothing holds the keyring label. My Stack is that label: an account REGISTER, tracking metadata about accounts, never the credentials themselves.

The one-sentence positioning, used verbatim in copy: your password manager holds the keys; the register is the keyring label: which doors exist, who holds which key, and which keys to collect when someone leaves.

## 2. Surface and routing

- `/my` renders the workspace. It is client-facing, unlisted from nowhere (linked openly from client pages and the public directory), and noindexed: the page holds a person's business data locally, search engines have no business there.
- Routing joins the existing precedence in `js/data-loader.js`: `t` and `tool` still win anywhere; `/x` and `edit` still reach the curator; `/my` renders the workspace; everything else is unchanged.
- Entry points: a "Set up your workspace" call to action on client pages (passes the stack ids so the register pre-fills), and a quiet link on the public directory. `?from=t:0,2,5` style import parameters carry a stack into setup.

## 3. The storage doctrine (binding, from research)

Browser storage is revocable by three parties who never consult the app: Safari deletes all script-writable storage after 7 days of Safari use without visiting the site, by design; in-app webviews (WhatsApp, LinkedIn, Instagram) hold storage in containers that evaporate; users clear browsing data. Therefore:

- **The export file is the primary home of the register. Browser storage is a working copy.** All UX language, flows and engineering decisions follow from this sentence.
- A register is not "set up" until a verified export exists (§8).
- The UI never claims data is "safe" in the browser. Approved phrasing: "saved in this browser, on this device". Banned phrasing: "your data is safe", "stored securely" (about browser storage).
- `navigator.storage.persist()` is requested on every load; its actual result is surfaced honestly in Backup and never overstated.
- Setup inside a detected in-app webview is refused, not warned about: a blocking notice with an "open in your real browser" affordance. Detection is best-effort user-agent heuristics, hand-rolled, compact.
- A write-read sentinel runs on load; if storage is unavailable or session-only (private browsing), a banner states this browser will not remember anything and setup is blocked.
- iPhone Safari users get an "Add to Home Screen" recommendation in Backup, honestly framed (it gives the app its own storage counter).

## 4. Data model

### 4.1 The law

**No password field exists in any schema in this document, and none may ever be added.** Not encrypted, not hashed, not "just this once". The 2FA field records the METHOD, never a secret. This is the product's trust foundation and it is architectural.

### 4.2 Account row

| Field | Type | Notes |
|---|---|---|
| `id` | string | Local ULID-style, generated client-side |
| `service` | string | Display name ("Canva") |
| `url` | string | https URL |
| `toolId` | integer or null | Link back to `tools.json` id when imported from a stack; null for manual rows |
| `identity` | string | The email address or "Google: name@business.co.uk" / "Microsoft: ..." that opened the account |
| `owner` | string | Human who owns the account |
| `admin` | enum | `owner`, `admin`, `member`, `unknown` |
| `mfa` | enum | `app`, `sms`, `hardware`, `none`, `unknown`. A method, never a secret |
| `plan` | string | "Free", "Pro £12/mo"... |
| `renewal` | ISO date or null | |
| `monthlyCost` | number or null | GBP |
| `status` | enum | `active`, `to-close`, `closed` |
| `notes` | string | |

### 4.3 Workspace document

`{ schemaVersion: 1, business: string, people: [string], accounts: [row], createdAt, updatedAt, revision: integer }`. `revision` increments on every save and drives conflict refusal (§6). Sovereign template rows (bank, HMRC Government Gateway, domain registrar, Meta Business, phone contract) are offered at setup as unticked suggestions, never auto-created.

## 5. Layout: the app shell

Left sidebar, recessive (a few notches quieter than the content, cream-on-cream, oxblood rule marks the active item, no icon zoo): Overview, Accounts, My tools, Costs, Leavers, Backup. Bottom of sidebar: Plain English toggle, theme toggle, lock button (when a passphrase is set). Right: top bar (workspace name, search within accounts) and the active screen. Below 768px the sidebar becomes a top bar with a menu that overlays; no horizontal scroll at 375px. The shell reuses design-system tokens; flat, square, editorial; no gradients, no donuts, no KPI-card decoration.

## 6. Storage architecture

- **Single store module** (`js/my/store.js`): the only code in the surface allowed to touch persistence. Interface: `load()`, `save(data, expectedRevision)`, `exportBlob()`, `importBlob(file, passphrase?)`, `lock()`, `unlock(passphrase)`, `status()`. Every UI mutation flows through it. This is the seam a future sync backend drops into; no other module may call storage APIs directly.
- Primary store IndexedDB, mirror copy in localStorage (same eviction class, but protects against single-store corruption); whole-document reads and writes, no per-entity persistence.
- **Web Locks** (`navigator.locks.request`) wrap every load-mutate-save cycle; a revision check refuses to save over a newer on-disk revision and offers reload; **BroadcastChannel** tells other tabs to refresh after a write. Where Web Locks is unavailable, fall back to revision-check-only.
- Schema version field from day one; unknown versions produce a clear message, never silent failure.

## 7. Encryption (opt-in)

- Opt-in at setup or later from Backup, default off. Enabling shows the consequence sentence, full width, house voice: "If you forget this passphrase, nobody can recover this register. Not you, not us. There is no reset."
- Enabling requires: passphrase entered twice, a downloaded-or-printed recovery sheet step, and a successful test-decrypt of a fresh export before encryption is declared on.
- Cryptography (binding): PBKDF2-HMAC-SHA256, 600,000 iterations, via WebCrypto `deriveKey`, run in a way that does not freeze the UI; 16-byte random salt per register; AES-256-GCM; fresh 12-byte random IV per encryption, never reused; AAD binds the literal string `freestack-register-v1`; derived key non-extractable, memory only, discarded on lock.
- Envelope: `{ v: 1, kdf: "PBKDF2-SHA256", iter: 600000, salt, iv, ct }` (base64 fields). The parser rejects unknown `v` with a clear message. Iterations and algorithms can rise per envelope version.
- When a passphrase is set, plaintext is never written to storage: the working copy in IndexedDB/localStorage is the envelope. Unlock happens per session; auto-lock after 15 minutes idle and on the lock button.
- **Test vectors are a CI gate**: `scripts/register-vectors.mjs` (dev-time Node, WebCrypto-compatible) round-trips committed known vectors and asserts tamper failures (flipped ciphertext bit throws, wrong AAD throws). CI runs it beside the validator and smoke suite.

## 8. Backup-first UX

- Setup does not complete until the user exports the register file AND the app verifies it (silently re-imports the just-exported bytes and confirms round-trip). "Verified backup" is a state the app tracks with a date.
- Export format: JSON, filename `mystack-register-{business}-{date}.fsr.json`. Plain JSON when unencrypted; the envelope when encrypted. A magic `"freestack-register"` header field identifies the file either way. Never a bare custom extension: mail filters and the iOS Files app treat unknown extensions badly.
- On iOS, offer the export through `navigator.share` with a file when available (users can send it to iCloud, mail, WhatsApp themselves); anchor download is the fallback everywhere.
- A backup-age indicator lives in the sidebar footer and the Backup screen: quiet when fresh, amber past 30 days, red past 60 or after 10+ unsaved-to-file changes. The nag is a banner, not a modal, but it does not go away until export.
- Import accepts drag-drop or file picker, prompts for the passphrase when it meets an envelope, and previews (business name, account count, last updated) before replacing the working copy. Import conflicts (working copy newer than file) are stated plainly with both dates.

## 9. Screens

- **9.1 Overview**: risk and status tiles, Watchtower-style but flat editorial (oxblood numerals on cream, broadsheet pull-quote styling): accounts recorded, accounts on personal email (amber), accounts with no 2FA recorded, accounts with no owner, renewals in the next 60 days, backup age. Each tile filters the Accounts screen on click. An "unassigned attention bucket": rows with no owner surface here, Bitwarden-style, rather than rotting in the table.
- **9.2 Accounts**: the register. Five visible columns (Service, Identity, Owner, 2FA, Renewal); everything else in a detail drawer per row. Per-row completeness meter ("4 of 8 recorded"). Personal-email detection (common consumer domains) renders the amber chip. Filters: risk chips (personal email, no 2FA, no owner, renewing soon), free text. Add account manually, from the sovereign templates, or via stack import. Bulk edit of owner (the TrackMySubs complaint). Escape/`textContent` discipline for every rendered field, same as the rest of the site.
- **9.3 My tools**: the imported stack as cards (reusing the client card renderer) with adoption state, linking each tool to its register row (create one if missing).
- **9.4 Costs**: a ledger, not a dashboard: "next 14 days" and "next 60 days" renewal lists (date, service, amount), one monthly/annual toggle on a single total, and the existing indicative cost-growth chart beneath. No donuts.
- **9.5 Leavers**: pick a person (from the owner fields) and generate a printable, tickable offboarding checklist from their rows, in the preservation-to-destruction order, grouped and numbered: 1. Identity first (disable SSO/IdP account, but do NOT suspend the mailbox yet), 2. Transfer ownership (domains, socials, admin roles, documents), 3. Rotate what they knew (shared credentials, flagged to do in the password manager), 4. Licences and money (reclaim seats, cards, subscriptions), 5. Final closure (mailbox last). The "do not suspend email first" nuance is stated on the checklist itself. Print stylesheet applies; checklist state saves to the workspace.
- **9.6 Backup**: export (verified), import, encryption on/off, persist() status honestly reported, Add to Home Screen guidance on iOS, the privacy copy (§11), and the wipe-workspace action (typed confirmation).
- **9.7 First run**: webview and private-mode gates (§3); "Explore an example register" seeded with a fictional firm (two parts instruction, one part delight) alongside "Start your own"; business name; optional stack import; sovereign row suggestions; export-and-verify before "done".

## 10. Security posture

- Strict CSP lands in `netlify.toml` with this phase: `default-src 'none'; script-src 'self' '<hash of the boot inline script>'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'; base-uri 'none'; form-action 'none'`, reconciled with the existing per-path frame rules. The favicon proxy hosts stay allowlisted through `img-src https:`. The theme boot script in `index.html` is hashed, not inlined-and-exempted; `embed.html` gets the same treatment. If the hash approach proves brittle across the two files, moving the boot script to a same-origin file with a tiny flash cost may be chosen, with the trade-off recorded in BUILD-PLAN's changelog.
- `Referrer-Policy: no-referrer` for `/my` specifically (register pages have no business leaking referrers); the site-wide policy stays as is.
- `/.well-known/security.txt` per RFC 9116: Contact info@kaipability.com, Expires one year out, Preferred-Languages en. One line on the site: security contact and a five-working-day response promise.
- The honest threat table from research is reproduced on the awareness page in plain English: what the passphrase genuinely protects (a found export file, a stolen locked device, the shared family computer) and what it cannot (a compromised page, a hostile extension, an unlocked screen).

## 11. Privacy and copy

- The three-sentence privacy notice (verbatim, Backup screen and awareness page): "Your My Stack register is stored only in your own browser: nothing you type is ever sent to us, and if you set a passphrase it is encrypted on your device with a key we never see, so we could not read your register even if we wanted to. Because we cannot see it, we also cannot recover it: if you lose your passphrase, your encrypted register cannot be unlocked, so keep a safe copy of your export. Our hosting provider briefly keeps standard access logs (including IP addresses, held for around 30 days) to run the site; we run no analytics and set no tracking cookies."
- Cyber Essentials wording law: "helps you prepare for Cyber Essentials" and "supports the account-management questions in a Cyber Essentials self-assessment" are permitted; "makes you compliant", "certified", or the CE badge are banned. Certification requires independent assessment and the copy says so.
- No regulated-advice drift: the register records what the business already has; copy never suggests financial products.
- House style binds throughout: no em dashes, British English, plain speech, honesty bar. Plain English mode applies inside the workspace (labels swap exactly as in client mode).

## 12. The awareness page: "Why we built this"

A static page (`why-register.html` or equivalent), linked from the public directory footer, the client page near the workspace CTA, and How-we-choose. Structure per the Plausible/Bitwarden/file-over-app patterns: name the observed problem (which email opened which account, the leaver's last day, the Facebook-page-on-a-personal-Gmail story), the evidence (63% orphaned access; UK SMEs wasting up to £10k/yr; Cyber Essentials Willow bringing every cloud service into scope), the principle (this data should never leave your machine; the export file is yours, plain JSON, outlives us), the keys-and-keyring sentence, the honest threat table, and the one commercial sentence maximum (matching how-we-choose's single-sentence rule). British English, no em dashes, evidence over adjectives.

## 13. Future seam (out of scope, binding on design only)

The store module's whole-blob, compare-and-swap interface is the only contract a future sync backend may use: a dumb encrypted blob store (Standard Notes shape) where the server never holds a key. Nothing in this phase builds it; nothing in this phase may make it harder.

## 14. Accessibility

Sidebar is a `nav` with `aria-current` on the active item; screens are headed h1 > h2; every control keyboard-reachable with the site's focus treatment; tiles are buttons with text, never colour alone; the register table follows the curator table's mobile card pattern below 768px; 44px targets for primary workspace actions; `prefers-reduced-motion` respected (no new motion beyond existing conventions).

## 15. Definition of Done

1. `/my` first run: webview gate, private-mode gate, example register, setup completes only after a verified export.
2. Stack import: a `?from=` link pre-fills rows for that stack's tools, tool 0 included; manual and sovereign-template rows work.
3. The register table renders five columns plus drawer, completeness meters, risk chips; personal-email flags fire on consumer domains; bulk owner edit works.
4. Overview tiles show correct counts and filter the table on click; the no-owner bucket surfaces.
5. Leaver checklist generates in the five-phase order with the mailbox-last nuance stated, prints cleanly, and its ticks persist.
6. Costs ledger lists renewals with a correct total and monthly/annual toggle.
7. Encryption: opt-in flow with consequence sentence, recovery step and test-decrypt; envelope matches §7 byte layout; CI vectors pass, tamper attempts throw.
8. Backup: verified-export state tracked with date; age indicator escalates; import previews and round-trips; iOS share path present.
9. Multi-tab: two tabs cannot silently overwrite each other (locks + revision refusal demonstrated in the smoke suite).
10. persist() requested and its status shown honestly; sentinel detects unavailable storage; no UI copy anywhere claims browser storage is safe.
11. No password field exists in schema, storage, export, or UI; grep-level verification.
12. CSP live and the site fully functional under it; security.txt served; privacy notice verbatim.
13. Awareness page live, linked from the three agreed places, CE wording within the law.
14. Both themes, Plain English mode, 375px, print, and the 50+ check smoke suite extended to cover 1-13's mechanics, all green in CI.
