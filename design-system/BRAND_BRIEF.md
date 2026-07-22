# Kaipability — Design System

> Senior advisory practice in advanced manufacturing.
> Manufacturing Engineers, on demand, as a service — not consultants.

---

## About the brand

**Kaipability Ltd** is a senior advisory practice founded by **Dr Rocky Verma**. The
name is a portmanteau of *kai* (改 — Japanese, "change / improvement") and *capability*.
The practice positions itself in advanced manufacturing — adjacent to **Physical AI**,
robotics, and the deployment of new manufacturing technology into industrial primes.

The audience is narrow and senior: **boards, capital allocators, technology vendors,
and industrial primes.** Not casual visitors, not job-seekers, not the curious. Every
design and copy decision serves that audience.

### What they do
- Decide whether a manufacturing capability should be **built, bought, or backed**
- Assess **Deployment Readiness** (their proprietary framing of manufacturing readiness)
- Provide **Manufacturing Engineers as a service** — on demand, hands-on
- Stay **manufacturing-technology agnostic** — vendor-neutral advice

### Preferred terminology (use these exactly, with capitalisation)
| Use this | Not this |
|---|---|
| Deployment Readiness | manufacturing readiness |
| Physical AI | AI in manufacturing, industrial AI |
| AI-native | AI-powered, AI-enabled |
| Manufacturing Engineer | engineer, MfgEng |
| Modern Industrialist | (their name for the audience) |
| Manufacturing-technology agnostic | tech-agnostic, vendor-neutral |
| Capability readiness / capability acquisition | (use both, contextually) |
| Built, bought, or backed | (always this triad, this order) |

### Sources received for this system
- `uploads/FINAL LOGO Source Sans Pro Cleaned.svg` — primary wordmark in oxblood
  (`#a40000`), with an icon mark on the left that uses an **embedded raster image**
  (it does not render outside the original file). The wordmark itself uses Source
  Sans Pro; we use the typefaces below for the rest of the system.
- `uploads/SonnyGothic-Regular.woff` — body sans
- `uploads/SonnyGothic-UltraBlack.ttf` — display weight
- `uploads/GalanoGrotesqueMedium.otf` — heading sans

No additional codebase, Figma, or screenshots were provided. This system was built
from the brand brief and the assets above. It should be considered a **v1 proposal
to iterate against**, not a documentation of an existing visual language.

---

## Content fundamentals

### Voice
Plain English. **Senior practitioner, twenty years in.** No filler. No
throat-clearing. State the thing. Two short hits often beat one long sentence.

The reader is a board member, a CFO, a CTO at a prime, a partner at a fund. They
have read every consultancy deck on the planet. Their default posture is sceptical.
Earn the next sentence.

### Casing & grammar
- Sentence case for everything except proper nouns and the preferred terms above.
- **Em-dashes are good.** Use them — like this — to land a thought.
- "We" is fine. "I" is also fine (when Dr Verma speaks personally). Both can appear
  in the same document.
- Avoid passive-voice corporate constructions. *"We will tell you"* beats
  *"it will be communicated to you."*
- Numbers under ten in words inside prose; numerals for data, money, percentages.
- UK English. *Capitalise*, *organisation*, *centre.*

### Words to cut
- "thrilled", "excited", "passionate", "journey", "solutions"
- "leverage", "synergy", "ecosystem", "best-in-class"
- "we are pleased to announce", "in today's fast-moving world"
- Any qualifier that hedges. "We will tell you whether we can help" beats "we will
  try to tell you honestly whether we might be able to potentially help."

### Closing sentences should land
> *We build capability, not dependency.*
> *Built, bought, or backed — we will tell you which.*
> *Deployment Readiness is not a slogan. It is a measurement.*
> *Manufacturing Engineers, on demand. That is the offer.*

### Examples — voice in practice

**Hero, on-brand:**
> Manufacturing Engineers on demand.
> Built, bought, or backed — we tell you which.

**The same idea, off-brand (do not write this):**
> 🚀 We're excited to partner with industry leaders to unlock manufacturing
> transformation through our innovative AI-powered advisory solutions!

**Section opener, on-brand:**
> Deployment Readiness is a measurement, not a slogan. Six gates, scored on
> evidence. You will know what is true, and you will know what is not.

### Emoji
No. Not in product, not in copy, not in deck decoration. The brand is editorial
and senior — emoji read as either consumer-app or LinkedIn-influencer, both wrong.
The single exception is the technical-character set (arrows, em-dashes, primes) used
inside copy.

---

## Visual foundations

### The vibe in one line
**A confidential memo printed on good paper.** Cream stock, oxblood ink, restrained
typography, no decoration that hasn't earned its place. Closer to *The Economist* or
a McKinsey board pack than a SaaS landing page.

