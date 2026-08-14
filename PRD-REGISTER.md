# My Stack: Account Register Workspace. Product Requirements Document

**Project:** `free-stack`, fourth surface
**Owner:** Kaipability Ltd (Rocky Verma)
**Version:** 1.3
**Date:** 26 July 2026 (v1.1: 26 July 2026)
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
| `status` | enum | `planned`, `active`, `to-close`, `closed` |
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
  - **Conversion exposure (Phase 22, Rocky's 12 Aug direction).** Free trials convert: that is their point, and a register full of free tiers showing £0 hides exactly the trap the August 2026 crackdown targets. Beneath the real total, an indicative line: "If every free tier here converted: from £N/month", where N sums the linked tools' `paid_from` for every row that is free today (status `planned`, or any non-closed row whose `monthlyCost` is null or 0) and carries a `toolId` whose tool has an integer `paid_from` greater than 0. Wording is always "from", never a forecast: `paid_from` is the entry paid tier as last verified, and the line says so ("vendor prices as last checked"). Each qualifying row also shows a quiet per-row note in the costs list and the account drawer: "Free today, from £X/mo if it converts". Rows that qualify as free but have no linked tool or no known `paid_from` are counted in an honest "N free rows with no known conversion price" line rather than silently omitted. Exposure is computed at render time from the loaded catalogue and is NEVER written into the register document: the register records facts about the business, and a vendor's future price is not one. The monthly/annual toggle applies to the exposure line the same as the real total. `toolId` 0 is a real tool throughout (`Number.isInteger`, never truthiness).
  - **Category subtotals (Phase 22.1, Rocky's 14 Aug direction).** Between the single total and the exposure line, real recorded spend grouped by catalogue category: a costed row with a `toolId` takes its linked tool's category; costed rows with no linked tool group under "Not linked to the catalogue". One subtotal per category, only categories with at least one costed row, ordered largest first, the monthly/annual toggle applying throughout. The grand total remains the single figure above; the subtotals must visibly sum to it (same rounding, same source), or the ledger reads as two competing answers.
  - **Scope note (Phase 22.1).** Quiet meta text at the foot of the Costs screen: the ledger covers what is recorded here, typically software subscriptions; advertising spend, usage-based infrastructure bills and one-off purchases sit outside it unless they are recorded as accounts with a monthly cost. The register is a register, not a bookkeeping system, and the note may not imply otherwise.
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

---

## 16. Account status: `planned` (amends §4.2)

The §4.2 `status` enum (`active`, `to-close`, `closed`) does not cover an account the business intends to open but has not yet. Phase 12 adds it. The enum becomes:

`planned`, `active`, `to-close`, `closed`

Apply the addition to the §4.2 table row in place.

- **Meaning**: the business has decided to sign up for this service and has not done so yet. A `planned` row records the intention (service, url, `toolId`, ideally the identity it WILL be opened with) so the sign-up happens deliberately rather than with whatever email was to hand.
- **Rendering**: a quiet chip on the Accounts table and drawer, and a "To sign up" group so planned rows do not mix silently into the live register.
- **Risk arithmetic**: planned rows are excluded from the Overview risk tiles (no 2FA recorded, personal email, no owner) and from the Leavers generator. An account that does not exist yet is a plan, not a risk. They still count in "accounts recorded" and still carry the completeness meter.
- **Transition**: marking a planned row `active` changes the status field and nothing else automatically; the reader confirms the identity actually used. Never invent facts.
- **Schema**: additive; `schemaVersion` stays 1. Existing documents and exports remain valid. The export file is the only long-lived artefact and a current build reads both old and new values; the importer treats an unknown status string as data, never a crash.
- **No password field exists anywhere in this amendment and none may be added.** Restated because every schema touch restates it.

## 17. Batch account add (§9.2 extension)

Several services often share one identity, one owner and one 2FA method (everything opened with `accounts@business.co.uk` by the same person). Entering that ten times is the tedium that stops registers being filled in. Batch add enters it once.

- **Entry**: an "Add several at once" action on the Accounts screen, beside the existing single add.
- **Step 1, pick services**: a multi-select over the tool catalogue (search-as-you-type), the sovereign templates, and free-text manual names, mixable in one batch. A count shows what is ticked. Tool-backed picks carry their `toolId` (id 0 valid, compared with `Number.isInteger`, never truthiness).
- **Step 2, shared details, entered once**: identity, owner, `mfa` (method only, as ever), and optionally plan and status (default `active`; `planned` selectable for a batch of intentions). The same personal-email detection and amber chip from §9.2 fire on the shared identity, once, before creation.
- **Step 3, review and commit**: one listed row per service, then a single commit. **The whole batch is one `store.save()` call**: one load-mutate-save cycle under one Web Lock, one revision increment, the standard `ConflictError` refusal if another tab got there first. Never N saves for N rows.
- **Per-row overrides happen after creation**, through the existing detail drawer, like any other row. The batch form deliberately carries no per-row fields: it does one job.
- Batch add is a UI convenience over the existing row shape. No new fields, no new store method, no password field.

## 18. Sign-up to-do generator

Turns a set of tools into a printable, copyable checklist for opening the accounts properly, and optionally pre-seeds the register so the intention is recorded before the first signup.

### Where it lives

Not a seventh sidebar item: the shell's six screens stand. The generator is a sheet reached from:

- the Accounts screen, as a bulk action over the "To sign up" group or a selection of rows ("Sign-up list");
- the stack-import review, on a Discover arrival (§19), covering the want-list ids;
- the My tools screen, for imported tools with no active register row.

### Checklist content, per tool, in order

1. **Sign up with your business email, not a personal one.** When the batch or row already records the intended identity, it is printed here; when that identity is a consumer domain, the amber warning appears on the checklist too.
2. **Turn on two-factor authentication**, app-based where the service offers it.
3. **Record the account in this register**: identity used, owner, 2FA method.
4. **The free-tier caveat**: the tool's `free_limit` sentence verbatim, when the catalogue has one, so the signup happens with eyes open.

Copy stays inside the §11 laws: the checklist may say it "helps you prepare for Cyber Essentials"; it never claims compliance and never shows the CE badge.

### Output

- **Print**: the in-page print-sheet pattern exactly as `printRecoverySheet` and the leaver checklist in `js/my/workspace.js` (mount a `.my-print-sheet` node, body class, `window.print()`, cleanup on `afterprint`). Never `window.open`. The button is labelled "Print or save as PDF".
- **Copy as text**: async Clipboard API with the existing toast on success and failure. Plain text: a header line ("Sign-up list for {business}, {date}"), one block per tool with `[ ]` tick boxes, blank line between tools. No markdown tables, no HTML.
- Both outputs render only what the register and catalogue hold. Never any secret; `mfa` is a method label.

### Pre-seed (opt-in)

- A checkbox, off by default: "Add these to the register as planned". Ticked, commit creates one `planned` row per tool **through a single `store.save()`**, same discipline as §17. Never automatic, never a second module touching storage.
- **No duplicates**: a tool whose `toolId` already matches an existing row (strict comparison; `toolId` 0 is real) is listed on the checklist but not re-created.
- Rows are created with service, url and `toolId` from the catalogue; identity and owner stay blank unless the generator was fed from rows that already record them. Ticking a list into existence records intentions, not facts.

## 19. Discover arrival: `?from=` and `?have=` (§2, §9.7 extension)

The public Discover deck (PRD §17) hands its judgements to the workspace **entirely in the URL**. No `/my` module reads the deck's `freestack:v1:discover` key: `store.js` remains the only storage-touching module on this surface, and the deck's key belongs to the public surface alone.

```
/my?from=<want-ids>&have=<have-ids>
```

- **Grammar, both parameters**: the `?t=` grammar, optional `t:` prefix accepted, parsed by the shared `parseSelection` after prefix strip, exactly as `?from=` is parsed today. Id 0 valid, unknown ids and duplicates dropped silently. A raw parameter value longer than **512 characters** is treated as absent (defensive; `parseSelection` already bounds the resolved list to the active catalogue).
- **`have=`** carries the got-it list: tools the visitor already uses. The import review offers them pre-ticked under "Already using these"; accepted rows are created with status `active`, service, url and `toolId` from the catalogue, identity and owner blank (nobody but the reader knows who opened them).
- **`from=`** keeps its existing meaning and its backward compatibility. **When `have=` is absent** (every client-page link ever sent), behaviour is exactly today's: import offer, rows default `active`. **When `have=` is present in the URL, even with an empty value**, the arrival is a Discover hand-off: the `from=` ids are presented as "Want to try", default status `planned`, and the sign-up to-do generator (§18) is offered for them. Discover always emits `have=` for this reason (PRD §17).
- Both groups flow through the existing import review and commit in **one `store.save()`** together with whatever sovereign templates were ticked.
- On first run, the arrival passes through the unchanged §9.7 gates and setup (webview, sentinel, export-and-verify); the generator offer appears on first landing in the app shell, never before the register exists.
- `skip` judgements never reach this surface at all.

## 20. Reading-copy exports: CSV, TXT, print-to-PDF (§8, §9.6 extension)

Rocky's direction: the register should also come out as CSV, TXT and PDF for reading, sharing and filing. These are **reading copies**. They join the Backup screen; they change nothing about the doctrine.

### The reading-copy law

- **Only the register file (`.fsr.json`) can be imported back. These cannot be imported, only json can.** Every surface that shows these options carries that line, in exactly that spirit, house voice.
- The register file stays presented **first**, as the primary backup, per §3. The reading copies render below it, visually subordinate.
- Reading copies **never count as a verified export**: they do not touch the verified-backup state, its date, `savesSinceExport`, or the §8 backup-age escalation. Exporting a CSV while the JSON backup is 70 days old leaves the red indicator red.

### Formats

- **CSV**: direct download, vanilla JS, `Blob` plus the existing `downloadBlob` helper pattern in `js/my/workspace.js`. One row per account, header row, the §4.2 fields the register holds and nothing else. **Formula-injection escaping is mandatory** (OWASP): any cell whose value starts with `=`, `+`, `-`, `@`, or a tab gets a leading apostrophe; every field is double-quoted with internal quotes doubled; CRLF line endings. Register fields are user-entered text and spreadsheets execute formulas; this is a §9.2-grade escaping duty, not polish.
- **TXT**: direct download, same `Blob` pattern. A readable plain-text listing grouped like the register table (grouped by status, then service, identity, owner, 2FA method, renewal, notes), header line with business name and date. No markup.
- **PDF**: **no library, ever** (the no-dependency law binds). PDF is the in-page print-sheet path: the `printRecoverySheet` pattern (mounted `.my-print-sheet` node, body class, `window.print()`, `afterprint` cleanup), button labelled **"Print or save as PDF"**. The print sheet is a clean tabular listing of the same content as TXT.
- All three contain only what the register holds: never passphrase material, never any secret; `mfa` is a method label only. Grep-level §4.1 verification extends to these outputs.

### Encrypted registers

Reading copies render from the **unlocked in-memory document only**. A locked register offers no CSV, TXT or PDF: the buttons are absent or disabled with the standard locked message, and no code path derives a reading copy from the stored envelope.

### Acceptance criteria (this section)

1. CSV, TXT and "Print or save as PDF" appear on the Backup screen below the register file export, each surface carrying the cannot-be-imported line, with the JSON register file presented first.
2. A cell value of `=2+5`, `+44...`, `-x`, `@a` or tab-led text round-trips into the CSV with a leading apostrophe, quoted, CRLF endings; opening in a spreadsheet executes nothing.
3. Producing any reading copy leaves `savesSinceExport`, the verified-backup date and the backup-age indicator untouched.
4. TXT groups rows like the register table and includes only §4.2 fields; grep of all three outputs finds no password-shaped field.
5. Print path mounts and cleans up the in-page sheet, never `window.open`, and produces a usable PDF via the browser dialogue.
6. With the register locked, no reading copy can be produced.

## 21. Definition of Done, Phase 12 register features

1. `status` accepts `planned` end to end: schema, table chip, "To sign up" group, drawer, exports; planned rows are excluded from risk tiles and the Leavers generator; existing documents load unchanged.
2. Batch add creates N rows from one shared identity/owner/mfa form in exactly one `store.save()` (revision increments by 1), with personal-email detection firing on the shared identity and per-row overrides available in the drawer afterwards.
3. The sign-up generator produces the four-point checklist per tool including the `free_limit` line where present, prints via the in-page sheet, copies as plain text with a toast, and stays within the §11 Cyber Essentials wording law.
4. Pre-seed, when opted in, creates `planned` rows in one save with no duplicate `toolId` rows; tool 0 pre-seeds correctly; opt-out creates nothing.
5. `/my?have=0` offers tool 0 under "Already using these" and commits it as one `active` row. `/my?from=2,5&have=0` defaults tools 2 and 5 to `planned` and offers the generator. `/my?from=t:0,2,5` without `have=` behaves exactly as before Phase 12.
6. A raw `from=` or `have=` value over 512 characters is ignored; no `/my` module reads `freestack:v1:discover`; all persistence still flows through `store.js` (grep-level verification).
7. Reading-copy exports meet §20's own acceptance list in full.
8. No password field exists in any new schema, form, storage, export or output; grep-level verification extended to the batch form, the generator, and all three reading copies.
9. Both themes, Plain English labels, 375px, print, and the smoke suite extended over items 1-8, all green in CI.
