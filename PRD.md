# Free Stack: Product Requirements Document

**Project:** `free-stack`
**Owner:** Kaipability Ltd (Rocky Verma)
**Version:** 1.1
**Date:** 22 July 2026 (v1.0: 14 July 2026)
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
├── assets/
│   └── logo.svg            # Kaipability logo for branding
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

**Every entry in `alternatives` and `training` must carry a live URL.** Both render as `<a href>` tags, so an entry with an empty `url` becomes a dead link on a page a client opens. Anything that is a caveat rather than a destination belongs in `notes`. The minimums above count linkable entries only, not raw array length.

Validate with `node scripts/validate-data.mjs`, which enforces this section and exits non-zero on any violation.

### Types

| Type | Meaning | Badge colour | Default state |
|------|---------|-------------|---------------|
| `core` | Recommend for virtually every small business | Green `#d4edda` | Pre-checked |
| `noncore` | Depends on client need | Yellow `#fff3cd` | Unchecked |
| `m365` | Only relevant if client has Microsoft 365 | Blue `#cce5ff` | Unchecked |
| `sector` | Industry-specific | Purple `#f0e6ff` | Unchecked |

### Categories (initial set, expandable)

AI Assistants, Analytics & SEO, Business Operations, Business Support, Cloud & Docs, Communication, CRM, Design & Creative, E-commerce, Email Marketing, Finance, Grants & Programmes, Image & Stock, Image Utilities, Learning, Local SEO, Market Research, Publishing, Sector Specific, Security, Security & Compliance, Social Media, Video & Audio

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
- **Branded.** Kaipability red accent, Source Sans 3. Professional, not templated.
- **Everything links.** Every URL, alternative, and training resource is a live clickable link with `target="_blank" rel="noopener noreferrer"`.
- **Print-friendly.** `@media print`: URLs shown after link text, cards don't break across pages, summary bar simplified.

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
     width="16" height="16" alt=""
     loading="lazy"
     style="vertical-align: middle; margin-right: 4px;"
     onerror="this.style.display='none'">
```

`onerror` hides the image on failure. `loading="lazy"` because 85 tools × multiple links = many favicon requests. `alt=""` because favicons are decorative.

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

### Fonts

- **Primary:** Source Sans 3 via Google Fonts, fallback Source Sans Pro, system sans-serif
- **Monospace:** system stack (URLs, code)

### Colour tokens

| Token | Hex | Usage |
|-------|-----|-------|
| `--brand` | `#c0392b` | Accent, headers, borders |
| `--brand-dark` | `#a93226` | Hover |
| `--nav` | `#2c3e50` | Table headers, secondary buttons |
| `--success` | `#2d7d46` | Value totals, toast |
| `--core-bg` | `#d4edda` | Core badge/row |
| `--core-fg` | `#155724` | Core text |
| `--noncore-bg` | `#fff3cd` | Non-core badge/row |
| `--noncore-fg` | `#856404` | Non-core text |
| `--m365-bg` | `#cce5ff` | M365 badge/row |
| `--m365-fg` | `#004085` | M365 text |
| `--sector-bg` | `#f0e6ff` | Sector badge/row |
| `--sector-fg` | `#4a148c` | Sector text |
| `--bg` | `#f7f7f5` | Page background |
| `--card` | `#ffffff` | Card/table fill |
| `--border` | `#e0e0e0` | Card borders |
| `--text` | `#1a1a1a` | Body |
| `--text-2` | `#666666` | Secondary |
| `--text-3` | `#888888` | Muted/labels |
| `--link` | `#2980b9` | Links |

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

The companion `tools.json` contains the initial dataset of 85 tools, structured per §4. This was calibrated from real-world consulting engagements across approximately 30 small business digital audits. The dataset covers:

- 15 core tools (recommended for virtually every small business)
- 50 non-core tools (situation-dependent)
- 7 Microsoft 365 included tools
- 13 sector-specific tools

23 categories spanning AI, design, video, analytics, SEO, security, finance, CRM, marketing, e-commerce, and business operations.

When converting or extending the dataset, ensure every entry has: at least 2 alternatives with full URLs, at least 2 training resources with full URLs, a `domain` field in every `urls[]` entry for favicon resolution, and no em dashes in any text field.
