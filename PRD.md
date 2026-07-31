# Free Stack: Product Requirements Document

**Project:** `free-stack`
**Owner:** Kaipability Ltd (Rocky Verma)
**Version:** 1.5
**Date:** 30 July 2026 (v1.0: 14 July 2026; v1.5: 30 July 2026)
**Build tool:** Claude Code from this PRD
**Deploy target:** Netlify via GitHub

---

## 1. What This Is

A curated directory of free and freemium SaaS tools for small businesses. Think CNET Download for the SaaS era: no affiliate links, no sponsored placements, no vendor bias. Just an honest, practitioner-vetted catalogue of what's actually available at zero cost, with alternatives for everything so nobody gets locked into a single stack.

Two modes, one URL:

- **Curator mode** (default): the full directory with filters, search, checkboxes. A consultant or advisor selects the tools relevant to a specific client.
- **Client mode** (URL with params): a clean, branded, shareable page showing only the selected tools. Cards, favicons, clickable links, training resources. This is what the client opens.

The workflow: curator picks tools, generates a link, shares it. Client gets a personalised free software stack with everything they need to get started.

---

## 2. Why This Exists

Every small business has access to a staggering amount of free software. The problem is discovery: which tools exist, which are any good, what the alternatives are, and where to learn them. Most "best free tools" articles are affiliate-driven listicles that recommend one product per category and ignore the rest.

This is the opposite. Every tool listed carries alternatives (including open-source and self-hosted options). Every tool has training resources with direct links. Value equivalents are honest. The directory is maintained by a practitioner who uses these tools with real clients, not a content farm optimising for clicks.

It's also a consultant's tool. Rather than rebuilding a free software list from scratch for every client, a consultant selects from the master catalogue and generates a shareable link. The client gets a professional, readable, mobile-friendly page. The consultant saves an hour per engagement.

---

## 3. Repo Structure

```
free-stack/
├── index.html              # Single-page app (both modes)
├── data/
│   └── tools.json          # All tools, single source of truth
├── css/
│   └── styles.css          # All styles (curator + client modes)
├── js/
│   ├── data-loader.js      # Loads tools.json, parses URL params, routes to mode
│   ├── curator.js           # Curator mode: table, filters, selection, link gen
│   └── client.js            # Client mode: card rendering, grouped by category
├── design-system/           # Kaipability brand system: tokens, fonts, logos. Source of truth for styling.
├── netlify.toml             # Netlify deploy config
├── README.md                # How to add tools, deploy, URL schema
└── PRD.md                   # This document
```

No build step. No framework. No npm. Vanilla HTML, CSS, JS. The page fetches `tools.json` at runtime. Edit the JSON, push, Netlify deploys. Maintenance cost is near zero.

---

## 4. Data Model: `tools.json`

Array of tool objects. Single source of truth. Every field required.

```json
[
  {
    "id": 0,
    "name": "Claude Free / ChatGPT Free / Gemini",
    "urls": [
      { "label": "claude.ai", "domain": "claude.ai" },
      { "label": "chatgpt.com", "domain": "chatgpt.com" },
      { "label": "gemini.google.com", "domain": "gemini.google.com" }
    ],
    "category": "AI Assistants",
    "type": "core",
    "description": "AI writing, research, content drafting, business planning. Free tiers sufficient for most SME needs. Using more than one gives a second opinion on important drafts.",
    "alternatives": [
      { "name": "Claude", "url": "https://claude.ai" },
      { "name": "ChatGPT", "url": "https://chat.openai.com" },
      { "name": "Gemini", "url": "https://gemini.google.com" },
      { "name": "Microsoft Copilot", "url": "https://copilot.microsoft.com" },
      { "name": "Perplexity", "url": "https://perplexity.ai" }
    ],
    "training": [
      { "name": "Anthropic Prompt Engineering Guide", "url": "https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering" },
      { "name": "OpenAI Academy", "url": "https://openai.com/academy" },
      { "name": "YouTube: AI for small business", "url": "https://www.youtube.com/results?search_query=AI+for+small+business+beginners" }
    ],
    "value": 200,
    "when": "Every client. Universal."
  }
]
```

### Field definitions

| Field | Type | Description |
|-------|------|-------------|
| `id` | integer | Sequential, stable. Used in URL params. Never reorder existing IDs; new tools get the next number. |
| `name` | string | Display name. Slashes for grouped tools ("Claude Free / ChatGPT Free / Gemini"). |
| `urls` | array of `{label, domain}` | Product URLs. `domain` drives favicon lookup (§8). `label` is display text. |
| `category` | string | Grouping. Drives filtering (curator) and section headers (client). |
| `type` | enum | One of: `core`, `noncore`, `m365`, `sector`. See below. |
| `description` | string | 1-3 sentences. What it does and why it matters. Written for the end user, not the curator. |
| `alternatives` | array of `{name, url}` | Minimum 2 per tool, counted as entries with a live URL. Full `https://` URLs. Open-source/self-hosted included where they exist. |
| `training` | array of `{name, url}` | Minimum 2 per tool, counted as entries with a live URL. Official docs, free courses, YouTube. Full `https://` URLs. |
| `notes` | array of strings | Optional. Non-linkable caveats: pricing gotchas, platform restrictions, "paid alternative" asides. Renders as plain text in client mode. |
| `value` | integer | Annual value equivalent in GBP. Honest (see §10). |
| `when` | string | Curator guidance: when to include this tool for a client. |
| `archived` | boolean | Optional, default false. Retires a tool without deleting it (see ID permanence below). Archived tools are hidden from the curator table and excluded from new links. On an old client link they render a compact "no longer recommended" state pointing at their alternatives, never a silent disappearance. |
| `last_verified` | string | Optional. ISO date (`YYYY-MM-DD`) when the tool's links and free-tier claim were last checked by a human or the link sweep. Client mode may surface it as a freshness signal. |
| `free_limit` | string | Optional. What the free tier genuinely includes and where it stops, in plain English for the end user ("Free for 1 user and 3 social channels", "Free forever, no paid tier"). Same honesty bar as `value` (§10). |
| `paid_from` | integer | Optional. GBP per month for the cheapest paid tier a growing business would realistically hit after outgrowing the free tier. `0` means genuinely free with nothing to outgrow. Annual-only prices are divided by 12 and rounded. |
| `scales_with` | enum | Optional. What drives the cost up: `users` (per-seat), `usage` (volume, storage, sends), `features` (capability gates), `none` (free tier is the product). Drives the client-mode cost-growth visual. |
| `byo` | string | Optional. One or two honest sentences on building a lightweight replacement yourself instead of adopting the tool, now realistic with AI-assisted development for many categories. Only present where a competent generalist could genuinely build and maintain the result; never on security, compliance, accounting or deliverability-critical categories, where the honest advice is to use the real thing. Renders as a distinct "Or build your own" line on client cards. |
| `plain` | string | Optional. The tool in the plainest possible words for a reader with no technical vocabulary: one short sentence, ideally 12 words or fewer, no product jargon ("Make posters and social posts that look professional"). Used by client-mode Plain English mode in place of `description`. Same honesty bar as everything else. |