### Colour
The palette is built on a **warm cream paper** (`#F4F1EA`) rather than white. White
is sterile and digital; cream signals print, archival, considered. Against the cream,
**oxblood `#A40000`** (lifted directly from the wordmark) does the heavy lifting:
links, primary buttons, eyebrows, accent rules. **Coral `#FF828C`** and **lavender
`#E3D7EC`** (both from the icon mark) appear as supporting accents — used sparingly,
mostly in data visualisation and tagging.

Industrial neutrals (graphite, steel, paper-edge) carry charts and technical
content. Semantic colours are muted and aged: sage green for positive,
aged-amber for caution, oxblood for negative.

See `colors_and_type.css` for the full token list.

### Type
Three typefaces for the body of the system, plus the brand wordmark in its own face:
- **Proxima Nova** — used only for the literal word *Kaipability* (the wordmark
  and any branded lockup). This is the Canva default for the brand. It is a
  commercial face — when not licensed in the target build, fall back through
  `Mona Sans → Montserrat → Helvetica Neue`. See `--font-brand` in the tokens.
- **Sonny Gothic Regular** — body copy, captions, UI text. A humanist sans that
  reads as careful, not cold.
- **Galano Grotesque Medium** — headings, labels, buttons. Geometric sans, a touch
  more architectural than Sonny.
- **Sonny Gothic UltraBlack** — display moments only. Hero numbers, section dividers,
  the rare statement. Used at scale.

No serif. No script. No oblique. **Scale does the talking** — set anything in
Sonny UltraBlack at 100px and it lands; set it at 14px and it disappears.

Type scale: modular, major-third (1.250 ratio) on a 16px base. Body sits at 18/28
because the reader is senior and the device is most likely a 27" display in a
meeting room.

### Backgrounds
- **No gradients.** No purple-blue startup gradients. None.
- **No full-bleed photography unless it earns its place** — and when it does, it is
  industrial: a foundry floor, a robotic cell, an aerospace shop, in cool natural
  light with no filter.
- **No repeating patterns** beyond the very subtle paper texture (optional, low
  opacity).
- Section variation comes from **two-tone paper** (`--paper` vs `--paper-2`) and
  full-bleed **ink** blocks (`#1A1714`) used for emphasis, never decoration.

### Borders & rules
- **1px hairlines on `--paper-edge`** separate sections — the cream-on-cream effect
  is the point.
- **2px oxblood rules** mark a beginning (under an eyebrow, top of a hero block).
- **3px ink rules** for tables and serious dividers.
- All edges are crisp. No glow, no blur on borders.

### Corner radii
- **Default `0px`.** Most surfaces are square. Editorial, not app-y.
- **2px** on small inputs and tags.
- **4px** on small cards and buttons.
- **8px** on large cards and hero images.
- **999px (pill)** reserved for status chips inside data tables — never for buttons.

### Shadows
Used sparingly. The brand looks flat. Three levels max:
- `--shadow-1` hairline lift, for inputs on hover.
- `--shadow-2` soft card lift, for dropdowns and tooltips.
- `--shadow-3` heavier lift, only for overlays and modals.

### Animation
- **Restrained.** Easing is `cubic-bezier(0.2, 0.7, 0.2, 1)` (a calm ease-out).
- Durations: 120ms (state changes), 200ms (panel reveals), 360ms (route changes).
- **No bounces. No springs.** No "delightful" micro-interactions. The brand does not
  delight; it informs.
- Fades and short translates (`translateY(8px) → 0`) are the only entrance motions.

### Hover & press states
- **Links:** colour shifts from `--ink` to `--oxblood`. Underline thickness stays.
- **Primary buttons:** background `--oxblood` → `--oxblood-deep`. No size change.
- **Secondary buttons:** background `transparent` → `--paper-2`. Border stays.
- **Press:** subtle `transform: translateY(1px)`. No scale. No shadow change.
- **Cards (interactive):** border colour darkens from `--paper-edge` to `--ink-3`;
  the card itself does not lift on hover (lift only on press into focus).

### Transparency & blur
- Almost never. The brand reads as solid, printed, present.
- One allowed use: a 6–10px backdrop blur on a sticky header when the page scrolls
  underneath it, with 80% paper opacity. Nowhere else.

### Imagery treatment
- **Warm, neutral light.** No teal-and-orange filter.
- **Grain optional, subtle.** Think 35mm film stock at ISO 400, not Instagram.
- **People photographed at work** — never posed. Hands, machines, screens, factory
  floors. No stock-photo handshakes, no diverse-team-laughing-in-meeting.
- Greyscale acceptable when imagery is reference, not protagonist (e.g. a small
  portrait beside a quote).

### Layout rules
- **Generous margins.** Page sides hold ~80px (large screens). Reading column tops
  out at 68ch.
