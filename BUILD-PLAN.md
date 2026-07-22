# Build Plan

Derived from `PRD.md`. Each phase lists the owning agent, the files it may touch, and objective acceptance criteria. Numbers in brackets like [DoD 4] refer to PRD section 14 Definition of Done items.

**Status legend:** `[ ]` not started, `[~]` in progress, `[x]` done and verified.

---

## Dependency graph

```
Phase 0 Foundation  (done)
      |
      +-----------------------------+
      |                             |
Phase 2 Shell + DOM contract   Phase 1 Data integrity
      |                             |
      +-------+-------+             | (independent, run in parallel)
      |               |             |
Phase 3 Curator  Phase 4 Client     |
      |               |             |
      +-------+-------+-------------+
              |
        Phase 5 Responsive + a11y
              |
        Phase 6 Docs + deploy
```

Phase 1 touches only `data/tools.json`. Phases 2 to 5 touch only code. They share no files, so they run concurrently. Phases 3 and 4 both depend on Phase 2 having frozen the DOM contract and CSS token block, after which they own separate JS files and separate CSS sections and can also run concurrently.

---

## Phase 0: Foundation `[x]`

Owner: main thread. Complete.

- [x] `git init`, remote wired to `hum-ae-n/kai-freeSaaS`, based on `origin/main`
- [x] Directory layout per PRD section 3, `tools.json` moved to `data/`
- [x] `netlify.toml` per PRD section 9, with a note against `force = true` shadowing the data file
- [x] `.gitignore` covering OneDrive and editor artifacts
- [x] `scripts/validate-data.mjs`, zero dependency schema gate
- [x] `CLAUDE.md`, `BUILD-PLAN.md`, `BUILD-LOOP.md`, `.claude/agents/`

---

## Phase 1: Data integrity `[x]`

Owner: **data-steward**. Files: `data/tools.json` only.

Baseline at Phase 0 close: **290 errors across 82 of 85 tools**. This is the single largest risk in the project. Built strictly to spec, the current data renders 165 dead `<a href="">` links in client mode and fails [DoD 8].

| Rule | Count | Meaning |
|------|-------|---------|
| `training-dead-url` | 90 | training entry with no URL |
| `alternatives-min` | 77 | fewer than 2 alternatives that actually link anywhere |
| `alternatives-dead-url` | 75 | alternatives entry with no URL |
| `training-min` | 48 | fewer than 2 training resources that actually link anywhere |

Note that `alternatives-min` (77) is far worse than a raw array length count suggests (23). Many tools carry two entries where only one is a real link.

Tasks:

- [x] 1.1 Amend PRD section 4 to add the optional `notes` field: array of strings, for non linkable caveats. This is a spec change, so make it in `PRD.md` and note it in the changelog at the bottom of this file.
- [x] 1.2 Sweep every `alternatives` and `training` entry with an empty `url`. For each, either supply the real URL or move the text into `notes`. Entries like `"Paid: Adobe Photoshop, Affinity Photo"` are notes. Entries like `"OpenAI Academy"` have a real URL that was simply omitted.
- [x] 1.3 Split the 17 comma joined entries where one `name` lists several products but carries one `url` (for example `{"name": "Coolors.co, Adobe Color", "url": "https://color.adobe.com"}`). Each product becomes its own entry with its own URL, or moves to `notes`.
- [x] 1.4 Top up every tool to at least 2 genuinely linkable alternatives and 2 linkable training resources. Prefer open source and self hosted options, per PRD section 10.
- [ ] 1.5 Spot check `value` figures against PRD section 10 honesty rule. The validator cannot judge this. Flag anything indefensible rather than silently changing it.

Acceptance: `node scripts/validate-data.mjs` exits 0. Tool count stays 85 and the type split stays 15 core, 50 noncore, 7 m365, 13 sector unless a change is deliberate and recorded below.

---

## Phase 2: Shell and DOM contract `[x]`

Owner: **builder**. Files: `index.html`, `css/styles.css`, `js/data-loader.js`, `assets/logo.svg`.

This phase exists to make phases 3 and 4 safely parallel. It ends by freezing a contract that neither may unilaterally change.

