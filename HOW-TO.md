# Free Stack: how to use it

The operator's guide. How to curate a stack, send it to a client, and keep the directory honest. Technical detail (schema, validation, deploy) lives in [README.md](README.md); the product spec is [PRD.md](PRD.md).

Live site: https://tools.airl.io

## Four surfaces, not three

- **The public directory** is the bare URL, `/`. It's the full catalogue, open and indexable, safe to share or link from anywhere, including kaipability.com. It has no admin controls: no selection, no link generator, just browsing and search.
- **The staff curator** lives at `/x`. **Bookmark it,** since it isn't linked from the public page on purpose. This is your cockpit: the full directory, filters, selection, link generation, exports. Visiting `/x` once quietly marks that device as staff, which is the only thing that makes an "Open in curator" button appear later on client pages you view from it, so a client on their own device never sees a way back in.
- **Client mode** is what a generated link opens: a read-only, branded page showing only the tools you chose. That page is the deliverable. It always lives at the root URL with a `t=` parameter, never at `/x`, so a link you've already sent keeps working exactly as it always did.
- **My Stack** lives at `/my`, linked from client pages and the public directory. It's the client's own free workspace, not yours: a register of the accounts they hold for whichever tools they've adopted, who owns each one, and what to close down when someone leaves. There is no password field anywhere in it, on purpose. It is local-first, so it's worth telling clients that the file it makes them export at setup, not the browser copy, is what actually lasts. Full spec in PRD-REGISTER.md.

## Curating a stack

1. **Start here chips** (top, dashed outline): for when you are thinking in needs, not tool names. "Get paid and keep the books" filters the table to Finance. Click the active chip again to clear. These filter the view; they never tick anything.
2. **Starter packs** (solid chips): one click ticks a ready-made persona selection, "Solo founder, day one (7 tools)" and so on. Edit freely afterwards; the chip marks itself with an asterisk so you know the selection has drifted from stock.
3. **Filters and search** compose: type, category and free text all apply together. "Checked only" in the type dropdown reviews your current selection.
4. Tick and untick in the table. Row colour is the tool type. On a phone, rows become stacked cards with a "More" expander for alternatives, training and the when-to-include guidance.
5. The **stats bar** tracks your selection count and the honest annual value total as you go.

## Sending it to a client

1. Type the client or recipient name (shows on their page as "Prepared for...").
2. Optionally add a **personal note** (up to 280 characters). It renders as "A note from Kaipability" under their page header. One or two warm, specific sentences work best.
3. Tick **Plain English version** next to the link generator if the client would be better served by plainer wording than the standard descriptions, a reader who isn't comfortable with software jargon, or who has said as much. It swaps every description for a short, one-line version and relabels section headings in plain words; the rest of the page and the figures are unchanged. Leave it unticked by default, it's a judgement call per client, not a setting to leave permanently on.
4. **Generate link**, then either **Copy**, **Share** (native share sheet on a phone), or **Preview client view** first.
5. The link is the deliverable. It carries only tool ids and the name/note, so it keeps working as the directory improves. Tools you later retire show a polite "no longer recommended" card on old links rather than vanishing.

For a quick answer about one specific tool, rather than a whole stack, `?tool=` on the URL with a single tool id renders just that one card with minimal chrome. Handy for answering "does anything free do X" without generating a full client link.

## Exports (from the Export row)

All four act on the current selection and need at least one tool ticked:

- **Download CSV**: a spreadsheet of the selection including descriptions, values, pricing and the build-your-own notes. Opens clean in Excel.
- **Download HTML**: a single, self-contained branded file. Works offline, makes no external requests, safe to attach to an email or drop into a client folder.
- **Save as PDF**: opens the client view and brings up the print dialog; "Save as PDF" is a destination in that dialog. A4, single column, always light theme.
- **Email this stack**: opens a prefilled draft in your own mail app with the link and a tool list. Nothing is sent by the site itself.

## What the client gets

Their page shows, per tool: what it does, what the free tier honestly includes and where it stops, a "Paid plans from £X/month" pill, alternatives (always including open source where credible), an "Or build your own" note where DIY is genuinely realistic, training links, and a "Verified [month year]" freshness line. Plus:

- **Mark as set up**: they can tick off tools as they adopt them. Progress is saved on their device only, and the page says so.
- **Share progress with Kaipability**: a button that opens a prefilled email, already addressed to `info@kaipability.com`, listing each tool as "Set up" or "Not yet" alongside the live link. It's a `mailto:` draft, so nothing leaves their device until they hit send in their own mail app, but it means progress updates land in your inbox without you having to chase.
- **How costs could grow**: an indicative chart of monthly cost at 1, 5, 10 and 25 people if every free tier were outgrown at once, with the honest caption that most businesses never do.
- **Print or save as PDF** and **Share this page** buttons, and the same dark-mode toggle you have. A printed page or saved PDF also carries a small QR code linking back to the live stack, so a paper copy still points somewhere current (skipped automatically for an unusually large selection whose link is too long to encode).
- **Open in curator**, but only for you: if you're viewing a client's page from a device that has visited `/x` before, a button lets you reopen that exact stack in the staff curator, pre-ticked, to adjust and re-share. A client viewing the same page on their own device never sees this button.

## Discover deck and the My Stack hand-off

The public homepage's Discover deck lets any visitor swipe or click through a short set of tools, saying "Got it" for one they already use or "Add to my list" for one they want to try. You don't administer this: judgements are saved in that visitor's own browser only, exactly the same device-only honesty as "Mark as set up" above, and there is no record of it anywhere on your side.

Finishing a deck offers "Open these in My Stack", which hands both lists to the workspace as a link (`/my?from=…&have=…`). Tools the visitor said they already use land as active accounts; tools on their "want to try" list land as **planned** accounts, a quiet status meaning the business intends to sign up but hasn't yet. A planned row sits in its own "To sign up" group on the Accounts screen and stays out of the risk tiles and the Leavers checklist, since an account that doesn't exist yet is a plan, not a risk.

## Sign-up lists and batch add

Once a client has a shortlist of planned accounts, whichever way they arrived (a Discover hand-off, a batch add, or typed in one at a time), the **"Generate sign-up list"** action turns them into a printable, copyable checklist: sign up with the business email rather than a personal one, turn on two-factor authentication, record the account in the register, and the tool's free-tier caveat where the catalogue has one. It's a genuinely useful onboarding aid to point a client at once you've settled on a stack together: a concrete, ordered checklist rather than a bare tool list, with an optional tick to pre-seed those accounts into the register as planned rows in one save, so the intention is recorded before the first signup happens.

**Add several at once** (on the Accounts screen) covers the common case of one person opening several services under a single identity: pick catalogue tools, sovereign templates (HMRC Government Gateway and the like) and typed-in names in one tick-list, enter the shared identity, owner and 2FA method once, and commit the whole batch together. Per-row detail, a specific plan, a different owner, is edited afterwards in the usual details drawer, same as any other row.

The Backup screen also offers CSV, plain-text and print/PDF **reading copies** of the register, useful for a quick read, a share, or filing alongside other paperwork. They sit below the JSON register file, which stays the one that matters: only that `.fsr.json` export can be imported back in, and producing a reading copy never counts towards the "days since last export" warning.

## Keeping the directory honest

- **Adding or editing tools**: edit `data/tools.json`, run `node scripts/validate-data.mjs`, push. CI re-runs the validator and the browser test suite on every push; a push to `main` is a production release. Full field guidance in the README.
- **Never delete a tool or reuse an id.** Retire with `"archived": true`. Old client links depend on ids forever.
- **`value`, `free_limit` and `byo` carry the honesty bar**: numbers a sceptical reader would accept, free-tier descriptions that match reality, build-your-own advice only where DIY is genuinely sensible.
- **`last_verified`**: update it whenever you re-check a tool. Clients see it, and a stale date is more honest than no date.
- **The weekly link-rot sweep** runs on its own, outside this repo, and opens a pull request on a `maint/` branch whenever it finds a dead link or a stale price worth fixing. It never pushes to `main` itself. Review it and merge it exactly like any other PR, or close it if the proposed fix isn't right.

## Open decisions (kept in TODO.md)

Two value figures under review (Hotjar, Sketchup), the Vercel non-commercial terms question, favicon self-hosting, and sign-off on the "How we choose" page copy. The domain question is resolved: tools.airl.io is live with the canonical and social-preview URLs updated. The public-curator question is resolved: the root is public, the curator lives at `/x`. New from Phase 12: batch-adding a service the register already holds currently creates a second row rather than merging with the existing one, since PRD-REGISTER §17 is silent on the case; Rocky's call on whether that's fine (consistent with a manual add) or should be prevented.