### ID permanence

Client links carry only tool IDs, so every link ever sent is a live dependency on this file. IDs are therefore permanent: **never delete a tool's entry and never reuse its ID.** To retire a tool, set `archived: true` and keep the entry. Deleting an entry silently removes that tool from every client page it was ever included on, with no trace for the reader.

**Every entry in `alternatives` and `training` must carry a live URL.** Both render as `<a href>` tags, so an entry with an empty `url` becomes a dead link on a page a client opens. Anything that is a caveat rather than a destination belongs in `notes`. The minimums above count linkable entries only, not raw array length.

Validate with `node scripts/validate-data.mjs`, which enforces this section and exits non-zero on any violation.

### Types

| Type | Meaning | Badge colour | Default state |
|------|---------|-------------|---------------|
| `core` | Recommend for virtually every small business | Sage tint (`--positive-tint`) | Pre-checked |
| `noncore` | Depends on client need | Aged amber tint (`--caution-tint`) | Unchecked |
| `m365` | Only relevant if client has Microsoft 365 | Slate tint (`--info-tint`) | Unchecked |
| `sector` | Industry-specific | Lavender tint (`--lavender-2`) | Unchecked |

Badge colours are the semantic tints from the Kaipability design system (v1.3; the original bootstrap-style pastels are superseded). Badges always carry a text label, never colour alone.

### Categories (initial set, expandable)

AI Assistants, Business Operations, Cloud & Docs, Communication, Design & Images, E-commerce, Finance, Grants & Business Support, Learning, Market Research, Marketing & CRM, SEO & Analytics, Sector Specific, Security & Compliance, Video & Audio

Fifteen categories. Consolidated from the original 23 in v1.2: near-duplicates ("Security" vs "Security & Compliance", "Image & Stock" vs "Image Utilities") produced one-tool section headers in client mode, which read as clutter. Keep categories broad enough that a typical 12-tool client selection produces 5-8 sections, not 10+.

---

## 5. URL Schema

### Curator mode (default)

```
https://[domain]/
```

No query parameters. Full admin interface.

### Client mode

```
https://[domain]/?client=Acme+Ltd&t=0,2,5,7,8,9,12,13,14,20,25,30
```

| Param | Required | Description |
|-------|----------|-------------|
| `t` | Yes (triggers client mode) | Comma-separated tool IDs |
| `client` | No (recommended) | URL-encoded client/recipient name for the header |

Presence of `?t=` switches the page to client mode. Absence means curator mode.

---

## 6. Curator Mode Specification

### Layout (top to bottom)

1. **Header**: Logo, title "Free Stack", subtitle "Curated free software for small business", tool count.

2. **Link Generator** (boxed section):
   - Text input: client/recipient name
   - "Generate link" button: builds URL from current selection, displays with copy button
   - "Preview client view" button: opens client mode in new tab

3. **Filters bar**:
   - Type dropdown: All / Core / Non-core / M365 / Sector / Checked only
   - Category dropdown: All / [each category from data]
   - Search input: filters across name, category, description, alternatives, training

4. **Stats bar**: Selected count | Total value equivalent | Showing count

5. **Legend**: Colour key for four types

6. **Tools table**:

| Column | Content |
|--------|---------|
| ✓ | Checkbox |
| Tool | Name (bold) + favicon(s) + URL(s) |
| Category | Category label |
| Type | Coloured badge (CORE / NON-CORE / M365 / SECTOR) |
| Description | What the tool does |
| Alternatives | Names as links with favicons (see §8 for where favicons render) |
| Training | Resource names as links |
| Value | `~£X/yr` |
| Include When | Curator guidance |

Row background matches type. Hidden rows use `display: none`.

7. **Action buttons**:
   - "Copy selected → tab-separated" (pastes into Word/Excel as 3-column table: Tool / Description / Value)
   - "Select all CORE"
   - "Select all visible"
   - "Deselect all"

### Copy output format

Tab-separated, three columns. Designed to paste directly into a Word table or spreadsheet:

```
Tool / Resource\tWhat It Does\tValue Equivalent
Claude Free / ChatGPT Free / Gemini (claude.ai)\t[description] Alternatives: [alts] Training: [training]\t~£200/yr
...
TOTAL FREE VALUE\t15 tools available at zero cost\t~£2,896/yr
```

---

## 7. Client Mode Specification

### Layout

1. **Header**:
   - Logo (SVG, left)
   - Title: "Your Free Software Stack"
   - Subtitle: "Prepared for [client name]"
   - Date (auto-generated)
   - Context line: "Free tools selected for your business. Every tool includes alternatives and training resources to get started."

2. **Summary bar**:
   - Tool count
   - Total annual value equivalent (green, prominent)

