# Free Stack × Kaipability Design System

The brand source of truth is [design-system/](design-system/) — tokens, self-hosted fonts, logos, and the brand brief ([design-system/BRAND_BRIEF.md](design-system/BRAND_BRIEF.md)). [css/styles.css](css/styles.css) imports `design-system/colors_and_type.css` and adds the app layer. **Never redefine a brand token in the app layer; consume it.**

The vibe, from the brief: *a confidential memo printed on good paper.* Cream stock, oxblood ink, restrained typography, flat surfaces, square corners.

## How Free Stack consumes the system

| Brand token | Free Stack use |
|-------------|----------------|
| `--paper` / `--paper-2` / `--paper-edge` | Page, panels/alt surfaces, hairline rules |
| `--ink` `--ink-2` `--ink-3` | Text hierarchy; ink block as the table header |
| `--oxblood` / `--oxblood-deep` | Primary buttons, section rules, eyebrows, link hover |
| `--positive` (+tint) | Value figures, summary bar, CORE type |
| `--caution` (+tint) | NON-CORE type |
| `--info` (+tint) | M365 type |
| `--lavender-2` | SECTOR type |
| `--font-text` (Sonny Gothic) | Body, table, cards |
| `--font-sans` (Galano Grotesque) | Headings, labels, buttons, badges |
| `--font-display` (Sonny UltraBlack) | Client hero title, summary numbers only |
| `--r-1/--r-2` | Inputs 2px, buttons/cards 4px, everything else square |
| `--dur-fast/--ease-out` | All transitions (120ms, calm ease-out) |

App-layer tokens (defined in `styles.css`): the four type badge pairs (`--core-bg/fg` etc. — text colours are darkened variants of the semantic hues to hold 4.5:1 on their tints) and the row-accent rules (`--core-rule` etc., rendered as a 3px inset left rule on table rows, not a background wash).

## Component inventory

| Class | Notes |
|-------|------|
| `.btn` `-primary/-secondary/-ghost/-sm` | Flat. Oxblood primary, ink secondary, bordered ghost. Hover changes colour, never size. Press = 1px translate. |
| `.badge` + type variants | Pill (sanctioned: status chips inside data tables). Galano, letterspaced, text label always. |
| `.panel` | Bordered paper, no shadow at rest. Emphasis via a 2-3px oxblood top/left rule. |
| `.eyebrow` | Oxblood uppercase label, `--tr-eyebrow` tracking. |
| `.favicon` | 16px, DuckDuckGo → Google → hide chain (delegated listener in data-loader.js). |
| `.toast` | Ink slip, paper text, 3px left rule (sage success / oxblood error). |
| `.app-message` | Loading/error/empty states on `--paper-2`. |

## Brand rules that bind this app

- No gradients, no photography, no emoji, no carousels, no bounces.
- Shadows only on overlays (`--shadow-3` on the toast); cards signal hover by border darkening, not lift.
- Logos: `kaipability-logo-lockup.png` (headers, footer), `kaipability-mark.png` (favicon). The original `kaipability-logo-full.svg` does not render outside its source file — do not use it.
- Fonts are self-hosted from `design-system/fonts/` — no third-party font CDNs.
- Em dashes: fine in Kaipability marketing copy per the brief, but `tools.json` content follows PRD §10 (no em dashes) — the validator enforces it.

## Accessibility contract

- Focus: 2px oxblood outline, 2px offset, via `:focus-visible`.
- Contrast: text tokens hold 4.5:1 on paper; badge fg pairs verified against their tints.
- Touch: sub-768px link targets padded.
- Print: URLs after link text, favicons hidden, cards unbroken, white background.

## Adding UI

(1) Does an existing component do this? (2) Can brand tokens express it? (3) Only then add CSS, in the right mode section, consuming tokens. JS never sets inline styles — classes and `display` only.
