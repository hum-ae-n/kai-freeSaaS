# Free Stack

[![Netlify Status](https://api.netlify.com/api/v1/badges/3bbf5cb0-fbf6-4ccc-b07a-b377af02b444/deploy-status)](https://app.netlify.com/projects/kai-freestack/deploys)

Live at [kai-freestack.netlify.app](https://kai-freestack.netlify.app). Every push to `main` deploys to production.

A curated directory of free and freemium software for small business, by [Kaipability Ltd](https://kaipability.com). No affiliate links, no sponsored placements, no vendor bias. Every tool ships with alternatives and training resources.

One page, two modes:

- **Curator mode** (`/`): the full directory. Filter, search, tick the tools relevant to a client, jump in with a "Start here" need chip or a persona starter pack, then generate a shareable link or export the selection directly.
- **Client mode** (`/?t=0,2,5&client=Acme+Ltd`): a clean, branded, read-only page showing only the selected tools. Cards show what the free tier covers and what it costs to outgrow it. The client can print it, save it as a PDF, share it, and tick off each tool as they set it up.

Vanilla HTML/CSS/JS. No build step, no npm, no framework. Spec lives in [PRD.md](PRD.md), visual language in [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md).

## Run locally

The page fetches `data/tools.json`, and `file://` blocks fetch, so serve over HTTP:

```bash
# any static server works, e.g.
python -m http.server 8080
# or
npx serve .
```

Then open `http://localhost:8080/`.

## URL schema

| Param | Effect |
|-------|--------|
| _none_ | Curator mode |
| `t` | Comma-separated tool ids. Presence switches to client mode. Unknown/malformed ids are skipped; zero valid ids renders an explicit empty state. |
| `client` | Optional URL-encoded recipient name shown in the client header (always rendered as text, never HTML). Capped at 80 characters; anything longer is trimmed, and a whitespace-only value is treated as absent. |
| `note` | Optional URL-encoded personal message shown under the client header, for a short line from the consultant to the client (also plain text, never HTML). Capped at 280 characters; longer input is trimmed, and whitespace-only is treated as absent. Set it from the "Personal note" field next to the link generator. |
| `print` | Internal, not something to type by hand. Set to `1`, it triggers the print dialogue once the page has settled. It only ever appears because the curator's "Save as PDF" export button added it; the ordinary link generator, "Preview client view", "Share" and "Copy" never include it, so a client's saved or shared link never opens with an unexpected print prompt. |

The link generator builds `t`, `client` and `note` for you, so most people never type this table by hand. It's here for anyone editing a link manually.

## Adding or editing a tool

1. Edit `data/tools.json`. Schema is PRD §4. The short version:
   - New tools take the **next sequential id**. Never reorder or reuse existing ids: they are baked into shared links that have already gone out to clients.
   - Every `alternatives` and `training` entry needs a **live `https://` URL** (minimum 2 of each). Caveats that aren't links go in the optional `notes` array.
   - Every `urls[]` entry needs a bare `domain` (drives favicons).
   - Categories: use one of the existing categories (listed in PRD §4, tallied in §15) unless you're deliberately adding one, such as the Developer & Web category added in Phase 8. Grants & Business Support now holds only archived entries and no longer appears in either mode, so don't add live tools to it.
   - The pricing trio, all optional but expected on any tool you can find real pricing for: `free_limit` is a plain-English line on what the free tier actually includes and where it stops ("Free for 1 user and 3 social channels", "Free forever, no paid tier"); `paid_from` is the cheapest paid plan a growing business would realistically hit, in GBP per month (use `0` only if there is genuinely nothing to outgrow, and divide an annual-only price by 12); `scales_with` says what drives the cost up, one of `users` (per seat), `usage` (volume, storage, sends), `features` (capability gates) or `none` (the free tier is the whole product). These feed the client-mode pricing pill and the "How costs could grow" chart, so get them right rather than leaving them out: a chart that quietly omits a tool because nobody researched its pricing is more honest than a guessed figure, but a guessed figure is worse than either.
   - House style: no em dashes; honest `value` figures (PRD §10). The pricing trio carries the same honesty bar: `free_limit` and `paid_from` should survive the same sceptical reader the `value` figure has to survive, not read like a marketing page.
2. **Editing an existing tool:** name, description, category, `value`, `free_limit`, `paid_from`, `scales_with`, `urls`, `alternatives`, `training` and `notes` are all safe to change. `id` is never safe to change: every client link is just a list of ids, so changing one silently swaps in a different tool on a page someone already has open or saved.
3. **Retiring a tool:** if it shuts down, stops being free or you no longer want to recommend it, do not delete the entry. Set `"archived": true` instead and leave everything else in place. Old client links that included it keep resolving, now showing a plain "no longer recommended" card that points at its alternatives instead of a value claim. Archived tools drop out of curator mode and off any new link, but the record stays so nothing goes silently missing from a deliverable someone already has.
4. **`last_verified`:** an optional `YYYY-MM-DD` date. Update it whenever you re-check a tool's links and confirm it is still free. It has no effect on validation; it is just an honesty marker, and client mode shows it as a "Verified [month, year]" line on the card.
5. Run the gate:
   ```bash
   node scripts/validate-data.mjs
   ```
   Exit 0 or it doesn't ship.
6. Push. Netlify deploys `main` automatically: **a push is a production release.**

## Start here: need chips and starter packs

Curator mode offers two different shortcuts above the filters bar, and it's worth keeping them straight because they do different jobs:

- **"Start here" need chips** answer "what do you need?" for someone who doesn't know any tool names yet: "Build a website", "Get customers", "Stay secure" and so on. Clicking one applies a **filter**, exactly as if the person had typed into the search box or picked a category themselves. It never selects or deselects a tool. Only one need chip is active at a time, and editing the type dropdown, category dropdown or search box by hand clears whichever chip is active, since the filter state has now diverged from what the chip set. A need whose category isn't present in the current dataset simply isn't offered as a chip, rather than filtering the table down to nothing.
- **Starter packs** (below) answer "who is this client?" and apply a **selection**, ticking a ready-made set of tools in one go.

### Starter packs

Curator mode also shows a row of chips such as "Solo founder, day one" or "Microsoft 365 shop". Clicking one selects a ready-made set of tools for that kind of client in one go. They come from `data/presets.json`, a small file separate from `tools.json`:

```json
{
  "name": "Solo founder, day one",
  "description": "The absolute basics for a one-person business that is just starting out.",
  "ids": [0, 2, 6, 36, 47, 62, 67]
}
```

To add or edit a pack:

- `name` is the chip label.
- `description` is curator-facing only; it shows as a tooltip on the chip, so it can be short and plain.
- `ids` must already exist in `data/tools.json`. Never invent an id here; only reference ones that are real. Any id that doesn't exist is silently dropped rather than breaking the page.
- The same id-permanence rule applies as everywhere else: don't reuse an id for a different tool later, since a pack (and any link generated from it) is only as accurate as the ids it points to.

Applying a chip is just a starting point: the consultant can still tick or untick individual tools afterwards. If they do, the chip stays selected but is marked as modified, so it's obvious the final list has drifted from the stock pack.

## Pricing and "how costs could grow"

Where the pricing trio (`free_limit`, `paid_from`, `scales_with`, see "Adding or editing a tool" above) is filled in for a tool, both modes surface it:

- Every card shows a **free tier line** (the `free_limit` text) and a **pricing pill**, either "Free forever" (`paid_from` is `0`) or "Paid plans from £X/month".
- Client mode adds a **"How costs could grow"** chart under the summary bar: an indicative, hand-built model, not a forecast, showing the selected stack's likely monthly cost at four team sizes ("Just you", "Team of 5", "Team of 10", "Team of 25"). Stage one always assumes every free tier still holds, so it reads as £0. From there, a per-user tool (`scales_with: "users"`) multiplies its `paid_from` figure by the team size; a usage- or feature-gated tool (`"usage"` or `"features"`) is added flat regardless of headcount; a tool with `"none"` or no pricing data at all contributes nothing, because the model only ever names a cost it can actually source, never a guess. Hover or focus a bar for the tools driving that stage's total. There's also a plain table underneath for anyone who can't see or use the chart, and it prints cleanly.

This is a steer for a conversation with the client, not a quote. Treat any figure it produces the same way you'd treat the `value` field: it should survive a sceptical read.

## Mobile curator

Below 768px, the curator table stops trying to be a table. Each row becomes a stacked, type-tinted card with the checkbox, name, category and type badge always visible, and a "More" disclosure that expands to the description, alternatives, training and "include when" guidance, the same data the desktop columns show, just collapsed by default so a phone screen isn't three thousand pixels of scrolling. Touch targets are 44px. Nothing above 768px changes.

## Dark mode

A toggle (sun/moon icon, top right of both modes) switches between the light "cream paper" palette and a warm dark palette built from the same design tokens. The choice is:

- **Stored** in `localStorage` under `freestack:v1:theme`, so it's remembered on that device.
- **Defaulted to the OS setting** (`prefers-color-scheme`) until the reader has actually clicked the toggle once. Until then, changing the OS theme live updates the page to match; after the first click, the explicit choice always wins over the OS.
- **Always light when printed.** However the screen is set, `@media print` forces the light palette, so a saved PDF or a physical printout is never dark background, light text.

## Exports from curator mode

Alongside the link generator, four buttons act on the current selection (the ticked tools, plus whatever client name and note are filled in), each disabled until at least one tool is selected:

- **Download CSV:** an Excel-friendly spreadsheet of the selection (name, category, type, description, value, the pricing trio, URLs, alternatives, training), one row per tool plus a header row.
- **Download HTML:** a single, self-contained HTML file with the styling inlined, no external requests of any kind, not even for favicons or fonts. It opens and reads correctly with no internet connection at all, which the ordinary shareable link (which fetches `tools.json` and favicon images) does not.
- **Save as PDF:** opens the ordinary client view in a new tab with `?print=1` added, which triggers the browser's print dialogue automatically once the page has settled (see the URL schema table above). Same client view either way; this button just saves the reader a manual click on "Print or save as PDF".
- **Email this stack:** opens a prefilled draft in the reader's own mail app (a `mailto:` link) addressed to nobody in particular, with the shareable link and a short tool list already in the body. Nothing is sent by the site itself: it hands off to whatever mail client is already configured on that machine, and the consultant still chooses the recipient and hits send.

## Print, share and the adoption checklist

Client mode carries three small conveniences aimed at the person receiving the page, not the consultant:

- **Print or save as PDF:** a button that triggers the browser's normal print dialog, with a print stylesheet that lays the page out cleanly on A4.
- **Share this page:** uses the device's native share sheet where one exists (most phones); otherwise it copies the link to the clipboard and shows a confirmation.
- **Mark as set up:** every tool card has a checkbox-style button so the client can tick off tools as they actually get around to setting them up. This is stored in the browser only, tied to that exact link (the same set of tools and the same client name), using `localStorage`. Be honest with clients about the limits: it does not sync between devices, it is not sent anywhere, and it will not survive private/incognito browsing or a cleared cache. It's a personal progress tracker, not a shared record.

## Social preview image

`assets/og-image.png` is the picture that shows up when the client link is pasted into Slack, WhatsApp, iMessage or similar. It's a static PNG, not generated on the fly, so it has to be rebuilt by hand when the branding changes:

1. Edit `scripts/og-card.html`, a standalone page styled to exactly 1200×630px. It is never shipped or linked from the site; it exists purely to be screenshotted.
2. Open it in headless Chromium and capture a 1200×630 screenshot. This repo has no dedicated npm script for it, since Playwright is dev-only tooling and not a site dependency, but the same Playwright install the smoke test uses can drive the screenshot: point `PLAYWRIGHT_DIR` (and, in CI, `PLAYWRIGHT_BROWSERS_PATH`) at an existing Playwright/Chromium install, load the local `scripts/og-card.html`, set the viewport to 1200×630 and save the page screenshot.
3. Save the result over `assets/og-image.png`.
4. Keep the file under 300KB. WhatsApp in particular drops oversized preview images silently rather than showing a broken one, so a preview that "used to work" and then stops appearing is usually a file-size problem, not a broken link.

## Deploy

Static hosting via Netlify, configured in `netlify.toml` (SPA redirect + security headers, no build command). Connect the GitHub repo to Netlify, set the custom domain if wanted, done.

**CI:** a GitHub Actions workflow (`.github/workflows/ci.yml`) runs the data validator and a headless-browser smoke test on every push to `main` and on every pull request. It installs Playwright itself in a temporary location for the run; this does not add Playwright, or anything else, as a dependency of the site.

## Repo map

```
index.html                shell: mount points for both modes, social preview meta
data/tools.json           single source of truth, 98 entries (93 active, 5 archived)
data/presets.json         starter-pack chips shown above the curator filters
css/styles.css            design tokens + components + both modes (see DESIGN-SYSTEM.md)
js/data-loader.js         fetch, URL parsing, routing, shared helpers, favicon fallback
js/curator.js             curator mode
js/client.js              client mode
scripts/validate-data.mjs data schema gate
scripts/smoke-test.mjs    headless-browser check of both modes
scripts/og-card.html      source for assets/og-image.png, screenshotted by hand
assets/og-image.png       social preview image (Slack/WhatsApp/iMessage link previews)
.github/workflows/ci.yml  runs the validator and smoke test on push and PR
```
