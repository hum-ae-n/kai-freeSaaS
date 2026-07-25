# TODO

Open items as of 25 July 2026. Build state: Phases 0-11 done, verified and merged to `main`. Phase 11, the My Stack account register workspace at `/my` (local-first account tracking, leaver checklists, a costs ledger, opt-in encryption, and the `why-register.html` awareness page), merged 25 Jul as `55ea0db` via PR 3 on Rocky's launch approval; the deploy-preview header audit caught and fixed a real Netlify header-replacement defect on `/embed.html` before merge, and production headers plus deployed files were verified by curl after the deploy. Detail in [BUILD-PLAN.md](BUILD-PLAN.md); run `node scripts/validate-data.mjs` and `node scripts/smoke-test.mjs` before any push (a push to `main` is a production release, and CI now runs both automatically on every push and PR).

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

## Decisions only Rocky can make

- [x] **Public curator mode.** Resolved 24 Jul: the root URL becomes a public read-only directory; the curator moves to the hidden, noindexed path `/x` (BUILD-PLAN 10.12). Not cryptographic security, the data stays public by nature of a static site, but the staff interface stops being the front door. Progress share-back address: info@kaipability.com.
- [ ] **Value figure spot-check (Phase 1.5).** The validator can't judge honesty (PRD §10). Review the `value` field across `data/tools.json`; flag anything indefensible.
- [ ] **Favicon self-hosting (Phase 5.6).** Client pages currently hit DuckDuckGo/Google proxies per link. Decide whether to inline/self-host icons for the 15 core tools (privacy + reliability) or accept the proxies.
- [x] **Analytics provider.** Decided 23 Jul: not needed. No analytics on the site. If that ever changes, the research notes favoured Plausible ($9/month, strips query strings so client names stay out of the data).
- [ ] **"How we choose" page.** A draft now exists at `docs/how-we-choose.md` (selection criteria, why every tool carries alternatives, how `value` is worked out), but it isn't wired into the public directory yet. Needs Rocky's sign-off on the copy, then a decision on where it surfaces on the public page.
- [x] **Borderline non-SaaS entries.** Decided 23 Jul: archived 61 (HMRC Tools), 65 (NCSC guidance), 66 (ICO guidance) and 83 (OPITO/GWO/HSE/Charities Commission training) as government or regulatory guidance rather than SaaS. Kept 74 (Free Training Academies): vendor learning platforms, genuinely SaaS-adjacent. Core count is now 12 by design.
- [ ] **Value figures the pricing research turned up as questionable (Phase 8.3).** Two remain for the Phase 1.5 review (the third, 66 ICO, is now archived and moot): 29 Hotjar Free looks low at `value: 100` since Contentsquare's acquisition of Hotjar; 82 Sketchup Free / Go carries `value: 200` but its free tier is licensed for non-commercial use only, which the value figure doesn't currently reflect.
- [ ] **Vercel listing (id 86, Vercel Hobby).** Its free Hobby tier's terms of service ban commercial use, unusual among the tools in this directory. Currently kept, with a `notes` entry warning that a client's production site needs Vercel Pro or an alternative such as Netlify Free. Decide whether that warning is enough or whether it should be archived instead.

## Nice-to-have / flagged

- [ ] Replace the Lucide-via-CDN icon substitution if a preferred icon system exists (design-system brief caveat; not currently used by Free Stack itself). Category icons in client mode already use hand-copied Lucide paths with no CDN or npm dependency, see BUILD-PLAN 7.11.
- [ ] Confirm whether a licensed Proxima Nova webfont should be loaded for the wordmark (falls back to Mona Sans/Montserrat today)
- [ ] Post-v1 ideas parked in PRD §13 still open: API endpoint serving `tools.json` publicly. (Embed mode, also listed there, shipped in Phase 10.11 via `embed.html`.)
