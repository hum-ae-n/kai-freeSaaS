# TODO

Open items as of 27 July 2026. Build state: Phases 0-11 done, verified and merged to `main`. Phase 11, the My Stack account register workspace at `/my` (local-first account tracking, leaver checklists, a costs ledger, opt-in encryption, and the `why-register.html` awareness page), merged 25 Jul as `55ea0db` via PR 3 on Rocky's launch approval; the deploy-preview header audit caught and fixed a real Netlify header-replacement defect on `/embed.html` before merge, and production headers plus deployed files were verified by curl after the deploy.

Build state: Phases 0-12 done, verified and merged to `main`. Phase 12 (homepage redesign, Discover deck with first-open coach, planned account status, batch add, sign-up generator, reading-copy exports) merged 27 Jul as `03a5ac5` via PR 9. Detail in [BUILD-PLAN.md](BUILD-PLAN.md); run `node scripts/validate-data.mjs` and `node scripts/smoke-test.mjs` before any push (a push to `main` is a production release, and CI now runs both automatically on every push and PR).

Build state: Phase 13 (payments, a first Stripe tip link and a GoCardless audit paylink, provider-agnostic, hosted checkout links only) is specced in `docs/PAYMENTS.md` and gated on Rocky completing provider setup in both dashboards and supplying the live payment link URLs before the small site-side build wave can run. Not started on the codebase side.

Build state: Phases 0-12 and 14 done, verified and merged to `main`. Phase 14 (compact landing with collapsed category shelves, the felt-motion inventory of amended PRD §16, and the answer-engine and search-visibility layer of new PRD §18) merged 31 Jul as `e0726ad` via PR 13 on Rocky's word, after a clean Deploy Preview audit; production verified by curl after the deploy (new files byte-identical, headers unchanged, working documents still blocked, noindex boundaries holding). The same PR carried the Phase 13 payments build instructions (`docs/PAYMENTS.md`, documentation only); the payments site build itself stays gated on Rocky's live provider links. CI now also runs `node scripts/build-seo.mjs` as a drift gate on every push, per the "Adding or editing a tool" workflow in the README. Detail in [BUILD-PLAN.md](BUILD-PLAN.md).

