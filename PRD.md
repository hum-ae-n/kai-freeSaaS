# Free Stack: Product Requirements Document

**Project:** `free-stack`
**Owner:** Kaipability Ltd (Rocky Verma)
**Version:** 1.4
**Date:** 22 July 2026 (v1.0: 14 July 2026; v1.4: 26 July 2026)
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

### Layout

1. **Hero** (editorial, text-led, no imagery carousel, no metric inflation):
   - Title and strapline as today.
   - Three trust signals, all verifiable: the live tool count computed from the fetched `tools.json` active set (never hard-coded, never rounded up), the no-affiliates line ("No affiliates, no sponsors, no paid placement."), and the curator identity ("Curated by Kaipability Ltd" with the existing link).
   - Hero copy holds the §10 honesty bar. No superlatives the data cannot back.

2. **Entry paths**, three, equal visual weight:
   - **Discover**: starts a Discover deck (§17).
   - **Persona packs**: the five packs from `data/presets.json`, rendered as chips. Choosing one seeds a deck with that pack's ids (§17); it does not navigate away.
   - **Browse all**: jumps to the full list below.

3. **Browse list**: the existing category-grouped card directory, with judgement parity (below).

### Ordering by viewport

- **Below 768px**: condensed hero, then the Discover deck entry leading the page (the deck, or its start affordance, renders before the browse list), then the list. A phone visitor meets the deck first.
- **768px and above**: hero, entry paths, then the browse list with grid quick-judge. The deck opens on demand from the Discover entry path, as an inline panel above the list, never a modal. Focus moves into the deck on open; Escape closes it and returns focus to the opener.

### Grid quick-judge and list parity

Judgement state (§17) is not deck-private. On the browse list:

- A judged tool's card carries a state chip ("Got it" or "On my list"), which is a button. Activating it opens a small chooser: Got it / Add to my list / Clear. This works on every device and is the single edit path for judgements outside the deck.
- On hover-capable, fine-pointer devices only (`@media (hover: hover) and (pointer: fine)`), unjudged cards additionally show two corner quick-judge buttons ("Got it", "Try it") on hover and on focus-within, so a desktop visitor can judge from the grid without opening the deck.
- Every judgement control is a real button, minimum 44px target, and writes the same §17 persistence record the deck writes. Deck and list never disagree after a repaint.

### Motion inventory

This list is exhaustive. Any motion not named here is banned on the public surface (no parallax, no looping or ambient motion, no autoplaying anything):

1. Staggered first-paint reveal of the hero and entry paths, 60-80ms per item, capped at the first screenful.
2. Once-only reveals of list sections via `IntersectionObserver`, disconnecting after firing.
3. Hover lift on cards, hover-capable devices only.
4. Deck card physics per §17.
5. The existing client-mode motion (Phase 7.6) is unchanged.

Implementation constraints: CSS transitions and transforms only, driven by pointer events; no `requestAnimationFrame` animation loop; no animation library. Under `prefers-reduced-motion: reduce`, every item above degrades to instant opacity changes: no translation, no rotation, no stagger, and deck cards snap off and snap back without travel.

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
