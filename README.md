# Free Stack

[![Netlify Status](https://api.netlify.com/api/v1/badges/3bbf5cb0-fbf6-4ccc-b07a-b377af02b444/deploy-status)](https://app.netlify.com/projects/kai-freestack/deploys)

Live at [kai-freestack.netlify.app](https://kai-freestack.netlify.app). Every push to `main` deploys to production.

A curated directory of free and freemium software for small business, by [Kaipability Ltd](https://kaipability.com). No affiliate links, no sponsored placements, no vendor bias. Every tool ships with alternatives and training resources.

One page, two modes:

- **Curator mode** (`/`): the full directory. Filter, search, tick the tools relevant to a client, generate a shareable link.
- **Client mode** (`/?t=0,2,5&client=Acme+Ltd`): a clean, branded, read-only page showing only the selected tools.

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
| `client` | Optional URL-encoded recipient name shown in the client header (always rendered as text, never HTML). |

## Adding or editing a tool

1. Edit `data/tools.json`. Schema is PRD §4. The short version:
   - New tools take the **next sequential id**. Never reorder or reuse existing ids — they are baked into shared links.
   - Every `alternatives` and `training` entry needs a **live `https://` URL** (minimum 2 of each). Caveats that aren't links go in the optional `notes` array.
   - Every `urls[]` entry needs a bare `domain` (drives favicons).
   - Categories: use one of the existing 15 (PRD §4) unless you're deliberately adding one.
   - House style: no em dashes; honest `value` figures (PRD §10).
2. Run the gate:
   ```bash
   node scripts/validate-data.mjs
   ```
   Exit 0 or it doesn't ship.
3. Push. Netlify deploys `main` automatically — **a push is a production release.**

## Deploy

Static hosting via Netlify, configured in `netlify.toml` (SPA redirect + security headers, no build command). Connect the GitHub repo to Netlify, set the custom domain if wanted, done.

## Repo map

```
index.html          shell: mount points for both modes
data/tools.json     single source of truth, 85 tools
css/styles.css      design tokens + components + both modes (see DESIGN-SYSTEM.md)
js/data-loader.js   fetch, URL parsing, routing, shared helpers, favicon fallback
js/curator.js       curator mode
js/client.js        client mode
scripts/validate-data.mjs   data schema gate
assets/logo.svg     placeholder wordmark (flagged for brand replacement)
```