- **Asymmetric grids preferred.** A 12-col grid is the tool, but compositions
  rarely use it evenly. Big headline + small caption beats two equal columns.
- **Sticky headers** are slim (~64px) and use the backdrop-blur convention above.
- **No carousels.** If content needs three slides, it deserves three sections.

### Cards
- Square corners (`--r-2` at most).
- 1px border (`--paper-edge`), no shadow at rest.
- Padding generous: `--s-8` (32px) standard, `--s-12` (48px) for feature cards.
- A single internal hairline rule is allowed to separate header from body.
- Interactive cards: border darkens on hover; click-press translates 1px.

---

## Iconography

The brief did not include an icon set. Kaipability does not have a proprietary
iconography. The recommendation is to use **Lucide** (open-source, MIT) at a
**1.75px stroke** weight — heavier than Lucide's default 2px feels too schematic;
1.75px feels engineered. Stroke colour matches text colour by default; icons that
need emphasis tint to `--oxblood`.

> ⚠️  **Flagged substitution.** We are linking Lucide from CDN as a stand-in.
> If Kaipability has a preferred icon system (or wants a custom set drawn against
> the wordmark's geometry), please share and we will swap.

```html
<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js"></script>
```

### Rules
- **Outline icons only.** No filled icons mixed in (one consistent style).
- **Size at 20px or 24px.** 16px reserved for inline-with-text.
- **No emoji.** Ever.
- **No unicode glyphs as icons** — but em-dashes (—) and arrows (→) inside copy are
  allowed and encouraged.
- **No decorative SVGs.** If an icon does not name a thing the user can do or see,
  it should not be on the page.

### Logo usage
- `assets/kaipability-logo-lockup.png` — **primary lockup** (mark + wordmark
  together, oxblood on transparent). Use this everywhere a brand bug is needed
  on a light background.
- `assets/kaipability-mark.png` — mark only, square, transparent. Favicons,
  social avatars, ink-bg lockups where the wordmark is set as live text.
- `assets/kaipability-wordmark.svg` — wordmark text only (Proxima Nova chain).
- `assets/kaipability-wordmark-paper.svg` — wordmark text only, paper colour.
- `assets/kaipability-logo-full.svg` — original source SVG. The icon section
  depends on an embedded raster image the export did not bundle, so the icon
  does not render outside the source. Kept for reference / re-export only.

---

## Index — what is in this folder

```
README.md                          ← you are here
SKILL.md                           ← machine-readable summary for Claude Code
colors_and_type.css                ← all design tokens (CSS vars + base styles)
fonts/
  SonnyGothic-Regular.woff
  SonnyGothic-UltraBlack.ttf
  GalanoGrotesqueMedium.otf
assets/
  kaipability-logo-lockup.png      ← primary lockup (mark + wordmark) ★
  kaipability-mark.png             ← mark only, square, transparent
  kaipability-wordmark.svg         ← wordmark text only, oxblood (specimens)
  kaipability-wordmark-paper.svg   ← wordmark text only, cream (for dark bg)
  kaipability-logo-full.svg        ← original SVG (icon does not render here)
preview/                           ← design-system cards (registered for review)
  type-*.html
  color-*.html
  spacing-*.html
  components-*.html
  brand-*.html
ui_kits/
  website/                         ← Kaipability marketing site UI kit
    index.html
    *.jsx
uploads/                           ← original assets as received
```

---

## Caveats — read these

1. **Icon mark in the original logo SVG does not render** outside the source file
   because it relies on an embedded raster image. Kaipability supplied a clean
   PNG mark separately (`assets/kaipability-mark.png`); the synthetic placeholder
   has been removed.
2. **No codebase, Figma, or screenshots were provided.** This is a v1 proposal
   built from the brief and assets only. Treat it as a starting point.
3. **Iconography is substituted** — Lucide via CDN. Confirm or replace.
4. **No mono typeface was provided.** Fallback chain in tokens is
   `JetBrains Mono → IBM Plex Mono → ui-monospace`. Confirm if Kaipability has a
   preference.
5. **One UI kit (the marketing website)** has been built — that is the only product
   surface implied by the brief. Confirm if there are others (client portal,
   readiness-assessment tool, internal dashboard).
6. **The brand wordmark uses Proxima Nova** (Canva default). It is a commercial
   face — we fall back through `Mona Sans → Montserrat → Helvetica Neue` via
   the `--font-brand` token. If you hold a Proxima Nova licence for production,
   load the webfont in the host app and the chain will use it automatically.
6. **The brand wordmark uses Proxima Nova** (the Canva default). It is a
   commercial face — we fall back through `Mona Sans → Montserrat → Helvetica
   Neue`. If a real Proxima Nova licence is in place for production, load the
   webfont in the host application and the chain will use it automatically.