Build state: Phase 15.6 (mobile finesse: shelf headers are icon, title, count and chevron only, the scent line retired; the deck's top card shakes once per open to show it can move; the progress counter is 18px full-contrast and measured inside a phone viewport) merged 1 Aug as `de011ee` via PR 17 on Rocky's word, verifier PASS with zero findings and the exit-transition guard proven load-bearing by revert. Production verified byte-identical. Smoke suite at 331.

Build state: Phase 15.5 (stuck-header collapse lands back on the shelf, visible Close hint while stuck, the 15.4 directionless-observer bug fixed and its deep-link boundary pinned in the suite) merged 1 Aug as `33e89eb` via PR 16 on Rocky's word; production verified byte-identical. Smoke suite at 314. Rocky's desktop pass still to come.

Build state: Phase 15.4 (Rocky's phone-test fixes, PRD v1.7) merged 1 Aug as `557fa43` via PR 15 on Rocky's word: the static crawler block no longer flashes on load (hidden before first paint by the theme-boot stamp, whose new CSP hash was independently verified against the served header and scripts in production), open shelf headers are sticky at every width, and the Discover button carries the airl.io house CTA treatment, the motion inventory's single recorded looping exception. Production verified byte-identical after the deploy; smoke suite at 307.

Build state: Phases 0-12, 14 and 15 done, verified and merged to `main`. Phase 15 (the hero utility nav with My Stack and FAQ, the footer good-practice block with company identity, the indexable `privacy.html` and `contact.html` pages, and the bounded Discover button emphasis of motion inventory item 8) merged 1 Aug as `6d84458` via PR 14 on Rocky's word, after the verifier loop caught and closed two real defects (the ways-in band never hid while the deck was open; the pulse could still fire mid-deck under load until suppression moved to click time). Production verified by curl after the deploy: both pages live and byte-identical, sitemap carrying exactly the four permitted URLs, CSP matched, docs still blocked. Smoke suite now 297 checks. Detail in [BUILD-PLAN.md](BUILD-PLAN.md).

## Deploy (Phase 6)

- [x] Connect this repo to Netlify, confirm auto-deploy on push to `main`
  - 22 Jul: project **kai-freestack** created on team `mrv`, site id `3bbf5cb0-fbf6-4ccc-b07a-b377af02b444`. 23 Jul: Rocky linked `hum-ae-n/kai-freeSaaS` via GitHub OAuth; live at `https://kai-freestack.netlify.app` (200, `tools.json` serving). Status badge added to README.
  - Note (22 Jul, superseded 24 Jul): curator mode, including the internal `when` column, was publicly reachable at the bare URL. Resolved by the public/staff split below: the bare URL is now the public directory, and curator moved to the unlisted `/x` path.
- [x] Custom domain: **tools.airl.io** live 25 Jul (CNAME to `kai-freestack.netlify.app`, certificate issued, headers verified by curl). `og:url`, `og:image`, canonical, security.txt `Canonical` and the README/HOW-TO live links all updated to the new domain.
  - Remaining one-click item for Rocky: Domain management > Options > **Set as primary domain** on tools.airl.io, so old `kai-freestack.netlify.app` links redirect instead of serving in parallel. Verified 25 Jul that the old domain still returns 200 with no redirect.
- [~] Full Definition of Done pass (PRD §14, all 10 items) against the live URL, not localhost
  - 23 Jul live verification: all shipped files byte-identical to `origin/main` on the live URL; security headers and `tools.json` cache-control serving per `netlify.toml`; SPA fallback works and does not expose `netlify.toml`; DuckDuckGo favicon proxy returns 200.
  - Remaining human eyeball (agents cannot drive a browser against the live URL from this sandbox): DoD 6 favicons render on a real phone, DoD 7 copy button pastes cleanly into Word. Two minutes on your phone: https://kai-freestack.netlify.app/?t=0,2,6&client=Test

## Merging Phase 7

- [x] **Merge `claude/read-todo-bk47qb` into `main`.** Approved by Rocky 23 Jul ("go for it"), merged and deployed the same day.

## Merging Phase 10 (closed)

- [x] **Merge `claude/read-todo-bk47qb` into `main`.** Done 25 Jul as `84f1e0f`, approved by Rocky.
- [x] **Header checks on the Netlify deploy preview.** Confirmed clean before the merge above (the merge commit records a "deploy-preview header audit clean"), covering `X-Frame-Options: DENY` on `/`, `/index.html` and `/x`, the `/embed.html`-scoped CSP, and `/robots.txt` returning 404 rather than the SPA fallback's 200.

## Merging Phase 12 (closed)

- [x] **Merge `claude/read-todo-bk47qb` into `main`.** Done 27 Jul as `03a5ac5` via PR 9 on Rocky's word, after his phone test drove two final improvements (the deck now fits the viewport so the buttons never fall off-screen, and a first-open coach explains the swipe directions). Production verified by curl after the deploy: new modules byte-identical, headers unchanged, working documents still blocked.

## Merging Phase 14 (closed)

- [x] **Merge `claude/read-todo-bk47qb` into `main`.** Done 31 Jul as `e0726ad` via PR 13 on Rocky's word ("do it"). The close-out sweep caught two blockers first: coach dismissal dropped keyboard focus (fixed, two new pre-fix-proven smoke checks, suite now 275), and the documented tool-edit workflow was missing the `build-seo.mjs` step (docs pass landed). Deploy Preview audited by curl and a real browser before merge; production verified after: `faq.html`, `sitemap.xml`, `llms.txt` live with correct content types, files byte-identical apart from Netlify's Pretty URLs rewriting the footer `/faq.html` link to `/faq` (both resolve), CSP unchanged, docs still 404.
- [ ] **Human eyeball on production** (agents cannot judge feel): the real-device motion checklist from the PR 13 audit comment, now against https://tools.airl.io: shelves, swipe deck coach, dark-mode cross-fade, reduced-motion behaviour.

## Decisions only Rocky can make

- [x] **Batch add of a service already in the register (Phase 12.5).** Decided by Rocky 27 Jul: fine as is. A batch pick matching a `toolId` already recorded creates a second row, the same as a manual add would; genuinely-duplicate accounts for one service are a real situation and the register records what exists.
- [x] **Public curator mode.** Resolved 24 Jul: the root URL becomes a public read-only directory; the curator moves to the hidden, noindexed path `/x` (BUILD-PLAN 10.12). Not cryptographic security, the data stays public by nature of a static site, but the staff interface stops being the front door. Progress share-back address: info@kaipability.com.
- [ ] **Value figure spot-check (Phase 1.5).** The validator can't judge honesty (PRD §10). Review the `value` field across `data/tools.json`; flag anything indefensible.
- [ ] **Favicon self-hosting (Phase 5.6).** Client pages currently hit DuckDuckGo/Google proxies per link. Decide whether to inline/self-host icons for the 15 core tools (privacy + reliability) or accept the proxies.
- [x] **Analytics provider.** Decided 23 Jul: not needed. No analytics on the site. If that ever changes, the research notes favoured Plausible ($9/month, strips query strings so client names stay out of the data).
- [ ] **"How we choose" page.** A draft now exists at `docs/how-we-choose.md` (selection criteria, why every tool carries alternatives, how `value` is worked out), but it isn't wired into the public directory yet. Needs Rocky's sign-off on the copy, then a decision on where it surfaces on the public page.
- [x] **Borderline non-SaaS entries.** Decided 23 Jul: archived 61 (HMRC Tools), 65 (NCSC guidance), 66 (ICO guidance) and 83 (OPITO/GWO/HSE/Charities Commission training) as government or regulatory guidance rather than SaaS. Kept 74 (Free Training Academies): vendor learning platforms, genuinely SaaS-adjacent. Core count is now 12 by design.
- [ ] **Value figures the pricing research turned up as questionable (Phase 8.3).** Two remain for the Phase 1.5 review (the third, 66 ICO, is now archived and moot): 29 Hotjar Free looks low at `value: 100` since Contentsquare's acquisition of Hotjar; 82 Sketchup Free / Go carries `value: 200` but its free tier is licensed for non-commercial use only, which the value figure doesn't currently reflect.
- [x] **Vercel listing (id 86, Vercel Hobby).** Decided by Rocky 27 Jul: keep with the warning for now. The `notes` entry stating that a client's production site needs Vercel Pro or an alternative such as Netlify Free stays as the honesty mechanism; revisit if the terms change.

## Nice-to-have / flagged

- [ ] Unconfirmed report (14.2 builder): judging a tool then reloading sometimes left its browse-list chip un-rendered. The 14.2 verifier could not reproduce it in about 15 varied attempts on current HEAD. Watch for it during real use; if anyone reproduces it, capture the exact sequence and hand it to the list-parity owner.
- [ ] Replace the Lucide-via-CDN icon substitution if a preferred icon system exists (design-system brief caveat; not currently used by Free Stack itself). Category icons in client mode already use hand-copied Lucide paths with no CDN or npm dependency, see BUILD-PLAN 7.11.
- [ ] Confirm whether a licensed Proxima Nova webfont should be loaded for the wordmark (falls back to Mona Sans/Montserrat today)
- [ ] Post-v1 ideas parked in PRD §13 still open: API endpoint serving `tools.json` publicly. (Embed mode, also listed there, shipped in Phase 10.11 via `embed.html`.)