3. **Tool cards**, grouped by category:

   Category section headers (e.g. "AI Assistants", "Security").

   Each card:
   ```
   ┌────────────────────────────────────────────────────────┐
   │ [favicon] Tool Name                       ~£200/yr     │
   │ claude.ai · chatgpt.com · gemini.google.com            │
   │                                                        │
   │ Description text, 1-3 sentences.                       │
   │                                                        │
   │ ALTERNATIVES                                           │
   │ [favicon] Claude  [favicon] ChatGPT  [favicon] Gemini  │
   │ [favicon] Copilot  [favicon] Perplexity                │
   │                                                        │
   │ GET STARTED                                            │
   │ [favicon] Anthropic Prompt Guide                       │
   │ [favicon] OpenAI Academy                               │
   │ [favicon] YouTube: AI for small business               │
   └────────────────────────────────────────────────────────┘
   ```

   Everything clickable. Alternatives and training are `<a>` tags opening in new tabs.

4. **Footer**: "Curated by Kaipability Ltd" + logo + link.

### Client mode design principles

- **Mobile-first.** Most recipients open this on a phone. Cards stack vertically. Touch targets are generous.
- **Read-only.** No controls, no checkboxes, no filters. This is a deliverable, not a tool.
- **Branded.** The Kaipability design system: cream paper, oxblood accent, Sonny Gothic body with Galano Grotesque headings, flat editorial surfaces. Professional, not templated.
- **Everything links.** Every URL, alternative, and training resource is a live clickable link with `target="_blank" rel="noopener noreferrer"`.
- **Print-friendly.** `@media print`: URLs shown after link text, cards don't break across pages, summary bar simplified.

### Security (both modes)

All text originating from URL parameters (`client`) or from `tools.json` must be inserted into the DOM via `textContent`, or passed through an HTML-escaping helper before any `innerHTML` use. URLs from data are only ever set as attribute values (`href`, `src`), never concatenated into markup strings. Acceptance test: `?client=<img src=x onerror=alert(1)>` renders as literal text in the header.

---

## 8. Favicons

Every product link, alternative link, and training link displays a 16×16 favicon beside the text.

### Source

DuckDuckGo favicon proxy (preferred):
```
https://icons.duckduckgo.com/ip3/{domain}.ico
```

Fallback (Google):
```
https://www.google.com/s2/favicons?domain={domain}&sz=16
```

### Domain extraction

For tool URLs: `domain` field in `urls[]` provides this directly.
For alternatives/training: extract at render time:
```javascript
function getDomain(url) {
  try { return new URL(url).hostname.replace('www.', ''); }
  catch { return ''; }
}
```

### Rendering

```html
<img src="https://icons.duckduckgo.com/ip3/canva.com.ico"
     width="16" height="16" alt="" loading="lazy" class="favicon"
     data-domain="canva.com">
```

A single delegated `error` listener implements the fallback chain: on first failure swap `src` to the Google URL for the same domain, on second failure hide the image. This makes the §8 fallback real rather than aspirational. `loading="lazy"` because 85 tools × multiple links = many favicon requests. `alt=""` because favicons are decorative.

### Where favicons appear

| Location | Favicon? |
|----------|----------|
| Curator table: tool name URLs | Yes |
| Curator table: alternatives | No (too dense, plain text links) |
| Curator table: training | No |
| Client cards: tool URLs | Yes |
| Client cards: alternative links | Yes |
| Client cards: training links | Yes |

Curator mode keeps the table scannable. Client mode has room for visual richness.

---

## 9. Deployment

### `netlify.toml`

```toml
[build]
  publish = "."

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

### Steps

1. Push repo to GitHub
2. Connect to Netlify
3. Custom domain optional (e.g. `freestack.kaipability.com`)
4. Every push to `main` auto-deploys

No build step. Static files served directly.

---

## 10. Content Rules

### No vendor bias

Every tool lists at least 2 alternatives. Open-source and self-hosted options included where they exist. The only exception is a statutory body with no substitute (e.g. the ICO is the UK's only data protection regulator). This is a directory, not a referral engine.

### Honest value equivalents

The `value` field represents what you would genuinely pay for a commercial alternative. Not the price of the tool's own paid tier. Not an inflated number to make the total look impressive. The total must survive a sceptical reader. If HubSpot CRM Free saves you from buying a CRM, the value is what a comparable CRM costs. If Google Password Checkup is just a checkbox, the value is £0.

### No em dashes

House style. Use commas, full stops, or colons. En dashes for ranges (£800-1,500) are fine.

### Descriptions are for end users

Not for consultants, not for SEO. Write as if explaining to a smart person who has never heard of the tool. What does it do? Why would they care? One to three sentences, no jargon, no filler.

---

## 11. Styling

**Source of truth: `design-system/`**: the Kaipability brand system (v1.3; this section's original provisional palette of Source Sans 3 and `#c0392b` is superseded, recorded in the BUILD-PLAN changelog).

`css/styles.css` imports `design-system/colors_and_type.css` (tokens, self-hosted fonts, base type) and adds the app layer on top. Rules that bind:

- **Surfaces:** warm cream paper (`--paper` `#F4F1EA`), two-tone variation via `--paper-2`, hairline rules on `--paper-edge`. Flat: no gradients, shadows only on overlays.
- **Accent:** oxblood (`--oxblood` `#A40000`) for primary buttons, rules, eyebrows, link hover. One accent only.
- **Type:** Sonny Gothic (body), Galano Grotesque Medium (headings, labels, buttons), Sonny Gothic UltraBlack (display moments: client-mode hero, summary numbers). Self-hosted from `design-system/fonts/`, no Google Fonts.
- **Corners:** square by default; 2px inputs, 4px buttons/cards. Pills only for status chips in data tables (the type badges qualify).
- **Tool types** map to the semantic palette: core → sage (`--positive`), noncore → aged amber (`--caution`), m365 → slate (`--info`), sector → lavender. Badge text colours are darkened variants holding 4.5:1 on their tints.
- **Logos:** `design-system/assets/kaipability-logo-lockup.png` in headers/footer, `kaipability-mark.png` as favicon.
- **House-style note:** the brand brief endorses em dashes for Kaipability marketing copy; this product's §10 no-em-dash rule still governs `tools.json` content, which is written for end clients.

