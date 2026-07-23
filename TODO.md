# TODO

Open items as of 23 July 2026. Build state: Phases 0-4 done and verified, Phase 5 done except 5.6, Phase 6 done bar the custom domain and a final human eyeball pass, Phase 7 (presets, adoption checklist, personal note, category icons, print/share, social preview, CI, retirement flow) merged to `main`. Phase 8 (dataset truth, pricing/cost model, mobile curator, need chips, dark mode, branded exports) is complete pending the final verifier sweep (8.10), still on branch `claude/read-todo-bk47qb` and not yet merged. Detail in [BUILD-PLAN.md](BUILD-PLAN.md); run `node scripts/validate-data.mjs` and `node scripts/smoke-test.mjs` before any push (a push to `main` is a production release once Netlify is connected, and CI now runs both automatically on every push and PR).

## Deploy (Phase 6)

- [x] Connect this repo to Netlify, confirm auto-deploy on push to `main`
  - 22 Jul: project **kai-freestack** created on team `mrv`, site id `3bbf5cb0-fbf6-4ccc-b07a-b377af02b444`. 23 Jul: Rocky linked `hum-ae-n/kai-freeSaaS` via GitHub OAuth; live at `https://kai-freestack.netlify.app` (200, `tools.json` serving). Status badge added to README.
  - Note: curator mode (including the internal `when` column) is now publicly reachable at that URL. The public-curator decision below is now live, not theoretical.
- [ ] Custom domain: **tools.airl.io** (decided 22 Jul, replaces the `freestack.kaipability.com` example). Do after the repo link: Domain management > add custom domain > CNAME to `kai-freestack.netlify.app`. When it lands, update `og:url`, `og:image` and the canonical link in `index.html`.
- [~] Full Definition of Done pass (PRD §14, all 10 items) against the live URL, not localhost
  - 23 Jul live verification: all shipped files byte-identical to `origin/main` on the live URL; security headers and `tools.json` cache-control serving per `netlify.toml`; SPA fallback works and does not expose `netlify.toml`; DuckDuckGo favicon proxy returns 200.
  - Remaining human eyeball (agents cannot drive a browser against the live URL from this sandbox): DoD 6 favicons render on a real phone, DoD 7 copy button pastes cleanly into Word. Two minutes on your phone: https://kai-freestack.netlify.app/?t=0,2,6&client=Test

## Merging Phase 7

- [x] **Merge `claude/read-todo-bk47qb` into `main`.** Approved by Rocky 23 Jul ("go for it"), merged and deployed the same day.

## Decisions only Rocky can make

- [ ] **Public curator mode.** The bare URL serves the full curator interface, including the internal `when` column (consulting guidance) and value calibrations. Decide before sharing any client link: acceptable public, hide the column, or add the token auth deferred in PRD §13. Blocks Phase 6 sign-off.
- [ ] **Value figure spot-check (Phase 1.5).** The validator can't judge honesty (PRD §10). Review the `value` field across `data/tools.json`; flag anything indefensible.
- [ ] **Favicon self-hosting (Phase 5.6).** Client pages currently hit DuckDuckGo/Google proxies per link. Decide whether to inline/self-host icons for the 15 core tools (privacy + reliability) or accept the proxies.
- [x] **Analytics provider.** Decided 23 Jul: not needed. No analytics on the site. If that ever changes, the research notes favoured Plausible ($9/month, strips query strings so client names stay out of the data).
- [ ] **"How we choose" page.** Nothing written yet. Decide whether the site needs a page explaining the selection criteria (free tier scope, why an alternative is listed, how `value` is worked out) and, if so, who drafts it.
- [x] **Borderline non-SaaS entries.** Decided 23 Jul: archived 61 (HMRC Tools), 65 (NCSC guidance), 66 (ICO guidance) and 83 (OPITO/GWO/HSE/Charities Commission training) as government or regulatory guidance rather than SaaS. Kept 74 (Free Training Academies): vendor learning platforms, genuinely SaaS-adjacent. Core count is now 12 by design.
- [ ] **Value figures the pricing research turned up as questionable (Phase 8.3).** Two remain for the Phase 1.5 review (the third, 66 ICO, is now archived and moot): 29 Hotjar Free looks low at `value: 100` since Contentsquare's acquisition of Hotjar; 82 Sketchup Free / Go carries `value: 200` but its free tier is licensed for non-commercial use only, which the value figure doesn't currently reflect.
- [ ] **Vercel listing (id 86, Vercel Hobby).** Its free Hobby tier's terms of service ban commercial use, unusual among the tools in this directory. Currently kept, with a `notes` entry warning that a client's production site needs Vercel Pro or an alternative such as Netlify Free. Decide whether that warning is enough or whether it should be archived instead.

## Nice-to-have / flagged

- [ ] Replace the Lucide-via-CDN icon substitution if a preferred icon system exists (design-system brief caveat; not currently used by Free Stack itself). Category icons in client mode already use hand-copied Lucide paths with no CDN or npm dependency, see BUILD-PLAN 7.11.
- [ ] Confirm whether a licensed Proxima Nova webfont should be loaded for the wordmark (falls back to Mona Sans/Montserrat today)
- [ ] Post-v1 ideas parked in PRD §13 still open: API endpoint serving `tools.json` publicly, embed mode
