---
name: kaipability-design
description: Use this skill to generate well-branded interfaces and assets for Kaipability Ltd — a senior advisory practice in advanced manufacturing — for production or for throwaway prototypes / mocks / decks. Contains design guidelines, colour and type tokens, fonts, brand assets, and a website UI kit.
user-invocable: true
---

# Kaipability — design skill

Kaipability Ltd is a senior advisory practice in advanced manufacturing.
Audience: boards, capital allocators, technology vendors, industrial primes.
The brand reads as **a confidential memo printed on good paper** — editorial,
restrained, oxblood ink on cream, no decoration that has not earned its place.

## How to use this skill

1. **Read `README.md` first** — it has the full brand brief, content rules,
   visual foundations, iconography guidance, and a file index.
2. **Inspect `colors_and_type.css`** — every design token (colours, type scale,
   spacing, radii, shadows, motion) lives here as CSS variables.
3. **Inspect `components.css`** — the reusable component patterns
   (`.k-btn`, `.k-card`, `.k-chip`, `.k-input`, `.k-eyebrow`, `.k-table`, etc).
4. **Mine `ui_kits/website/` for site patterns** — sections like Hero, Practice
   tiles, the Built/Bought/Backed triad, Deployment Readiness gates table,
   Founder note, Writing list, and ink-block contact form. JSX components are
   small and intentionally cosmetic — lift the markup, not the architecture.
5. **Use `preview/` cards as visual specimens** — each one isolates a single
   facet of the system (a colour ramp, a type specimen, a component cluster).

## When generating artifacts

- **Copy fonts and assets out** of this skill folder into the artifact. Do not
  reference them by URL.
- **Default background is `--paper` (`#F4F1EA`)**, not white. White is wrong.
- **Default text is `--ink` (`#1A1714`)** — warm near-black, not pure black.
- **Use oxblood (`#A40000`)** for links, primary buttons, eyebrows, accent rules.
  Coral and lavender are for data viz and small accents — never large surfaces.
- **No emoji.** Ever. Use Lucide icons (linked from CDN) at 20–24px when icons
  are needed — outline only, 1.75px stroke.
- **The brand wordmark uses Proxima Nova** (Canva default) — only for the literal
  word "Kaipability". Use `--font-brand` (falls back through Mona Sans →
  Montserrat → Helvetica Neue). Everything else uses Sonny Gothic (body) or
  Galano Grotesque (headings).
- **No gradients.** No purple-blue startup gradients. No "glassy" effects.
- **Square corners** are the default (`--r-0`). Buttons / cards use `--r-2` (4px).
  Pills only inside data chips.
- **Type voice:** plain English, senior practitioner, no filler. State the thing.
  Em-dashes are good. Two short hits often beat one long sentence. No "thrilled",
  no "leverage", no "journey", no "we are excited to announce".
- **Preferred terms (use exactly):** Deployment Readiness · Physical AI · AI-native
  · Manufacturing Engineer · Modern Industrialist · Manufacturing-technology
  agnostic · Capability readiness · Built, bought, or backed.
- **Legal footer (every page):**
  > © 2026 Kaipability Ltd · Registered in England & Wales · Company No. 15772934

## If invoked standalone

If the user invokes this skill without other guidance, ask them what they want
to build. Likely answers: a one-pager, a board deck slide, a memo, a landing
page section, a press release, an investor brief. Then act as an expert
designer who outputs HTML artifacts (with `colors_and_type.css` and
`components.css` linked) or production code, depending on the need.

Always copy the brand assets and CSS into the output so it stands alone.