### Responsive

| Breakpoint | Behaviour |
|-----------|-----------|
| >1200px | Full table, 2-col cards |
| 768-1200px | Horizontal scroll table, 1-col cards |
| <768px | Compact, stacked controls, full-width cards |

---

## 12. Accessibility

- Keyboard-accessible: all checkboxes, buttons, links
- Colour + text labels (badges say "CORE", not just green)
- Favicons: `alt=""` (decorative)
- Client cards: `<article>` elements
- External links: `rel="noopener noreferrer"`
- Contrast: 4.5:1 minimum on all text
- Focus indicators visible on all interactive elements

---

## 13. Future Considerations (out of scope for v1.0)

- **Curator authentication**: simple token-based admin toggle if public access to curator mode becomes a concern
- **Tool freshness tracking**: `last_verified` date field per tool for maintenance
- **PDF export**: "Download as PDF" in client mode (browser print-to-PDF works for now)
- **Analytics**: Plausible or Fathom on client page opens
- **API endpoint**: serve `tools.json` as a public API for other tools to consume
- **Category icons**: small SVG icons beside category headers in client mode
- **Embed mode**: `?embed=true` strips header/footer for iframe embedding in reports
- **Tool submission**: public form for suggesting new tools (moderated by curator)
- **Multi-curator**: different curators with their own branding (white-label)

---

## 14. Definition of Done

1. `index.html` loads curator mode with all tools from `tools.json`
2. Filters, search, and type toggles work correctly
3. Selecting tools and clicking "Generate link" produces a valid client URL
4. Opening the client URL renders only the selected tools in card layout
5. Client mode is readable at 375px viewport width
6. Favicons load beside links (graceful fallback on failure)
7. "Copy → tab-separated" produces clean paste into Word
8. All alternative and training links are clickable in client mode
9. Deployed to Netlify, accessible at configured domain
10. `README.md` documents: adding a tool, editing a tool, URL schema, deploy

---

## 15. Data

The companion `tools.json` was calibrated from real-world consulting engagements across approximately 30 small business digital audits, then extended. As of 23 July 2026 it holds 98 entries, of which 89 are active and 9 are archived per the §4 retirement rule (grant bodies, support programmes and government or regulatory guidance removed from circulation without breaking old client links). The active set covers:

- 12 core tools (recommended for virtually every small business)
- 59 non-core tools (situation-dependent), including the Developer & Web set added in Phase 8
- 7 Microsoft 365 included tools
- 11 sector-specific tools

15 active categories spanning AI, design, video, analytics, SEO, security, finance, CRM, marketing, e-commerce, business operations and developer infrastructure. The Grants & Business Support category holds only archived entries and no longer appears in the interface.

When converting or extending the dataset, ensure every entry has: at least 2 alternatives with full URLs, at least 2 training resources with full URLs, a `domain` field in every `urls[]` entry for favicon resolution, and no em dashes in any text field.

---

## 16. Public Homepage

The root path `/` remains the public, read-only, indexable directory established in Phase 10.12, redesigned for the first-time visitor. Two jobs, in order: earn trust in the first screenful, then offer three ways in. The Phase 10.12 "one CTA" description is superseded by the entry paths below; everything else from that decision (read-only, indexable, no summary bar, no cost chart, curator stays at `/x`) still binds.

### Layout: compact landing

This layout supersedes the Phase 12 homepage layout and its viewport ordering, which measured roughly 92,000px tall at 375px with no tool visible at the fold. The fix is collapse, never removal: **every active tool's card is built and attached to the DOM at load, exactly as before.** Top to bottom, one order at every viewport:

1. **Hero**, tightened but unchanged in content: logo, title, strapline, the three verifiable trust signals (runtime tool count, no-affiliates line, curator identity).
2. **Ways-in band**, replacing the three equal entry cards:
   - **Search, promoted to first-class**: the existing search input moves here, full width below 768px, placeholder count-bearing ("Search 89 tools: invoicing, design, CRM…", count computed at runtime, never hard-coded).
   - **Discover entry**: button plus one-line pitch, behaviour unchanged (§17).
   - **Persona chips**: behaviour unchanged.
   - The "Browse all" entry card is retired; its job passes to the shelves plus an **Expand all / Collapse all** toggle on the shelf-band header.
3. **Discover mount and changelog strip**, as today.
4. **Category shelves**: one `section` per category. Each collapsed shelf is a single row whose header is a real `<button>` (44px minimum) carrying the category icon, name, count ("AI Assistants · 6 tools"), a muted one-line scent of tool names truncated with an ellipsis, and a chevron. `aria-expanded` on the button, `aria-controls` naming the grid. Expanding reveals that category's full card grid.
5. **FAQ section**: the section 18 question-led content, as native `<details>`/`<summary>` items in the changelog strip's visual language. `<details>` content is in the DOM whether open or not.
6. **Footer**, unchanged and now reachable.

### Shelf mechanics

- Collapse is CSS only (`display: none` on the closed grid). Nothing is lazily fetched, deferred or removed; the rendered DOM is a superset of the previous layout's.
- The card renderer (`js/client.js`) is untouched; the shelf wrapper is applied around its output.
- **Search**: filtering force-opens every shelf containing a match, hides shelves with none, and shows a "N tools match" line. Clearing restores the collapsed state. Persona chips use the same mechanic.
- **Expand all / Collapse all** round-trips, so no capability against the old layout is lost.
- **Deep links**: `#cat-<slug>` opens and scrolls to its shelf. The `?tool=ID` permalink is unchanged.
- Shelf open state is transient per page load: no persistence, no new storage keys.
- Tool id 0 must survive search, shelf grouping and judgement parity; the section 4 id laws apply throughout.

### Page height budgets

With all shelves collapsed, total page height is at most **3,200px at 375px wide** and **2,200px at 1280px wide**, with the search input visible within the first mobile viewport and the first shelf header's top at most **880px at 375x812**. These are acceptance numbers. (The original clause asked for the first shelf rows inside the 812px viewport itself; the mandated hero trust signals and the ways-in band honestly occupy most of the first screen, and the reconciled 880px budget, measured 863px as built, puts the shelves one thumb-flick away rather than one full screen. Recorded in the BUILD-PLAN changelog.)

