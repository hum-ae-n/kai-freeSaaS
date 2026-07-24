# Free Stack: how to use it

The operator's guide. How to curate a stack, send it to a client, and keep the directory honest. Technical detail (schema, validation, deploy) lives in [README.md](README.md); the product spec is [PRD.md](PRD.md).

Live site: https://kai-freestack.netlify.app

## The two modes

- **Curator mode** is the bare URL. It is your cockpit: the full directory, filters, selection, link generation, exports.
- **Client mode** is what a generated link opens: a read-only, branded page showing only the tools you chose. That page is the deliverable. Clients never see the curator interface (though nothing currently stops someone finding it, see "Open decisions" at the end).

## Curating a stack

1. **Start here chips** (top, dashed outline): for when you are thinking in needs, not tool names. "Get paid and keep the books" filters the table to Finance. Click the active chip again to clear. These filter the view; they never tick anything.
2. **Starter packs** (solid chips): one click ticks a ready-made persona selection, "Solo founder, day one (7 tools)" and so on. Edit freely afterwards; the chip marks itself with an asterisk so you know the selection has drifted from stock.
3. **Filters and search** compose: type, category and free text all apply together. "Checked only" in the type dropdown reviews your current selection.
4. Tick and untick in the table. Row colour is the tool type. On a phone, rows become stacked cards with a "More" expander for alternatives, training and the when-to-include guidance.
5. The **stats bar** tracks your selection count and the honest annual value total as you go.

## Sending it to a client

1. Type the client or recipient name (shows on their page as "Prepared for...").
2. Optionally add a **personal note** (up to 280 characters). It renders as "A note from Kaipability" under their page header. One or two warm, specific sentences work best.
3. **Generate link**, then either **Copy**, **Share** (native share sheet on a phone), or **Preview client view** first.
4. The link is the deliverable. It carries only tool ids and the name/note, so it keeps working as the directory improves. Tools you later retire show a polite "no longer recommended" card on old links rather than vanishing.

## Exports (from the Export row)

All four act on the current selection and need at least one tool ticked:

- **Download CSV**: a spreadsheet of the selection including descriptions, values, pricing and the build-your-own notes. Opens clean in Excel.
- **Download HTML**: a single, self-contained branded file. Works offline, makes no external requests, safe to attach to an email or drop into a client folder.
- **Save as PDF**: opens the client view and brings up the print dialog; "Save as PDF" is a destination in that dialog. A4, single column, always light theme.
- **Email this stack**: opens a prefilled draft in your own mail app with the link and a tool list. Nothing is sent by the site itself.

## What the client gets

Their page shows, per tool: what it does, what the free tier honestly includes and where it stops, a "Paid plans from £X/month" pill, alternatives (always including open source where credible), an "Or build your own" note where DIY is genuinely realistic, training links, and a "Verified [month year]" freshness line. Plus:

- **Mark as set up**: they can tick off tools as they adopt them. Progress is saved on their device only, and the page says so.
- **How costs could grow**: an indicative chart of monthly cost at 1, 5, 10 and 25 people if every free tier were outgrown at once, with the honest caption that most businesses never do.
- **Print or save as PDF** and **Share this page** buttons, and the same dark-mode toggle you have.

## Keeping the directory honest

- **Adding or editing tools**: edit `data/tools.json`, run `node scripts/validate-data.mjs`, push. CI re-runs the validator and the browser test suite on every push; a push to `main` is a production release. Full field guidance in the README.
- **Never delete a tool or reuse an id.** Retire with `"archived": true`. Old client links depend on ids forever.
- **`value`, `free_limit` and `byo` carry the honesty bar**: numbers a sceptical reader would accept, free-tier descriptions that match reality, build-your-own advice only where DIY is genuinely sensible.
- **`last_verified`**: update it whenever you re-check a tool. Clients see it, and a stale date is more honest than no date.

## Open decisions (kept in TODO.md)

Public curator mode (the bare URL currently shows your internal when-to-include guidance to anyone), favicon self-hosting, two value figures under review (Hotjar, Sketchup), the Vercel non-commercial terms question, and pointing tools.airl.io at the site.