- [x] 2.1 `index.html`: document head, Source Sans 3 font link, two empty mount points `<main id="curator-root" hidden>` and `<main id="client-root" hidden>`, module script tag.
- [x] 2.2 `css/styles.css`: the 18 colour tokens from PRD section 11 as `:root` custom properties, base typography, reset. Then two clearly delimited sections, `/* === CURATOR === */` and `/* === CLIENT === */`, which phases 3 and 4 own respectively.
- [x] 2.3 `js/data-loader.js`: fetch `data/tools.json`, parse URL params, route to mode. Exports the loaded tool array and the parsed selection.
- [x] 2.4 URL param parsing, per PRD section 5. Presence of `t` triggers client mode. Handle the cases the PRD leaves open: unknown ids are skipped silently, malformed values are skipped, and `?t=` with zero valid ids renders an explicit empty state rather than a blank page. **Do not use `.filter(Boolean)` on parsed ids**, or tool 0 is dropped.
- [x] 2.5 Fetch failure renders a visible error message, not a blank page.
- [x] 2.6 `assets/logo.svg`: Kaipability logo. If no source asset is available, build a clean wordmark in brand red `#c0392b` and flag it for replacement.
- [x] 2.7 Freeze the DOM contract into a comment block at the top of `js/data-loader.js`: the ids and class names phases 3 and 4 may rely on.

Acceptance: page loads over HTTP in both modes with a visible placeholder, no console errors. Tool 0 survives a round trip through link generation and client mode parsing.

---

## Phase 3: Curator mode `[x]`

Owner: **builder**. Files: `js/curator.js`, the `CURATOR` block of `css/styles.css`.

Per PRD section 6, top to bottom:

- [x] 3.1 Header: logo, title, subtitle, live tool count
- [x] 3.2 Link generator: client name input, "Generate link", copy button, "Preview client view" in a new tab
- [x] 3.3 Filters: type dropdown (All / Core / Non-core / M365 / Sector / Checked only), category dropdown built from the data, search across name, category, description, alternatives and training
- [x] 3.4 Stats bar: selected count, total value equivalent, showing count
- [x] 3.5 Legend for the four type colours
- [x] 3.6 Tools table, nine columns per PRD section 6, row background matching type, hidden rows via `display: none`
- [x] 3.7 Type default states: `core` pre-checked, all others unchecked, per PRD section 4
- [x] 3.8 Action buttons: copy as tab separated, select all CORE, select all visible, deselect all
- [x] 3.9 Copy output in the exact three column format of PRD section 6, with a TOTAL row. Use the async Clipboard API with a visible toast on success and on failure.
- [x] 3.10 Favicons on tool name URLs only. Not on alternatives or training, per the table in PRD section 8.

Acceptance: [DoD 1], [DoD 2], [DoD 3], [DoD 7]. Filters compose correctly, meaning type and category and search apply together rather than overriding each other.

---

## Phase 4: Client mode `[x]`

Owner: **builder**. Files: `js/client.js`, the `CLIENT` block of `css/styles.css`.

Per PRD section 7:

- [x] 4.1 Header: logo, "Your Free Software Stack", "Prepared for [client]", auto generated date, context line. **Insert the client name with `textContent`.** See the security section of `CLAUDE.md`.
- [x] 4.2 Summary bar: tool count and total annual value, value in success green and prominent
- [x] 4.3 Cards grouped under category section headers, ordered as in PRD section 4
- [x] 4.4 Card layout per the PRD section 7 diagram: favicon, name, value, domain list, description, ALTERNATIVES block, GET STARTED block
- [x] 4.5 Render the `notes` array from Phase 1 as plain text, visually distinct from the links
- [x] 4.6 Every link is an `<a>` with `target="_blank" rel="noopener noreferrer"`
- [x] 4.7 Favicons on tool URLs, alternatives and training, with DuckDuckGo primary, Google fallback, `onerror` hide, `loading="lazy"`, `alt=""`
- [x] 4.8 Footer: "Curated by Kaipability Ltd", logo, link
- [x] 4.9 `@media print`: URLs shown after link text, cards do not break across pages, summary bar simplified
- [x] 4.10 `<article>` elements for cards, per PRD section 12

Acceptance: [DoD 4], [DoD 5], [DoD 6], [DoD 8]. Verified at 375px. `?client=<img src=x onerror=alert(1)>` renders as literal text.

---

## Phase 5: Responsive and accessibility `[~]`

Owner: **builder**, gated by **verifier**. Files: `css/styles.css`, plus minimal markup fixes.