### Grid quick-judge and list parity

Judgement state (§17) is not deck-private. On the browse list:

- A judged tool's card carries a state chip ("Got it" or "On my list"), which is a button. Activating it opens a small chooser: Got it / Add to my list / Clear. This works on every device and is the single edit path for judgements outside the deck.
- On hover-capable, fine-pointer devices only (`@media (hover: hover) and (pointer: fine)`), unjudged cards additionally show two corner quick-judge buttons ("Got it", "Try it") on hover and on focus-within, so a desktop visitor can judge from the grid without opening the deck.
- Every judgement control is a real button, minimum 44px target, and writes the same §17 persistence record the deck writes. Deck and list never disagree after a repaint.

### Motion inventory

This list is exhaustive. Any motion not named here is banned on the public surface: no parallax, no looping or ambient motion, no scroll-linked effects, no autoplaying anything. The budget moves from unseen entrances to user-initiated responses. Two tokens land in `design-system/colors_and_type.css`:

```css
--ease-swift:  cubic-bezier(0.22, 1, 0.36, 1);    /* entrances and responses */
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1); /* small elements under ~200px only */
```

`--ease-swift` is the entrance and response curve; the calm `--ease-out` stays for colour and border micro-transitions; `--ease-spring` never applies to any element larger than roughly 200px.

1. **First-paint stagger, hero and ways-in band**: `translateY(18px)` to 0 with fade, 480ms, `--ease-swift`, 80ms per item, capped at the first screenful. Reduced motion: opacity only, no stagger.
2. **Shelf expansion stagger** (the showpiece): on shelf open (header, Expand all, or search/persona auto-open), cards fade and travel `translateY(14px)` to 0, 300ms, `--ease-swift`, 45ms stagger capped at the first six cards; later cards appear settled. Reduced motion: opacity only, 120ms, no stagger, no translate.
3. **View Transitions on filter and expand-all** (progressive enhancement, no polyfill): the filter redraw and the expand/collapse-all toggle run inside `document.startViewTransition()` only when the function exists and reduced motion is off; otherwise the callback runs directly, keeping today's hard cut. Debounced so only settled keystrokes transition.
4. **Deck-open morph**: the Discover entry carries `view-transition-name: discover-panel` before mount; inside the guarded transition the panel takes the same name, so the entry morphs into the deck. `::view-transition-group(discover-panel)` runs 380ms on `--ease-swift`. Focus moves into the panel after the transition's `finished` promise. Fallback (no support, or reduced motion): today's mount and scroll, unchanged.
5. **Judged-chip pop**: only a fresh judgement (the setDecision path, never load-time redecoration) marks the chip `.is-new`, keyframed `scale(0.85)` to 1 with fade, 220ms, `--ease-spring`, `transform-origin` left. Reduced motion: instant.
6. **Theme-toggle cross-fade**: the theme attribute swap runs in the same guarded View Transition helper, giving a roughly 250ms full-page cross-fade. Unsupported or reduced motion: instant swap as today.
7. **Hover lift and focus**: cards lift `translateY(-3px)` with a border-colour shift to oxblood, 180ms, `--ease-swift`, hover-capable devices only. Site-wide `:focus-visible`: 2px oxblood outline, 2px offset, zero duration (focus never lags). Reduced motion: colour change only, no translate.

Deck card physics (§17) and the client-mode motion (Phase 7.6) stay in force alongside this inventory, unchanged.

Implementation constraints: CSS transitions, CSS transforms and the browser-native View Transitions API only, always feature-detected; no `requestAnimationFrame` animation loop; no animation library. Under `prefers-reduced-motion: reduce`, every item above degrades to an instant or opacity-only change: no translation, no rotation, no scale, no stagger, no view transition.

### Platform and security

- No new inline scripts in `index.html` or `embed.html`. The deck ships as an external module (`js/discover.js`) so the `netlify.toml` CSP hash set does not change. If an inline script ever becomes unavoidable, its hash lands in `netlify.toml` in the same commit with a changelog row.
- All strings from `tools.json` and all user-visible state render through the existing `el()`/`textContent` discipline. Nothing is concatenated into HTML.
- The homepage stays indexable: no robots meta at `/`. The deck module loads separately and its failure is tolerated the way `data/changelog.json` failure already is: the browse list must render even if `js/discover.js` never arrives.
- External links keep `target="_blank" rel="noopener noreferrer"`.

### Acceptance criteria

1. The hero tool count equals the active (non-archived) entry count of the deployed `tools.json`, computed at runtime.
2. All three entry paths are present and functional; a persona chip seeds a deck with that pack's ids.
3. Below 768px the deck entry renders before the browse list; at 768px and above the list leads and the deck opens inline from the Discover path, with correct focus handling on open and Escape.
4. A judgement made in the deck appears as a chip on the corresponding browse card, and clearing it from the chip chooser removes it from the deck's persistence record. Tool id 0 round-trips through this parity.
5. Corner quick-judge buttons appear only under `(hover: hover) and (pointer: fine)`; the chip chooser works everywhere; all judgement targets are 44px minimum.
6. With `prefers-reduced-motion: reduce`, no element translates or rotates: reveals and card exits are opacity-only.
7. `js/discover.js` blocked or missing leaves the directory fully browsable with no console-error cascade.
8. No inline script is added; the CSP hash set in `netlify.toml` is byte-identical before and after the phase (or a changelog row records the exception).
9. Both themes, 375px with no horizontal scroll, and house style (no em dashes, British English) hold across all new copy.

---

## 17. Discover Deck

A short card deck for judging tools one at a time. Swipe or press left for **"Got it"** (I already use this), right for **"Add to my list"** (I want to try it). Judgements persist on the device, so a returning visitor never re-judges a tool. The got-it list later prefills My Stack; the try-it list feeds the sign-up to-do generator (PRD-REGISTER §18-19).

