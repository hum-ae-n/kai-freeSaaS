# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

`free-stack`: a curated directory of free and freemium SaaS tools for small businesses, built for Kaipability Ltd. One page, two modes:

- **Curator mode** (`/`): full directory, filters, search, checkboxes. The consultant picks tools for a client.
- **Client mode** (`/?t=0,2,5&client=Acme+Ltd`): read-only branded card page showing only the selected tools. This is the deliverable the client opens.

`PRD.md` is the specification and it is authoritative. It is section numbered. When implementing, cite the section you are working from (for example "per section 6, filters bar"). If the PRD and this file ever disagree, the PRD wins and this file should be corrected.

## Hard architecture constraints

These are not preferences. Breaking any of them is a defect:

- **No build step.** No bundler, no transpiler, no CSS preprocessor.
- **No framework.** No React, Vue, Svelte, jQuery, Tailwind, Bootstrap.
- **No npm runtime dependency.** The browser loads hand written HTML, CSS and JS only. `scripts/` may use Node for dev-time validation, and that is the only permitted Node use.
- **Vanilla ES modules**, loaded with `<script type="module">`. No transpiling for old browsers.
- The page `fetch`es `data/tools.json` at runtime. Edit the JSON, push, Netlify deploys. Maintenance cost stays near zero.

## Running it locally

`fetch()` is blocked under the `file://` protocol, so opening `index.html` by double clicking it will fail with a CORS error and an empty page. You must serve over HTTP:

```bash
python3 -m http.server 8000
# curator mode: http://localhost:8000/
# client mode:  http://localhost:8000/?t=0,2,5&client=Acme+Ltd
```

If the page renders blank, check the console for a `fetch` failure before suspecting the rendering code.

## Validating the data

```bash
node scripts/validate-data.mjs            # full error list
node scripts/validate-data.mjs --summary  # counts grouped by rule
```

Exit code 0 means the dataset satisfies PRD section 4. This is the gate for any change to `data/tools.json`. It also enforces the house style ban on em dashes.

## Data model notes

Schema is defined in PRD section 4. Beyond what the PRD states, know these:

- **`id` may be `0`.** Tool 0 is a real tool. Never test an id with a truthiness check (`if (tool.id)`) and never filter parsed id lists with `.filter(Boolean)`, or tool 0 silently disappears from client mode. Compare with `!== undefined` or `Number.isInteger`.
- **`alternatives` and `training` entries must every one have a live URL.** They render as `<a>` tags, so an entry without a URL becomes a dead link. Non linkable caveats ("Paid: Adobe Photoshop", "not free for commercial use") belong in the optional `notes` array, which renders as plain text.
- **`notes`** is an optional array of strings, added to the PRD schema to absorb those caveats. See `BUILD-PLAN.md` phase 1.
- **`urls[].domain`** is a bare hostname (`claude.ai`), never a full URL. It drives favicon lookup per PRD section 8.
- **`value`** is an honest annual GBP equivalent of a commercial alternative, not the price of the tool's own paid tier. See PRD section 10. A number nobody would pay is a bug even though the validator cannot catch it.

## Security requirements

- **The `client` URL parameter is attacker controlled and is reflected into the page.** Insert it with `textContent` or `createTextNode`. Never `innerHTML`, never template it into an HTML string. `?client=<img src=x onerror=alert(1)>` must render as literal text.
- All external links need `target="_blank" rel="noopener noreferrer"`.
- Treat every string from `tools.json` as untrusted for the same reason: build DOM nodes, do not concatenate HTML.

## House style

From PRD section 10, applies to code comments, docs and all user facing copy:

- **No em dashes.** Use commas, full stops or colons. En dashes in ranges (£800-1,500) are fine. The validator fails the build on em dashes in `tools.json`.
- Descriptions are written for the end user, not the consultant. Explain to a smart person who has never heard of the tool. One to three sentences, no jargon.
- No vendor bias. Every tool carries at least two alternatives including open source or self hosted where they exist.
- British English, GBP.

## Layout

```
index.html          single page, both modes
data/tools.json     single source of truth, 85 tools
css/styles.css      all styles, curator and client
js/data-loader.js   fetch, URL param parsing, mode routing
js/curator.js       table, filters, selection, link generation
js/client.js        card rendering grouped by category
assets/logo.svg     Kaipability branding
scripts/            dev-time validation, never shipped
netlify.toml        deploy config
```

## Definition of done

PRD section 14 lists ten acceptance criteria. Do not call a phase complete until the relevant ones pass, verified by actually loading the page, not by reading the code. `BUILD-LOOP.md` describes how work is sequenced and which agent owns which file.

## Git

Remote is `https://github.com/hum-ae-n/kai-freeSaaS` on `main`. Netlify auto deploys every push to `main`, so a push is a production release. Run the validator before pushing any data change.