- [x] 5.1 Breakpoints per PRD section 11: above 1200px full table and 2 column cards, 768 to 1200px horizontal scroll table and 1 column cards, below 768px compact stacked controls and full width cards
- [x] 5.2 Keyboard: every checkbox, button and link reachable and operable in tab order
- [x] 5.3 Visible focus indicators on all interactive elements
- [x] 5.4 Contrast at 4.5:1 minimum. The token pairs in PRD section 11 need checking, particularly `--noncore-fg #856404` and `--text-3 #888888` on `--card #ffffff`.
- [x] 5.5 Badges carry text labels, not colour alone
- [ ] 5.6 Favicon load volume: 85 tools times several links each can exceed 300 third party requests. Confirm `loading="lazy"` is doing its job, and consider inlining favicons for the 15 core tools.

Acceptance: [DoD 5], [DoD 6]. Verifier signs off against PRD section 12.

---

## Phase 6: Documentation and deploy `[~]`

Owner: **content-editor**, deploy by main thread.

- [x] 6.1 `README.md`: how to add a tool, how to edit one, the URL schema, how to run locally including the `file://` trap, how to deploy, how to run the validator
- [ ] 6.2 Connect the GitHub repo to Netlify, confirm auto deploy on push to `main`
- [ ] 6.3 Optional custom domain, for example `freestack.kaipability.com`
- [ ] 6.4 Full Definition of Done pass, all ten items, on the deployed URL rather than localhost

Acceptance: [DoD 9], [DoD 10].

---

## Open spec questions

Raised by the PRD review and not yet resolved. Each needs an answer before the phase that depends on it closes.

1. **Curator mode is public.** Anyone who visits the bare domain gets the full curator interface including the `when` column of internal consulting guidance. PRD section 13 defers auth to post v1. Confirm that the `when` text is acceptable for public view, or hide that column until auth exists. Blocks Phase 6.
2. **Favicon proxy dependency.** Two third party services with no SLA sit in the render path of every link. Fallback is handled, but decide whether to self host icons for core tools. Blocks Phase 5.6.
3. **`X-Frame-Options: DENY`** in `netlify.toml` will block the `?embed=true` iframe mode listed in PRD section 13. Fine for v1, flagged for whoever builds embed mode.
4. **Value total defensibility.** PRD section 10 sets an honesty standard with no verification mechanism, and an AI builder cannot judge what a comparable CRM costs. Treat as a human review step in Phase 1.5.

---

## Changelog

Record deliberate deviations from the PRD here so the spec and the build stay reconciled.

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-22 | Added optional `notes` field to the section 4 schema | The `{name, url}` shape had nowhere to put non linkable caveats, so 165 of them were parked in `alternatives` and `training` with empty URLs, which would render as dead links |
| 2026-07-22 | PRD v1.2: added section 7 Security subsection (textContent / escaping rule for URL params and data) | Client name from `?client=` rendered via innerHTML would be an XSS vector on a branded domain |
| 2026-07-22 | PRD v1.2: section 8 favicon fallback made real (delegated error listener, DuckDuckGo then Google then hide) | Spec named Google as fallback but the snippet only hid the image, so the fallback never ran |
| 2026-07-22 | `--text-3` darkened from PRD section 11's `#888888` to `#6b6b6b` | `#888888` on white is 3.5:1, failing the section 12 requirement of 4.5:1 |
| 2026-07-22 | Added `DESIGN-SYSTEM.md` and `scripts/smoke-test.mjs` beyond the PRD section 3 file list | Token/component documentation, and a repeatable headless-Chromium gate covering DoD 1-8 (15 checks: both modes, filter composition, link round trip including tool 0, XSS literal rendering, empty state, 375px overflow). Favicon rendering and real-world contrast remain human checks per BUILD-LOOP |
| 2026-07-22 | PRD v1.3: styling source of truth is now `design-system/` (Kaipability brand system found in-repo). Cream/oxblood/ink palette, Sonny Gothic + Galano Grotesque self-hosted, editorial flat surfaces. Supersedes PRD section 11's provisional Source Sans 3 / `#c0392b` palette, the section 4 pastel badge colours, and the interim `assets/logo.svg` placeholder (deleted; real lockup + mark adopted) | The user's design system landed in `design-system/` mid-build; the PRD palette was always a stand-in |
| 2026-07-22 | PRD v1.2: categories consolidated 23 to 15 (Security merged into Security & Compliance; Design & Creative, Image & Stock, Image Utilities merged into Design & Images; Analytics & SEO plus Local SEO into SEO & Analytics; Social Media, Email Marketing, Publishing, CRM into Marketing & CRM; Business Support plus Grants & Programmes into Grants & Business Support) | 23 categories over 85 tools produced one-tool client-mode sections and near-duplicate headers |