### Deck composition

- A deck deals **10 to 12 cards** and always ends: a progress counter ("4 of 12") and a completion card are part of every deck. Never infinite.
- Seeding, in priority order: a chosen persona pack (`data/presets.json` ids, filtered to active and unjudged), a chosen category, otherwise the default mix (unjudged core tools first, then unjudged tools spread across categories).
- Only active tools are dealt. Only "new to you" ids (not in `seenIds`, below) are dealt, unless the visitor explicitly chooses to review judged tools again.
- Fewer than 10 eligible ids: deal what remains. Zero: the entry point says so and offers review or browse instead of an empty deck.
- The completion card summarises the counts ("3 got it, 4 on your list, 5 skipped"), and offers: **Open these in My Stack** (hand-off below), **Another deck**, and **Browse all**.

### Card content

Name, favicon (§8 rules), category, description (`plain` when Plain English mode is on and the tool has one), and the `free_limit` line when present. A card is never itself a link: a tap must never navigate mid-deck. A quiet "More" link may open the single-tool permalink `?tool=ID` in a new tab under the standard link rules.

### Controls

Buttons and keyboard are the primary controls; the gesture is an enhancement (WCAG 2.5.7: no function may require dragging).

- **Buttons**, always visible beneath the card, 44px minimum: "Got it", "Skip", "Add to my list". **Skip is button-only**: no gesture maps to it, so an accidental drag can never silently discard a card.
- **Keyboard**, while focus is within the deck: Left arrow = got it, Right arrow = add to my list, Backspace = undo, Escape = close the deck and return focus to the opener. Skip is reached as an ordinary button (Tab, then Enter or Space).
- **Gesture** (pointer events, mouse and touch alike): the card container sets `touch-action: pan-y` so vertical page scroll always survives. A drag begins only after 10px of slop. A release commits the judgement when horizontal travel reaches 100px or 35% of the card width, whichever is smaller, or when release velocity reaches 0.5px/ms (a fling). Below threshold, the card snaps back and nothing is recorded.

### Card physics

CSS transforms only, set directly in the `pointermove` handler; no `requestAnimationFrame` loop, no library. Rotation of roughly 1 degree per 20px of horizontal travel, `transform-origin` bottom centre. Release animations (snap back, fly off) are CSS transitions. Under reduced motion, exits and returns are instant opacity changes with no travel.

### Undo and announcements

- **Single-level undo** (Backspace or the Undo button): the most recent card animates back onto the deck and its decision record is reversed, including its `seenIds` entry. One level only; undo of an undo redoes nothing.
- An `aria-live="polite"` region announces each judgement and position: "Canva: added to your list. 5 of 12." The progress counter is text, not colour or position alone.

### Persistence

One localStorage key: **`freestack:v1:discover`**. Shape:

```json
{
  "v": 1,
  "lastVisit": "2026-07-26T10:00:00.000Z",
  "seenIds": [0, 2, 5],
  "decisions": {
    "0": { "d": "have", "t": 1784023200000 },
    "2": { "d": "want", "t": 1784023230000 },
    "5": { "d": "skip", "t": 1784023260000 }
  }
}
```

- `d` is one of `have` (got it), `want` (add to my list), `skip`. `t` is epoch milliseconds. `decisions` keys are decimal id strings; **`"0"` is a valid key and tool 0 must survive every read and write**. Parse ids with `Number.parseInt` and validate with `Number.isInteger` against the catalogue; never a truthiness test, never `.filter(Boolean)`.
- Unknown `v`: discard and start fresh. This key is a device-local working copy of low-stakes preferences, not a register; losing it costs re-judging, nothing more, and the copy must never claim otherwise (approved phrasing at most: "saved on this device"; §the register storage laws' ban on "safe" claims applies to all copy).
- Storage unavailable (private mode, webview): the deck still deals and judges in memory for the session; nothing persists and no error is shown beyond honest wording if persistence is mentioned at all.
- This key belongs to the public surface and is deliberately **outside `js/my/store.js`**, whose single-choke-point law governs `/my` persistence only. **No `/my` module may read this key.** The hand-off to My Stack travels entirely in the URL (below), keeping `store.js` the only storage-touching module on its surface.

### New to you

"New to you" means an active tool id absent from `seenIds`. No schema change: it is a set difference computed at render. Entry points may show the count ("31 tools you have not judged"). Archived tools are never counted and never dealt.

### Hand-off: Open these in My Stack

The completion card (and any equivalent affordance built from stored judgements) builds:

```
/my?from=<want-ids>&have=<have-ids>
```

- Both parameters use the `?t=` grammar: comma-separated integer ids, optional `t:` prefix accepted, parsed by the shared `parseSelection` (id 0 valid, duplicates and unknown ids dropped silently).
- `from=` carries the **want** list; `have=` carries the **got-it** list. `skip` decisions never travel in the URL.
- **Discover always emits the `have=` parameter when it emits this URL, even with an empty value** (`have=` with no ids). Its presence marks the arrival as a Discover hand-off, which is what tells the workspace to default the `from=` group to `planned` status (PRD-REGISTER §19). A legacy `?from=` link without `have=` behaves exactly as before.
- Tool 0: `/my?have=0` is a complete, valid hand-off producing one got-it row.
- Length limits: a raw parameter value longer than **512 characters** is treated as absent (defensive; every active tool today fits in under 400 characters, and `parseSelection` bounds the resolved list to the active catalogue regardless). If both resolved lists are empty the button is not rendered.

### Acceptance criteria

1. A deck deals 10-12 cards, shows "n of N" progress, and ends on a completion card with correct counts. No path deals infinitely.
2. Judging by button, by keyboard and by gesture all write the same `freestack:v1:discover` record; a reload restores it; a second visit deals none of the judged ids by default.
3. Tool 0 judged left appears under key `"0"` with `d: "have"`, survives reload, and appears in the `have=` hand-off URL.
4. Skip has no gesture: no drag direction records a skip.
5. A sub-threshold drag snaps back and records nothing; drags past 100px, past 35% width on a narrow card, and a 0.5px/ms fling all commit; vertical page scroll works over the deck on touch.
6. Backspace undoes exactly the last judgement, animating the card back (instantly under reduced motion), and a second Backspace does not un-undo.
7. The `aria-live` region announces judgement and position politely; Escape closes the deck and restores focus to the opener; every control is keyboard-reachable with visible focus.
8. With localStorage blocked, a deck still deals and completes in-session without console errors.
9. "Open these in My Stack" emits `from=` and `have=` per this section, including the always-emitted `have=` marker and the 512-character cap; no `skip` id ever appears in the URL.
10. Reduced motion: no card translates or rotates at any point in the deck lifecycle.

---

## 18. Answer Engine and Search Visibility

The public directory is rendered client-side from `data/tools.json`. Googlebot renders JavaScript; the AI answer engines (GPTBot, ClaudeBot, PerplexityBot) do not, so to them the site is a title tag and a loading message. This section makes the directory exist in raw HTML, honestly and without a build step: every artefact is a committed static file generated dev-time.

### The generator: `scripts/build-seo.mjs`

A dev-time Node script, same category as `validate-data.mjs` and permitted under the same scripts/ exception to the no-Node law. It reads `data/tools.json`, `data/presets.json` and `data/category-intros.json` (a new small file of one-sentence question-led category intros, so `tools.json` stays schema-pure) and emits or refreshes: the static block in `index.html`, `faq.html`, `sitemap.xml` and `llms.txt`. Output is deterministic and diffable. It escapes every string from `tools.json` when emitting HTML (untrusted data, §7 security rules) and uses the §4 id discipline (`!== undefined`, never truthiness).

**CI drift gate**: `ci.yml` runs the generator and fails if any generated artefact differs byte-for-byte from what is committed. The committed files can therefore never go stale against `tools.json`.

### Static crawler content block in `index.html`

The generator writes real HTML between marker comments (`<!-- seo-static:start -->` / `<!-- seo-static:end -->`) inside `<div id="static-root">`: hero copy, the trust lines (live tool count, the no-affiliates line verbatim, curator identity), each category as an `<h2>` with its question-led intro and a plain list of tool names with one-sentence descriptions and free-limit summaries, and a link to `/faq.html`. Public-directory content only: nothing from `/x`, `/my` or client mode.

`js/data-loader.js` hides `#static-root` when an app surface mounts, so JS users see exactly the rendered page. Non-JS crawlers and noscript readers get the full directory as text, and a fetch failure now leaves readable content instead of a blank page.

### Static `/faq.html`

A real, indexable HTML page (the `why-register.html` mould, minus the noindex) containing the ten Q&As below as visible `<h2>`/`<p>` content, linked from the footer and the static block, carrying matching FAQPage JSON-LD. **The following copy is canonical.** Free-limit and value figures derive from `tools.json` as of 30 July 2026; the generator keeps figure-bearing sentences synchronised so they cannot drift.

**Q1. What software stack is free for a new founder?**
A genuinely free day-one stack: a free AI assistant (Claude, ChatGPT or Gemini), Canva Free for design, Unsplash or Pexels for images, Google Business Profile so customers can find you, WhatsApp Business for customer contact, Bitwarden Free as a password manager and Google Drive for files. All are free tiers with published limits, not trials. This directory lists each one with its real limits and alternatives.

**Q2. What is the best free accounting software for a UK small business?**
Two credible options. Wave Accounting is free indefinitely for invoicing and manual bookkeeping, though automatic bank feeds sit in its paid tier. FreeAgent, a full UK accounting package, is free while you hold an active Mettle or NatWest business account. Which suits you depends on your bank; both are listed here with their exact free-tier edges.

**Q3. How much would this software cost if I paid for it?**
The 89 active tools in this directory represent roughly £11,600 a year in commercial-equivalent value. That figure is deliberately conservative: it is what you would pay a commercial provider for the same capability, never the tool's own paid-tier price, and never inflated. Every tool shows its individual value and a last-verified date so you can challenge the numbers.

**Q4. Is there a free CRM good enough for a small business?**
Yes. HubSpot CRM Free supports up to 2 users and around 1,000 contacts, free forever, with HubSpot branding on some assets. Zoho's free ecosystem gives a CRM for up to 3 users plus free booking, invoicing and forms tools. Both limits are real edges you should know before committing, and both entries here list alternatives.

**Q5. What free email marketing tools actually work?**
MailerLite Free gives 250 subscribers and 2,500 emails a month, the most generous mainstream free tier. Mailchimp Free allows 250 contacts and 500 emails a month, and Brevo takes a different approach with daily send limits. For a small list, any of the three does the job; the caps above are where each one starts charging.

**Q6. What can I use instead of Photoshop for free?**
GIMP is free, open source and permanently free with no paid tier. Photopea runs a Photoshop-like editor in the browser, free with ads, and opens PSD files. For template-based design rather than photo editing, Canva Free and Adobe Express Free cover most small-business needs. None of these is a trial; all are listed here with their limits.

**Q7. Do these free tools stay free, or is there a catch?**
Every entry states in plain English what the free tier genuinely includes and exactly where it stops: the user limit, the storage cap or the feature gate. Each tool carries a last-verified date. When a tool stops being free or stops being good, it is archived and marked as no longer recommended, pointing at its alternatives, never silently deleted.

**Q8. Does this directory earn commission on the tools it lists?**
No. There are no affiliate links, no sponsorships and no paid placements anywhere in this directory. Every link pays Kaipability nothing when you click it or sign up, and removing a tool costs nothing either. Tools are listed on merit, used on real client work, and every one carries at least two alternatives so you are never funnelled to a single vendor.

**Q9. What free tools help a local shop get found online?**
Start with Google Business Profile, free forever and the single biggest factor in local search visibility. Add Bing Places for Business, Meta Business Suite for managing Facebook and Instagram, and WhatsApp Business for customer messaging. All four are permanently free products, not trials, and each is listed here with setup training links.

**Q10. What free security tools should a small business start with?**
Bitwarden Free gives unlimited passwords across unlimited devices, including a free two-person sharing option. Have I Been Pwned checks whether your email addresses appear in known data breaches, free for individual lookups. Google Password Checkup flags reused or compromised passwords at no cost. These three cover the basics before you spend anything on security.

### Per-tool questions (Rocky's 30 Jul direction: every tool carries one)

Every active tool gets a question-shaped entry, because "Is [tool] free for a small business?" is the exact phrasing people and answer engines use, 89 times over, and the honest answers already exist in the dataset. Rules:

- **Derived at generation time, never hand-maintained by default.** `scripts/build-seo.mjs` composes each tool's question and answer mechanically from existing fields: the question from the tool's name ("Is Canva Free actually free for a small business?" pattern, with sensible variants for grouped names), the answer assembled from `free_limit` (verbatim where present), `description`, `paid_from` ("paid plans from £N/month") and up to two alternatives by name. Answers aim for 40-80 words with hard bounds of 30-100 (source fields vary in length and truncating verbatim free_limit text to hit a cosmetic target would cost honesty; the smoke suite enforces the hard bounds), standing alone, section 10 honesty throughout. A tool without `free_limit` gets the description-led variant, never an invented claim.
- **An optional hand-written override may be added to the schema later** (an `faq` field, section 4) if generated phrasing reads awkwardly for specific tools; until then generation keeps maintenance at zero, the same bet as the rest of the site.
- **Where it surfaces.** (1) In each tool's entry inside the static crawler content block, as a heading-and-paragraph pair, so non-JS crawlers get the question-led text. (2) On the `?tool=` permalink view, rendered visibly to humans in the same words, keeping parity between what engines read and what people see. (3) NOT in the FAQPage JSON-LD: an 89-item FAQPage is spam-shaped; the ten site-level questions remain the only FAQPage payload, and per-tool questions live as ordinary marked-up text.
- The drift gate covers these like everything else the generator emits: regenerating against the current `tools.json` must be byte-identical to what is committed.

### Title and meta description

The generator maintains these in `index.html`, keeping the count live:

- Title: `Free software for UK small businesses: 89 curated tools | Free Stack by Kaipability`
- Meta description: `A free, curated directory of 89 genuinely free software tools for UK small businesses: accounting, CRM, design, marketing and security. No affiliate links, no sponsors. Every tool lists its real free-tier limits and alternatives.`

The OG tags are unchanged: they serve the shared client link, a different audience.

### `sitemap.xml`, `robots.txt`, `llms.txt`

- `sitemap.xml` lists `/`, `/faq.html`, and `/how-we-choose.html` once published. It deliberately excludes `/my`, `/x`, `/embed.html`, `/why-register.html` and every parameterised URL.
- `robots.txt` gains one line: `Sitemap: https://tools.airl.io/sitemap.xml`. Nothing is disallowed; a disallow line for `/x` would advertise the path (Phase 10.12 law).
- `llms.txt`: a short markdown file describing the site and its trust rules, pointing at `/data/tools.json` (the full machine-readable dataset), `/faq.html` and, once live, `/how-we-choose.html`. Honest assessment, recorded so nobody oversells it later: crawler pickup is thin and Google does not support it; it ships because the payload already exists and costs near zero. A cheap bet, not a strategy.

### JSON-LD

Injected statically by the generator, never at runtime (AI crawlers would not see runtime injection):

- `index.html` head: `Organization` (Kaipability Ltd), `WebSite` (Free Stack, tools.airl.io) and an `ItemList` of active tools (name, description), mirroring the visible static block.
- `faq.html`: `FAQPage` built from the same source strings as the visible copy, so markup and page text can never disagree.

Honest note: Google retired FAQ rich results in May 2026 and its ItemList carousel never covered software directories, so **no Google SERP feature is expected from any of this markup**. The consumers are Bingbot, PerplexityBot and RAG crawlers, for whom valid schema.org vocabulary is entity clarity; Google confirms leaving FAQPage in place causes no harm. The visible text is the asset, the markup a low-cost mirror.

### Smoke-gate exclusion for JSON-LD

`scripts/smoke-test.mjs`'s CSP hash-drift gate hashes every inline `<script>` without `src=` and requires it in the `netlify.toml` allow-list; a JSON-LD block would trip it. The gate's `extractInlineScripts` therefore skips `type="application/ld+json"`. This is legitimate, not a loosening: CSP treats such blocks as non-executable data blocks, `script-src` never applies to them, so there is no hash to allow-list and nothing for the gate to protect. The exclusion carries a comment citing this reasoning and a changelog row.

### Noindex boundaries (must not move)

`/x`, client-mode links and `/my` keep their JS-injected noindex exactly as now; `why-register.html` keeps its static noindex; the `/docs/*` and root `.md` 404 rules stay. The static block and sitemap expose public-directory content only. Nothing in this section may weaken any of these.

### Acceptance criteria

1. `curl` of the deployed `/` (no JavaScript) returns HTML containing every active tool's name, the category headings, the trust lines and a link to `/faq.html`.
2. With JavaScript on, `#static-root` is hidden once the app mounts and the rendered page is visually identical to a build without the block; with fetch blocked, the static content remains readable.
3. `/faq.html` serves the ten canonical Q&As as visible text, indexable, with FAQPage JSON-LD whose strings match the visible copy exactly.
4. `sitemap.xml` lists only `/`, `/faq.html` and (once published) `/how-we-choose.html`; `robots.txt` carries the Sitemap line and no disallow for `/x`.
5. Running `scripts/build-seo.mjs` twice produces byte-identical output; CI fails on any drift between generated artefacts and `tools.json`.
6. The title and meta description carry the live active count; the OG tag set is unchanged.
7. The smoke suite passes with JSON-LD present: the hash gate skips `application/ld+json` and still fails on any executable inline script missing from the CSP.
8. All noindex boundaries above verified unchanged on the Deploy Preview.
9. All generated copy holds house style: British English, no em dashes, honesty rules of §10, no Cyber Essentials claims.
